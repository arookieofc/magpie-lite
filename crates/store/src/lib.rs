//! magpie-store: the gateway's embedded SQLite database.
//!
//! One file (`magpie.db` next to the config) holds what used to be split
//! across ad-hoc sidecars: sanitized request history for `/stats` and a
//! small key-value table for future process state. Conversation content
//! and credentials are never written here — records carry the same
//! metadata-only shape as the JSONL history file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use anyhow::Context;
use rusqlite::{Connection, params};

/// How many request rows are kept on disk: headroom above the recent
/// window the console serves, so restarts still show a full page.
const KEEP_REQUESTS: u64 = 5_000;
/// Current `magpie.db` schema version, stored in `kv.schema_version`.
/// Bump alongside a new `migrate_step`, never in place: `open` refuses
/// a newer version instead of guessing, and migrates older ones forward.
const CURRENT_SCHEMA_VERSION: i64 = 1;

/// The database file for a resolved config location: `magpie.db` in the
/// same directory as the config, so config, affinity and history travel
/// together (`%APPDATA%\magpie-lite` on Windows).
pub fn default_db_path(config_path: &Path) -> PathBuf {
    match config_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.join("magpie.db"),
        _ => PathBuf::from("magpie.db"),
    }
}

/// Restrict a secret-adjacent file to owner-only access on Unix.
/// The history DB carries metadata only, but it sits beside the config
/// and affinity state, so it gets the same hardening. Windows ACL work
/// waits for an OS-native secret store.
fn restrict_secret_file(path: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// An open `magpie.db`. Cheap to share behind the request log's lock:
/// every method takes `&self` and serializes on the connection.
pub struct Store {
    conn: Mutex<Connection>,
}

/// Read the stored schema version. Missing or damaged means pre-versioned
/// (`0`): the base tables above already exist, so migration just stamps
/// the current version without touching rows.
fn stored_schema_version(conn: &Connection) -> anyhow::Result<i64> {
    let mut stmt = conn.prepare("SELECT v FROM kv WHERE k = 'schema_version'")?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        None => Ok(0),
        Some(row) => {
            let raw: String = row.get(0)?;
            Ok(raw.parse::<i64>().unwrap_or(0))
        }
    }
}

/// Bring `conn` to [`CURRENT_SCHEMA_VERSION`]. New steps plug in as
/// `version == N` arms; a newer on-disk version is a hard error so an
/// old binary never misreads a new schema.
fn migrate_schema(conn: &Connection) -> anyhow::Result<i64> {
    let mut version = stored_schema_version(conn)?;
    if version > CURRENT_SCHEMA_VERSION {
        anyhow::bail!(
            "unsupported magpie.db schema version {version} (this binary knows {CURRENT_SCHEMA_VERSION})"
        );
    }
    while version < CURRENT_SCHEMA_VERSION {
        version += 1;
    }
    conn.execute(
        "INSERT INTO kv(k, v) VALUES ('schema_version', ?1)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        params![CURRENT_SCHEMA_VERSION.to_string()],
    )?;
    Ok(CURRENT_SCHEMA_VERSION)
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store").finish_non_exhaustive()
    }
}

impl Store {
    /// Open (and create when needed) the database, bringing the schema
    /// up to date and trimming rows past [`KEEP_REQUESTS`].
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("could not create {}", parent.display()))?;
        }
        let conn = Connection::open(path)
            .with_context(|| format!("could not open {}", path.display()))?;
        conn.busy_timeout(Duration::from_secs(5))?;
        restrict_secret_file(path)?;
        // WAL keeps readers (the console's /stats poll) from blocking on
        // the write that lands when each request finishes.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS requests(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_ms INTEGER NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '',
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                body TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_requests_started ON requests(started_ms);
            CREATE TABLE IF NOT EXISTS kv(
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            );",
        )?;
        migrate_schema(&conn)?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.prune(KEEP_REQUESTS)?;
        Ok(store)
    }

    /// Append one finished request. The indexed columns exist for future
    /// filtered queries; the console reads the full `body` back.
    pub fn append_request(
        &self,
        started_ms: i64,
        provider: &str,
        status: &str,
        input_tokens: i64,
        output_tokens: i64,
        body: &serde_json::Value,
    ) -> anyhow::Result<()> {
        let body = serde_json::to_string(body)?;
        let conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        conn.execute(
            "INSERT INTO requests(started_ms, provider, status, input_tokens, output_tokens, body)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![started_ms, provider, status, input_tokens, output_tokens, body],
        )?;
        Ok(())
    }

    /// The newest `limit` records, oldest first. Damaged rows are skipped
    /// so one bad write cannot break startup — same tolerance as the
    /// JSONL history file.
    pub fn load_recent(&self, limit: usize) -> anyhow::Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        let mut stmt =
            conn.prepare("SELECT body FROM requests ORDER BY id DESC LIMIT ?1")?;
        let rows = stmt.query_map(params![limit as i64], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for body in rows {
            let Ok(body) = body else { continue };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) else {
                continue;
            };
            out.push(value);
        }
        out.reverse();
        Ok(out)
    }

    /// Drop everything but the newest `keep` rows, returning how many
    /// were removed.
    pub fn prune(&self, keep: u64) -> anyhow::Result<usize> {
        let conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        let removed = conn.execute(
            "DELETE FROM requests WHERE id NOT IN (SELECT id FROM requests ORDER BY id DESC LIMIT ?1)",
            params![keep as i64],
        )?;
        Ok(removed)
    }

    /// Read a small piece of process state (affinity entries and similar
    /// move here next).
    pub fn kv_get(&self, key: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        let mut stmt = conn.prepare("SELECT v FROM kv WHERE k = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    /// Write a small piece of process state.
    pub fn kv_set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        conn.execute(
            "INSERT INTO kv(k, v) VALUES (?1, ?2)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![key, value],
        )?;
        Ok(())
    }

    /// Read the conversation-affinity snapshot: when it was written and the
    /// sticks as JSON. Absent or damaged means no snapshot — the caller
    /// carries on with memory only, like a missing `affinity.json`.
    pub fn get_affinity_snapshot(&self) -> anyhow::Result<Option<(i64, serde_json::Value)>> {
        let (updated, body) = match (self.kv_get("affinity_updated_ms")?, self.kv_get("affinity")?) {
            (Some(updated), Some(body)) => (updated, body),
            _ => return Ok(None),
        };
        let Ok(updated) = updated.parse::<i64>() else {
            return Ok(None);
        };
        let Ok(body) = serde_json::from_str::<serde_json::Value>(&body) else {
            return Ok(None);
        };
        Ok(Some((updated, body)))
    }

    /// Replace the conversation-affinity snapshot atomically: the sticks
    /// and their write time land in one transaction, so another process
    /// never reads a new time with an old snapshot or the reverse.
    pub fn set_affinity_snapshot(
        &self,
        updated_ms: i64,
        body: &serde_json::Value,
    ) -> anyhow::Result<()> {
        let body = serde_json::to_string(body)?;
        let mut conn = self.conn.lock().map_err(|_| anyhow::anyhow!("store lock poisoned"))?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO kv(k, v) VALUES ('affinity', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![body],
        )?;
        tx.execute(
            "INSERT INTO kv(k, v) VALUES ('affinity_updated_ms', ?1)
             ON CONFLICT(k) DO UPDATE SET v = excluded.v",
            params![updated_ms.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "magpie-store-test-{}-{name}.db",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn requests_round_trip_in_order() {
        let path = temp_db("round-trip");
        let store = Store::open(&path).unwrap();
        for i in 0..3 {
            store
                .append_request(
                    1_700_000_000_000 + i,
                    "acme",
                    "ok",
                    i,
                    i * 10,
                    &serde_json::json!({ "seq": i, "provider": "acme" }),
                )
                .unwrap();
        }
        let recent = store.load_recent(10).unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0]["seq"], 0);
        assert_eq!(recent[2]["seq"], 2);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn prune_keeps_the_newest_rows() {
        let path = temp_db("prune");
        let store = Store::open(&path).unwrap();
        for i in 0..5 {
            store
                .append_request(i, "acme", "ok", 0, 0, &serde_json::json!({ "seq": i }))
                .unwrap();
        }
        assert_eq!(store.prune(2).unwrap(), 3);
        let recent = store.load_recent(10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[1]["seq"], 4);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn kv_round_trip() {
        let path = temp_db("kv");
        let store = Store::open(&path).unwrap();
        assert_eq!(store.kv_get("a").unwrap(), None);
        store.kv_set("a", "1").unwrap();
        store.kv_set("a", "2").unwrap();
        assert_eq!(store.kv_get("a").unwrap().as_deref(), Some("2"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn default_db_path_sits_beside_the_config() {
        assert_eq!(
            default_db_path(Path::new("/tmp/magpie-lite/config.toml")),
            PathBuf::from("/tmp/magpie-lite/magpie.db")
        );
    }

    #[test]
    fn affinity_snapshot_round_trip() {
        let path = temp_db("affinity");
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get_affinity_snapshot().unwrap(), None);
        let blob = serde_json::json!({"scope|conv": {"who": "acme#1", "at": 42}});
        store.set_affinity_snapshot(4242, &blob).unwrap();
        let (updated, back) = store.get_affinity_snapshot().unwrap().unwrap();
        assert_eq!(updated, 4242);
        assert_eq!(back, blob);
        // A damaged time or body reads as no snapshot, never an error.
        store.kv_set("affinity_updated_ms", "not-a-number").unwrap();
        assert_eq!(store.get_affinity_snapshot().unwrap(), None);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn fresh_db_stamps_current_schema_version() {
        let path = temp_db("schema-fresh");
        let store = Store::open(&path).unwrap();
        assert_eq!(
            store.kv_get("schema_version").unwrap().as_deref(),
            Some("1")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn legacy_db_without_version_migrates_without_losing_rows() {
        let path = temp_db("schema-legacy");
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_ms INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
                 CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
                 INSERT INTO requests(started_ms, provider, status, input_tokens, output_tokens, body)
                 VALUES (42, 'acme', 'ok', 1, 2, '{\"seq\":0}');",
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(
            store.kv_get("schema_version").unwrap().as_deref(),
            Some("1")
        );
        assert_eq!(store.load_recent(10).unwrap().len(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn damaged_schema_version_migrates_forward() {
        let path = temp_db("schema-damaged");
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_ms INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
                 CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
                 INSERT INTO kv(k, v) VALUES ('schema_version', 'not-a-number');",
            )
            .unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(
            store.kv_get("schema_version").unwrap().as_deref(),
            Some("1")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn newer_schema_version_refuses_to_open() {
        let path = temp_db("schema-newer");
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,
                    started_ms INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
                 CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
                 INSERT INTO kv(k, v) VALUES ('schema_version', '999');",
            )
            .unwrap();
        }
        assert!(Store::open(&path).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    #[cfg(unix)]
    fn db_file_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_db("schema-perms");
        let _store = Store::open(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "magpie.db should be owner-only, got {mode:o}");
        let _ = std::fs::remove_file(&path);
    }
}
