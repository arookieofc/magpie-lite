// Shapes the console reads from the gateway, mirrored on the serde
// snapshot structs in crates/router/src/config.rs and the accounting
// records in crates/gateway/src/usage.rs. Optionals mark fields serde
// skips or that arrive only when their feature is configured.

export interface UsageSnapshot {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface TryRecord {
  provider: string;
  model: string;
  key_slot: number;
  effort?: string;
  queued_ms?: number;
  status?: string;
  ms?: number;
  first_ms?: number;
  rest_ms?: number;
}

export interface Classified {
  intent?: string;
  intents?: string[];
  effort?: string;
  error?: string;
  cached?: boolean;
  fallback?: string;
}

export interface RuleTrace {
  rule?: number;
  use?: string;
  then?: string[];
}

export interface RequestRecord {
  seq?: number;
  started_unix_ms: number;
  client_protocol: string;
  requested_model: string;
  provider: string;
  upstream_model: string;
  key_slot: number;
  tries?: TryRecord[];
  replans?: number;
  replan_waited_ms?: number;
  stream: boolean;
  status: string;
  rejected?: boolean;
  error?: string;
  latency_ms: number;
  usage: UsageSnapshot;
  classified?: Classified;
  rule?: RuleTrace;
}

export interface KeyStats {
  attempts: number;
  successes: number;
  errors: number;
}

export interface RecentUsageStats {
  requests: number;
  errors: number;
  requests_with_usage: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_latency_ms: number;
  average_latency_ms?: number;
}

export interface RecentUsageSummary {
  totals: RecentUsageStats;
  by_provider: Record<string, RecentUsageStats>;
  by_model: Record<string, RecentUsageStats>;
}

export interface ProviderStats {
  requests: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  keys: Record<string, KeyStats>;
}

export interface LaneSnapshot {
  who: string;
  busy: number;
  waiting: number;
  limit: number;
}

export interface RpmSnapshot {
  who: string;
  used: number;
}

export interface ClassifierStatus {
  model: string;
  error?: string;
  at_unix_ms?: number;
}

export interface Stats {
  total_requests: number;
  errors: number;
  providers: Record<string, ProviderStats>;
  key_cooldowns: Record<
    string,
    { slot: number; until_unix_ms: number; remaining_ms?: number; reason?: string }[]
  >;
  lanes?: LaneSnapshot[];
  rpm?: RpmSnapshot[];
  recent_usage: RecentUsageSummary;
  recent_requests: RequestRecord[];
  classifier_status: ClassifierStatus[];
}

export interface ModelInfo {
  id: string;
  owned_by?: string;
}

export interface ModelsResponse {
  data: ModelInfo[];
}

export interface Agent {
  id: string;
  name: string;
  detected?: boolean;
  detection?: {
    config_file: boolean;
    config_directory: boolean;
    cli?: { path: string; on_path: boolean | null } | null;
    search_limited: boolean;
  } | null;
  connected: boolean;
  model?: string | null;
  drifted?: boolean;
  recovery_needed?: boolean;
  files?: string[];
  notice?: string;
}

export interface AgentsResponse {
  agents: Agent[];
}

export interface AgentPreviewFile {
  path: string;
  operation: string;
  before_bytes: number;
  after_bytes: number;
}

export interface AgentPreview {
  agent: string;
  action: "connect" | "disconnect";
  model?: string | null;
  revision: string;
  files: AgentPreviewFile[];
  notice: string;
}

export interface ProviderCapabilities {
  supported_protocols?: string[];
  streaming?: boolean | null;
  tools?: boolean | null;
  vision?: boolean | null;
}

export interface ProviderConfig {
  id: string;
  name: string;
  protocol: string;
  capabilities?: ProviderCapabilities;
  base_url: string;
  models: string[];
  contexts?: Record<string, number>;
  outputs?: Record<string, number>;
  free_models?: string[];
  key_count: number;
  credential_count: number;
  key_cooldown_override_ms?: number | null;
  fallback: string[];
  key_cooldown_ms: number;
  routing: string;
  weights?: number[];
  affinity: string;
  max_concurrency?: number | null;
  key_limits?: number[];
  pin_upstream?: boolean;
  max_rpm?: number | null;
  queue_limit?: number | null;
  queue_wait_s?: number | null;
}

export interface RuleTime {
  from: string;
  to: string;
  days?: string[];
}

export interface RoutingRule {
  use?: string;
  pause?: boolean;
  tokens?: number;
  effort?: string;
  useEffort?: string;
  agents?: string[];
  intent?: string;
  time?: RuleTime;
  folders?: string[];
  exceptFolders?: string[];
  images?: boolean;
  compact?: boolean;
}

export interface GroupConfig {
  id: string;
  name: string;
  routes: string[];
  rules?: RoutingRule[];
  classifier?: string;
  effort?: string;
  levels?: string[];
  pick?: string;
  weights?: number[];
  free?: boolean[];
  routing: string;
  auto?: boolean;
  hidden?: boolean;
  first_token_timeout_ms?: number;
  affinity: string;
  patience_s?: number | null;
}

export interface Config {
  revision: number;
  default_provider: string;
  key_cooldown_ms: number;
  providers: ProviderConfig[];
  groups: GroupConfig[];
  no_auto_groups: boolean;
  vision?: string | null;
}

// One tile of the Add sheet, served by GET /config/presets.
export interface VendorPreset {
  id: string;
  name: string;
  short?: string;
  kind: "partner" | "vendor" | "relay" | "local";
  protocol: string;
  chat?: string;
  responses?: string;
  anthropic?: string;
  gemini?: string;
  note?: string;
  pair?: string;
  icon?: string | null;
}

export interface TraceResponse {
  seq: number;
  routes: RequestRecord[];
  totals: { requests: number; errors: number; rerouted: number };
  now: number;
}
