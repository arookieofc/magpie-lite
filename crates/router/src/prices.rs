//! Built-in model prices, in USD per million tokens, extracted from the
//! reference's bundled models.dev snapshot. Keyed by the provider's base
//! URL host, the same lookup `presets` uses for capability metadata; an
//! unknown host has no prices and its calls count as unpriced.

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
pub fn price_of(base_url: &str, model: &str) -> Option<ModelPrice> {
    let host = crate::presets::host_of(base_url);
    let table = PRICES.get(&host)?;
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
        assert!(price_of("https://example.com/v1", "gpt-4").is_none());
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
