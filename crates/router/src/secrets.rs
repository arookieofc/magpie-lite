//! Machine-bound encrypted secrets in `~/magpie-lite/secrets.enc`.
//!
//! The gateway config keeps routing metadata in plaintext TOML; this file
//! holds the sensitive half (gateway token + provider API keys) encrypted
//! with a key derived from the local machine id. A copy moved to another
//! machine fails authentication instead of decrypting.
//!
//! Storage plus the split/merge helpers lives here; the migration wiring
//! (`Config::load_merged` / `Config::save_merged` / `Config::recover_secrets`
//! in `config.rs`) decides when secrets move between the TOML file and this
//! blob. See that module for the migration and recovery contract.

use std::collections::BTreeMap;
use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use chacha20poly1305::{
    ChaCha20Poly1305, Key, Nonce,
    aead::{Aead, KeyInit},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const FILE_VERSION: u32 = 1;
const KEY_DOMAIN: &str = "magpie-lite-secrets-v1";
const NONCE_LEN: usize = 12;

/// Sensitive payload kept out of `config.toml`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretsFile {
    /// Gateway token (`Authorization: Bearer` / console token).
    #[serde(default)]
    pub token: String,
    /// Provider id -> API keys in slot order.
    #[serde(default)]
    pub api_keys: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Envelope {
    v: u32,
    nonce: String,
    ct: String,
}

/// `~/magpie-lite` per the user request (home dir, not the platform
/// config dir). Returns an error when the home dir is unknown.
pub fn secret_dir() -> anyhow::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("cannot find the home directory"))?;
    Ok(home.join("magpie-lite"))
}

/// Full path of the encrypted blob.
pub fn secrets_path() -> anyhow::Result<PathBuf> {
    Ok(secret_dir()?.join("secrets.enc"))
}

/// Full path of the encrypted blob for one configuration file: the
/// `secrets.enc` sibling of that TOML file. The gateway resolves secrets
/// per config file (not per home directory) so `--config` layouts and
/// sandboxed tests stay hermetic: each config migrates into its own
/// sibling blob instead of sharing the home-directory one.
pub fn secrets_path_for(config_path: &std::path::Path) -> PathBuf {
    config_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.join("secrets.enc"))
        .unwrap_or_else(|| PathBuf::from("secrets.enc"))
}

/// Stable machine code for key derivation. No new deps: OS-native source
/// first, hostname/user fallback last. Empty means failure, never a
/// constant key.
pub fn machine_id() -> anyhow::Result<String> {
    if let Some(id) = machine_id_native() {
        let id = id.trim().to_lowercase();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    machine_id_fallback()
}

#[cfg(target_os = "windows")]
fn machine_id_native() -> Option<String> {
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // `... MachineGuid    REG_SZ    <guid>` — the guid is the last token.
    text.split_whitespace().last().map(str::to_string)
}

#[cfg(target_os = "linux")]
fn machine_id_native() -> Option<String> {
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(text) = std::fs::read_to_string(path) {
            let id = text.trim().to_string();
            if !id.is_empty() {
                return Some(id);
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn machine_id_native() -> Option<String> {
    let out = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if line.contains("IOPlatformUUID") {
            if let Some(value) = line.split('=').nth(1) {
                let id = value.trim().trim_matches('"').to_string();
                if !id.is_empty() {
                    return Some(id);
                }
            }
        }
    }
    None
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn machine_id_native() -> Option<String> {
    None
}

fn machine_id_fallback() -> anyhow::Result<String> {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .or_else(|_| std::env::var("HOST"))
        .unwrap_or_default();
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default();
    let id = format!("{}:{}", host.trim(), user.trim()).to_lowercase();
    if id == ":" || id.trim_matches(':').is_empty() {
        anyhow::bail!("cannot determine a machine id for secret encryption");
    }
    Ok(format!("fallback:{id}"))
}

fn derive_key(machine: &str) -> Key {
    let mut hasher = Sha256::new();
    hasher.update(KEY_DOMAIN.as_bytes());
    hasher.update([0u8]);
    hasher.update(machine.trim().to_lowercase().as_bytes());
    let digest = hasher.finalize();
    *Key::from_slice(&digest)
}

fn random_nonce() -> anyhow::Result<[u8; NONCE_LEN]> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).map_err(|e| anyhow::anyhow!("cannot sample a nonce: {e}"))?;
    Ok(nonce)
}

/// Encrypt `secrets` for `machine` and write `path` atomically (0600 on Unix).
pub fn save_secrets(
    path: &std::path::Path,
    machine: &str,
    secrets: &SecretsFile,
) -> anyhow::Result<()> {
    use std::io::Write;

    if machine.trim().is_empty() {
        anyhow::bail!("refusing to encrypt secrets without a machine id");
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let plain = serde_json::to_vec(secrets)?;
    let key = derive_key(machine);
    let cipher = ChaCha20Poly1305::new(&key);
    let nonce_bytes = random_nonce()?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain.as_ref())
        .map_err(|e| anyhow::anyhow!("cannot encrypt secrets: {e}"))?;
    let envelope = Envelope {
        v: FILE_VERSION,
        nonce: B64.encode(nonce_bytes),
        ct: B64.encode(ct),
    };
    let text = serde_json::to_string_pretty(&envelope)?;
    let mut file = tempfile::NamedTempFile::new_in(
        path.parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new(".")),
    )?;
    file.write_all(text.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    restrict_secret_file(path)?;
    Ok(())
}

/// Decrypt `path` with `machine`. Missing file reads as `None` so a fresh
/// install starts empty; wrong machine, version or tamper is a hard error.
pub fn load_secrets(path: &std::path::Path, machine: &str) -> anyhow::Result<Option<SecretsFile>> {
    if !path.exists() {
        return Ok(None);
    }
    if machine.trim().is_empty() {
        anyhow::bail!("refusing to decrypt secrets without a machine id");
    }
    let text = std::fs::read_to_string(path)?;
    let envelope: Envelope = serde_json::from_str(&text)?;
    if envelope.v != FILE_VERSION {
        anyhow::bail!("unsupported secrets version {}", envelope.v);
    }
    let nonce_bytes = B64
        .decode(envelope.nonce.trim())
        .map_err(|e| anyhow::anyhow!("damaged secrets nonce: {e}"))?;
    if nonce_bytes.len() != NONCE_LEN {
        anyhow::bail!("damaged secrets nonce length {}", nonce_bytes.len());
    }
    let ct = B64
        .decode(envelope.ct.trim())
        .map_err(|e| anyhow::anyhow!("damaged secrets payload: {e}"))?;
    let key = derive_key(machine);
    let cipher = ChaCha20Poly1305::new(&key);
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_ref())
        .map_err(|_| anyhow::anyhow!("cannot decrypt secrets: machine mismatch or damaged file"))?;
    Ok(Some(serde_json::from_slice::<SecretsFile>(&plain)?))
}

fn restrict_secret_file(path: &std::path::Path) -> anyhow::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy() -> SecretsFile {
        SecretsFile {
            token: "test-token".into(),
            api_keys: BTreeMap::from([
                (
                    "acme".into(),
                    vec!["test-key-1".into(), "test-key-2".into()],
                ),
                ("other".into(), vec!["test-key-3".into()]),
            ]),
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "magpie-secrets-test-{}-{name}.enc",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn round_trip_with_same_machine() {
        let path = temp_path("round-trip");
        save_secrets(&path, "test-machine-1", &dummy()).unwrap();
        let back = load_secrets(&path, "test-machine-1").unwrap().unwrap();
        assert_eq!(back, dummy());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_reads_as_none() {
        let path = temp_path("missing");
        let _ = std::fs::remove_file(&path);
        assert!(load_secrets(&path, "test-machine-1").unwrap().is_none());
    }

    #[test]
    fn other_machine_cannot_decrypt() {
        let path = temp_path("machine-mismatch");
        save_secrets(&path, "machine-a", &dummy()).unwrap();
        assert!(
            load_secrets(&path, "machine-b")
                .unwrap_err()
                .to_string()
                .contains("machine mismatch")
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn tampered_payload_fails() {
        let path = temp_path("tamper");
        save_secrets(&path, "test-machine-1", &dummy()).unwrap();
        let mut envelope: Envelope =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut ct = B64.decode(envelope.ct.trim()).unwrap();
        ct[0] ^= 0x01;
        envelope.ct = B64.encode(ct);
        std::fs::write(&path, serde_json::to_string_pretty(&envelope).unwrap()).unwrap();
        assert!(load_secrets(&path, "test-machine-1").is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn empty_machine_id_is_refused() {
        let path = temp_path("empty-machine");
        assert!(save_secrets(&path, "  ", &dummy()).is_err());
        assert!(!path.exists());
    }

    #[test]
    #[cfg(unix)]
    fn secrets_file_is_owner_only_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_path("perms");
        save_secrets(&path, "test-machine-1", &dummy()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "secrets.enc should be owner-only, got {mode:o}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn secret_dir_is_home_magpie_lite() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(secret_dir().unwrap(), home.join("magpie-lite"));
        assert_eq!(
            secrets_path().unwrap(),
            home.join("magpie-lite").join("secrets.enc")
        );
    }
}
