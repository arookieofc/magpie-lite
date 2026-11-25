//! Built-in model prices, in USD per million tokens, extracted from the
//! reference's bundled models.dev snapshot. Keyed by the provider's base
//! URL host, the same lookup `presets` uses for capability metadata; when
//! that host lists no price for the model, the model's own vendor table
//! prices it instead (a relay's `gpt-*` at OpenAI's rate, `claude-*` at
//! Anthropic's, and so on). A relay's real charge can differ from the
//! vendor's list, so a fallback price is the official rate, an estimate;
//! a model no vendor table names stays unpriced.

use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;

/// One model's price, in USD per million tokens. `cache_read` and
/// `cache_write` default to 0 when the vendor lists none.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct ModelPrice {
    /// Input (prompt) tokens.
    pub input: f64,
    /// Output (completion) tokens; reasoning bills as output.
    pub output: f64,
    /// Prompt-cache read tokens.
    #[serde(default)]
    pub cache_read: f64,
    /// Prompt-cache write tokens.
    #[serde(default)]
    pub cache_write: f64,
}

static PRICES: LazyLock<BTreeMap<String, BTreeMap<String, ModelPrice>>> =
    LazyLock::new(|| serde_json::from_str(include_str!("prices.json")).unwrap_or_default());

/// The price the provider's base URL host lists for `model`, when the
/// vendor is known and lists one. Model ids compare case-insensitively:
/// vendors and agents spell them apart.
///
/// When the serving host lists no price for the model — an unknown relay
/// host, a vendor table that predates the model — the model's own vendor
/// table is tried instead, so a `gpt-*` served anywhere prices at
/// OpenAI's rate. Only an exact model id in the vendor's table counts;
/// nothing is guessed from a family resemblance.
pub fn price_of(base_url: &str, model: &str) -> Option<ModelPrice> {
    let host = crate::presets::host_of(base_url);
    if let Some(price) = lookup(&host, model) {
        return Some(price);
    }
    canonical_hosts_for(model)
        .iter()
        .find_map(|host| lookup(host, model))
}

/// The price `host`'s table lists for `model`, comparing model ids
/// case-insensitively: vendors and agents spell them apart.
fn lookup(host: &str, model: &str) -> Option<ModelPrice> {
    let table = PRICES.get(host)?;
    table
        .get(model)
        .or_else(|| {
            let lower = model.to_lowercase();
            table
                .iter()
                .find(|(id, _)| id.to_lowercase() == lower)
                .map(|(_, p)| p)
        })
        .copied()
}

/// The vendor tables that own `model`'s family, most official first: a
/// relay spells the vendor's own model id, so the vendor's own table
/// prices it. Empty when the id names no known family, or the family
/// has no table in the snapshot.
fn canonical_hosts_for(model: &str) -> &'static [&'static str] {
    let model = model.to_lowercase();
    // `o1`/`o3` match bare and suffixed (`o1-mini`, `o3-pro`); the longer
    // families below keep their dash so `seed-` never steals `seedish`.
    if has_prefix(&model, &["gpt-", "o1", "o3", "o4-"]) {
        &["api.openai.com"]
    } else if model.starts_with("claude-") {
        &["api.anthropic.com"]
    } else if model.starts_with("gemini-") {
        &["generativelanguage.googleapis.com"]
    } else if model.starts_with("deepseek-") {
        &["api.deepseek.com"]
    } else if has_prefix(&model, &["moonshot-", "kimi-", "k2-"]) {
        &["api.moonshot.ai", "api.moonshot.cn"]
    } else if has_prefix(&model, &["qwen-", "qwq-"]) {
        &["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"]
    } else if model.starts_with("glm-") {
        &["open.bigmodel.cn"]
    } else if model.starts_with("grok-") {
        &["api.x.ai"]
    } else if has_prefix(&model, &["doubao-", "seed-"]) {
        &["ark.cn-beijing.volces.com"]
    } else if has_prefix(&model, &["minimax-", "abab"]) {
        &["api.minimax.io"]
    } else if model.starts_with("step-") {
        &["api.stepfun.ai", "api.stepfun.com"]
    } else {
        &[]
    }
}

fn has_prefix(model: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|p| model.starts_with(p))
}

impl ModelPrice {
    /// Cost of a call at this price, in USD. Reasoning tokens bill as
    /// output by every vendor and are already inside `output`.
    pub fn cost(&self, input: u64, output: u64, cache_read: u64, cache_write: u64) -> f64 {
        (input as f64 * self.input
            + output as f64 * self.output
            + cache_read as f64 * self.cache_read
            + cache_write as f64 * self.cache_write)
            / 1e6
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_hosts_price_their_models() {
        let p = price_of("https://api.deepseek.com/v1", "deepseek-v4-pro")
            .expect("deepseek-v4-pro priced");
        assert!(p.input > 0.0 && p.output > 0.0);
    }

    #[test]
    fn unknown_host_is_unpriced() {
        assert!(price_of("https://example.com/v1", "mock-model").is_none());
    }

    #[test]
    fn unknown_host_falls_back_to_the_model_vendor_table() {
        let p = price_of("https://relay.example.com/v1", "gpt-4o")
            .expect("gpt-4o falls back to OpenAI");
        let official = price_of("https://api.openai.com/v1", "gpt-4o").expect("official rate");
        assert!((p.input - official.input).abs() < 1e-12);
        assert!((p.output - official.output).abs() < 1e-12);
        let q = price_of("https://relay.example.com/v1", "claude-sonnet-4-5")
            .expect("claude falls back to Anthropic");
        let official =
            price_of("https://api.anthropic.com/v1", "claude-sonnet-4-5").expect("official rate");
        assert!((q.input - official.input).abs() < 1e-12);
    }

    #[test]
    fn fallback_needs_the_exact_model_id() {
        // A family name alone buys nothing: the id must be listed.
        assert!(price_of("https://relay.example.com/v1", "gpt-never-existed").is_none());
        // ... nor does a relay-only alias the vendor never listed.
        assert!(price_of("https://relay.example.com/v1", "codex-auto-review").is_none());
    }

    #[test]
    fn cost_counts_each_part() {
        let p = ModelPrice {
            input: 1.0,
            output: 2.0,
            cache_read: 0.5,
            cache_write: 1.25,
        };
        let usd = p.cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((usd - (1.0 + 2.0 + 0.5 + 1.25)).abs() < 1e-9);
    }
}
