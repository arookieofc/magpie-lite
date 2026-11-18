//! magpie-gateway: the local server agents talk to.

pub mod config_store;
pub mod icons;
pub mod provider_tools;
pub mod providers;
pub mod retrieval;
pub mod server;
pub mod upstream;
pub mod usage;

pub use config_store::ConfigStore;
pub use server::{AppState, build_router, serve, serve_with_config_path};

// The routing core now lives in magpie-router; re-export what the CLI and
// downstream users need so `magpie_gateway::Config` etc. still work.
pub use magpie_router::{
    Affinity, AffinityStore, Config, GroupConfig, KeyRotator, Protocol, ProviderCapabilities,
    ProviderConfig, RoutingPolicy, Rule, affinity, billing, classify, cline, config, continuation,
    cooldown, deepseek_schema, describe, edge_block, gemini_schema, grok_integral, grok_schema,
    kimi_schema, lanes, maxoutput, model_gone, model_rest, object_root, oneof_schema,
    optional_fields, presets, reply_room, retired, roomy, rules, stream_empty, stream_keepalive,
    stream_loop, stream_refusal, stream_status, stream_timeout, text_only, tool_loop, tool_schema,
    unfit_fields, wrong_endpoint, config_path, init_retired_store, model_is_retired,
};
