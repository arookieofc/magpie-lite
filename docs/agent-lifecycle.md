# Agent lifecycle

The shared `magpie-agents` crate owns all seven adapters. Agent lifecycle
management is CLI-only; the gateway exposes no Agent management endpoints and
the web console does not inspect or modify Agent files. None of these operations
run Agent binaries.

## CLI

```powershell
magpie-lite agent list
magpie-lite agent preview claude deepseek/deepseek-chat
magpie-lite agent connect claude deepseek/deepseek-chat --revision <preview-revision>
magpie-lite agent preview claude --disconnect
magpie-lite agent disconnect claude --revision <preview-revision>
magpie-lite agent recover claude
```

IDs: `claude`, `codex`, `crush`, `gemini`, `goose`, `opencode`, `zed`.
Connect accepts the same provider/model, bare-model and group/<id> routes as the
gateway. A route must resolve in the current configuration; it need not be in a
provider's manually listed catalog. List and preview output JSON metadata, never
configuration contents or credentials.

Without `--revision`, connect/disconnect immediately preview and apply under a
fresh revision check. The existing `claude <model>`, `codex <model>` and other
agent shorthand commands use this same journaled connect flow. `ls` includes
managed connection, drift and recovery state. Disconnect and recover do not
require a readable gateway TOML file or a running server.

Agent wiring uses the configured gateway port and can be performed while the
gateway is stopped.

## Passive Agent detection

All seven adapters share `crates/agents/src/discovery.rs`. `agent list` and `ls`
distinguish three independent observations:

- `detection.config_file`: a managed configuration file exists;
- `detection.config_directory`: a managed file's parent directory exists;
- `detection.cli`: a launcher was found, with its absolute `path` and nullable
  `on_path`. `true` means found in the launching process's captured PATH;
  `false` means found only in a known user/install directory, after searching
  that PATH. `null` means the PATH search was truncated or could not resolve an
  entry, so membership cannot be asserted. The top-level `detected` remains the
  OR of these observations for older clients.

PATH order wins over fallback locations. Native discovery also checks common
user bin/npm/bun/Volta/asdf/mise/pnpm directories, Windows npm/local-app directories,
and shallow nvm/fnm/mise/asdf Node-version installation directories. Absolute
`BUN_INSTALL`, `VOLTA_HOME`, `PNPM_HOME`, `npm_config_prefix`/`NPM_CONFIG_PREFIX`,
`NVM_DIR`, `NVM_HOME` (Windows), `FNM_DIR`, `MISE_DATA_DIR`, `ASDF_DATA_DIR`,
`XDG_DATA_HOME`, `APPDATA` and `LOCALAPPDATA` can contribute installation locations;
relative prefix variables are ignored. An absolute `NVM_DIR` replaces `~/.nvm`.
Relative/empty entries explicitly present in PATH are resolved against the launcher's
working directory.

The first usable `prefix` in the selected home's `.npmrc` contributes the global
bin directory (the prefix itself on Windows, `prefix/bin` on Unix). Blank/comment
lines, case-insensitive keys, paired single/double quotes and `~`/`~/` expansion
are supported; relative values are ignored. Native absolute `npm_config_prefix`
(or `NPM_CONFIG_PREFIX` if the lowercase spelling is absent/relative) replaces
this file-derived prefix. This is passive discovery, not a full npm INI parser:
environment interpolation, alternate userconfig files and project npmrc are not read.

An nvm `alias/default` **text file** resolves chained aliases using the first
non-empty line. Exact installed versions require an executable `bin/node`;
major/minor versions, `node`/`stable`, named LTS aliases, `lts/*` (Unix) and
`lts/-N` are supported. The resolved default is tried before the same root's
remaining complete numeric versions, in descending order. Missing/uninstalled
aliases, cycles and `system` do not select a preferred version, but all installed
versions remain passive fallbacks, matching upstream `UserBinDirs` rather than
its terminal-PATH injection policy.

The process environment is captured when the manager is created. Refresh rechecks
launcher files, `.npmrc`, alias files and Node-version directories; it does not reload a login shell's
PATH or mutate environment variables. Native adapter paths also honor the
reference-supported absolute overrides `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`OPENCODE_CONFIG_DIR` and `MAGPIE_ZED_CONFIG_DIR`; relative values are ignored.
`MAGPIE_LITE_HOME` and `Manager::at_home` take precedence over those overrides and
ignore the real machine's PATH, external prefix variables and global directories,
searching only under the sandbox home. Prefix traversal and symlink targets outside
that home are ignored for discovery inputs, version roots and launchers. Alias
names reject absolute/traversal syntax; alias-file symlinks must remain under the
alias root even in native mode. These are canonical-path checks, not a filesystem
sandbox against concurrent adversarial replacement between checking and opening.
All discovery inputs are read-only; no npm/nvm command is executed. Unix launchers
require a regular file with an executable permission bit. Windows checks `.exe`, `.com`, `.cmd` and
`.bat` files; no script or binary is opened for its contents or run. Zed can be
found as `zed` or `zeditor`.

Search bounds are 128 captured PATH entries, 256 distinct candidate directories
and 64 immediate entries per version-manager root; no recursive walk is performed.
Npmrc reads are limited to 64 KiB. Alias reads are limited to 8 KiB each, 16 probes
per chain, and 128 entries per LTS listing. Only regular files are read; oversized
files, truncated listings and depth exhaustion are not used to choose a default.
`detection.search_limited` warns when entries were omitted or a launcher path
could not be represented in JSON (non-UTF-8 on Unix). Missing results are
not proof that an Agent is uninstalled. Discovery does not verify a launcher
format, version, current process, health, permissions to launch as the current
user, a new terminal's PATH, project overrides or which model that Agent will
actually select. No login shell, registry or credential store is queried.
Launcher-only changes do not alter managed-field ownership, drift or preview
revisions. Preview, apply and recovery are available through the CLI commands
listed above; there is no HTTP or console workflow.

## Backup and recovery

Each configuration directory contains an `agent-state` directory beside the
TOML file. CLI operations use an OS operation lock and journals there. A journal preserves the bytes before the **first** connect; rewiring does
not replace that original baseline. Each adapter declares the fields it owns.
Disconnect restores those fields while preserving later additions, modifications
and deletions of unrelated fields, including edits adopted by a rewire. Model
lists and designated model-pick objects are owned atomically. If wiring replaces
a scalar/array with a container, that replaced ancestor is owned as a whole.
Changes to owned fields or an unsafe configuration shape cause a conflict.

With no intervening edits, disconnect restores the original bytes exactly or
removes a file that did not originally exist. With unrelated edits, JSON/JSONC,
TOML and YAML use format-preserving editors; Gemini dotenv preserves unrelated
records. Existing JSON key order, string/number spelling, BOM and line endings
are retained outside changed values. Inserting a property into a compact JSON
object can expand that touched object to multiple lines. Comments from removed
or replaced JSONC/TOML/YAML containers are retained but may move to the end.
Generated files containing unrelated user data or JSONC comments are kept.
Semantic equality with the baseline does not discard later comments/formatting.

Schema-2 journals record explicit ownership and the latest restoration image as
well as the first baseline. Schema-1 journals are upgraded in memory and saved
in the new format on the next journal write; pending schema-1 disconnects retain
their original whole-file recovery targets.

Gemini, Goose and split-layout Crush may change two files; Windows Crush can use
one shared file. A durable pending journal is saved before publishing any of
them. Per-file replacement is atomic; the **multi-file operation is not**.
An interruption leaves `recovery_needed=true`:

- Pending first connect: restore the pre-connect files.
- Pending rewire: restore the previous managed connection/model, retaining the
  original pre-connection baseline for a subsequent disconnect.
- Pending disconnect: finish the journaled merged restoration target, including
  unrelated edits present when the operation began.

Recovery checks all files first and rechecks each immediately before writing.
If a file matches neither the recorded operation nor its recovery image, recovery
refuses to overwrite it. Preserve the journal and resolve that edit before retrying;
do not delete backups to dismiss an error.

## Safety and limitations

- Journals and staged copies contain **plaintext credentials** (base64 is not
  encryption), including original credentials. Disconnected journals retain
  their original baseline. Treat this directory as sensitive backup material;
  no encrypted secret store or automatic retention/purge policy exists yet.
- Unix state directories use mode 700; journal and connected config files use
  600. Disconnect restores the recorded original file mode, or preserves a user
  permission change during selective restoration. Snapshots retain permission
  bits (including special bits), not file-type bits. Schema-1/2 journals with
  legacy regular-file stat modes are normalized in memory; status/preview do not
  rewrite them. Invalid file-type/high bits are refused. Permission changes stale
  previews and block pending recovery, just like content changes.
- Windows state/new secret files get a protected current-user-only DACL. Existing
  agent file ACLs are preserved on replacement/restoration; pre-existing broad
  ACLs are not automatically narrowed. Windows ACL tests verify both behaviors.
- Symlinks and Windows reparse points in managed paths are refused. Each agent
  file is limited to 4 MiB, journals to 64 MiB. Adapter and HTTP errors never echo
  file contents, upstream keys or the gateway token.
- Unrelated field edits alone do not mark a connection drifted. Managed-field
  conflicts, unsafe/unparseable formats and overriding OpenCode paths do. Any
  file change, even an unrelated one, invalidates an existing preview revision.
  Pending recovery accepts only recorded whole-file input/target images, not
  edits made after journaling. External editors do not participate in our lock;
  immediate checks are not a filesystem-wide CAS.
- Agent JSON parsing rejects duplicate object keys recursively, including nested
  objects inside arrays and keys that match after escape decoding. A first
  connection with ambiguous JSON returns a sanitized 400; ambiguous edits to a
  connected file cause drift/conflict (409). Files and backups are not rewritten
  on refusal. Schema-1 backups containing ambiguous JSON cannot be selectively
  migrated and are retained for manual recovery. OpenCode and Zed use native
  JSONC, accepting line/block comments and trailing commas (not JSON5). Other
  Agent JSON files still require strict JSON. Shared CST edits are independently
  checked for exact target semantics, syntax, duplicate keys, finite numbers,
  depth and the 4 MiB byte bound before staged output can be published. Invalid
  or unsupported edits are refused, never replaced with lossy serialization.
- Gemini dotenv supports export prefixes, duplicate assignments and quoted
  multiline records, but is not a full dotenv evaluator and does not expand
  variables. Managed dotenv value-format changes can cause conservative
  conflicts. Unsupported YAML editing shapes are refused when independent
  semantic validation fails, rather than falling back to lossy serialization.
- OpenCode's JSONC/JSON/legacy precedence is checked live. A new overriding file
  marks an existing connection drifted; disconnect/recovery can still restore
  the originally managed path, including after restart. Wiring edits the selected
  JSONC file without creating an ignored JSON sibling. After restoring the old
  managed file, a new connection can target the live preferred JSONC file.
- Detection is passive file/directory/launcher evidence, including known off-PATH
  installation locations, not installed-version, login-shell, running-process,
  project-override or reachability evidence. See Passive Agent detection above.
  Restart the Agent after changing settings.
- Zed still needs its token in its environment/provider settings; no credential is
  written to its JSON. Real-agent-version compatibility is not yet verified.
- Agent-specific model catalogs, broader protocol fixtures
  and real-agent execution evidence remain on the parity tracker. Console route
  suggestions come from gateway providers/groups, not a running Agent.

## Verification

```powershell
cargo test -p magpie-agents
cargo test -p magpie-lite --test agent_lifecycle
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

Tests use `Manager::at_home` with explicit temporary directories, or child CLI
processes with `MAGPIE_LITE_HOME` pointing to a temporary home. They never mutate
process-wide home variables or target the user's actual agent configuration.
JSON/JSONC editor unit tests cover nested edits, removals, shape changes, escaped
keys/strings, repeated comments, strict-vs-JSONC syntax, numbers, depth, BOM and
CRLF. All JSON adapter files are checked for foreign-byte preservation through
wiring and restoration. Child-CLI tests exercise preview/connect/rewire/selective
restoration and refusal for OpenCode JSONC.

Recovery uses a **synthetic pending-disconnect journal** in the temporary state
directory with a merged restoration image retaining unrelated edits, not a real
process crash. These filesystem fixtures do not prove compatibility with real
installed Agent versions.

Passive discovery tests use temporary launchers for all seven Agents. Unit tests
exercise PATH priority, prefix/environment snapshots without global env mutation,
sandbox isolation, numeric Node-version ordering, bounded/unknown results and
refresh/removal. A lifecycle regression confirms that adding a launcher between
preview and apply does not change revisions or ownership. CLI fixtures verify
metadata remains local and marker scripts are never executed.
Unix permission/symlink branches have also been executed under WSL/Arch Linux.
Lifecycle regressions cover all seven adapters, exact and selective permission
restoration, legacy schema-1/2 stat modes, missing files, and partial publication
of synthetic pending-connect/disconnect journals after reopening the manager.
A child-CLI regression checks stale permission revisions and legacy restoration
without gateway configuration. These are filesystem and synthetic journal
fixtures, not kill/crash experiments or real installed Agent-version evidence.
