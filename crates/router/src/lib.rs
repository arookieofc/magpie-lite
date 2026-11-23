//! magpie-router: the routing and translation core.
//!
//! Provider/group configuration data, routing policies, scheduling state,
//! vendor quirk handling, and stream lifecycle guards — everything needed
//! to turn a decoded [`magpie_core::ir::CompletionRequest`] into a
//! provider/model/protocol pick and back, without HTTP or an HTTP server.
//! The axum server, persistence, agent wiring, and usage ledger live in
//! `magpie-gateway`, which builds on top.

pub mod affinity;
pub mod billing;
pub mod classify;
pub mod cline;
pub mod config;
pub mod continuation;
pub mod cooldown;
pub mod describe;
pub mod edge_block;
pub mod lanes;
pub mod maxoutput;
pub mod model_gone;
pub mod model_rest;
pub mod object_root;
pub mod optional_fields;
pub mod presets;
pub mod prices;
pub mod reply_room;
pub mod retired;
pub mod roomy;
pub mod rules;
pub mod secrets;
pub mod serves;
pub mod stream_empty;
pub mod stream_keepalive;
pub mod stream_loop;
pub mod stream_refusal;
pub mod stream_status;
pub mod stream_timeout;
pub mod text_only;
pub mod tool_loop;
pub mod tool_schema;
pub mod unfit_fields;
pub mod wrong_endpoint;

pub mod deepseek_schema;
pub mod gemini_schema;
pub mod grok_integral;
pub mod grok_schema;
pub mod kimi_schema;
pub mod oneof_schema;

pub use affinity::AffinityStore;
pub use config::{
    Affinity, Config, GroupConfig, KeyRotator, Protocol, ProviderCapabilities, ProviderConfig,
    RoutingPolicy, config_path,
};
pub use retired::{init as init_retired_store, is_retired as model_is_retired};
pub use rules::Rule;
