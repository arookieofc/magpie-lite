//! Seed a `magpie.db` with deterministic demo history for console UI work.
//!
//! Usage: `cargo run -p magpie-store --example seed_demo -- [path]`
//! Defaults to `./magpie.demo.db` next to the workspace. Point it at the
//! real gateway database (`%APPDATA%\magpie-lite\magpie.db` on Windows) to
//! see the rows in `/stats`.
//!
//! This wipes the target file first — demo use only, never point it at a
//! database holding real history you care about.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use magpie_store::Store;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn rng_next(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    *state = x;
    x.wrapping_mul(0x2545_F491_4F6C_DD1D)
}

fn pick<'a>(rng: &mut u64, xs: &'a [&'a str]) -> &'a str {
    xs[(rng_next(rng) % xs.len() as u64) as usize]
}

fn range(rng: &mut u64, lo: u64, hi: u64) -> u64 {
    lo + rng_next(rng) % (hi - lo + 1)
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let append = args.iter().any(|a| a == "--append");
    let path = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("magpie.demo.db"));
    if !append && path.exists() {
        println!("wiping {}", path.display());
        std::fs::remove_file(&path)?;
    }
    let store = Store::open(&path)?;

    // (provider, base URL, requested model, upstream model, client protocol).
    // The base URL prices the record as the real tracker does.
    let pool = [
        (
            "deepseek",
            "https://api.deepseek.com/v1",
            "deepseek-v4-pro",
            "deepseek-v4-pro",
            "chat",
        ),
        (
            "openai",
            "https://api.openai.com/v1",
            "gpt-4o-mini",
            "gpt-4o-mini",
            "chat",
        ),
        (
            "openai",
            "https://api.openai.com/v1",
            "gpt-5",
            "gpt-5.2",
            "responses",
        ),
        (
            "anthropic",
            "https://api.anthropic.com",
            "claude-sonnet-4-5",
            "claude-sonnet-4-5-20250514",
            "anthropic",
        ),
        (
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-3-flash-preview",
            "gemini-3-flash-preview",
            "gemini",
        ),
        (
            "zhipu",
            "https://open.bigmodel.cn/api/paas/v4",
            "glm-4.7",
            "glm-4.7",
            "chat",
        ),
    ];
    let failures = ["rate_limited", "timeout", "context_overflow"];

    let mut rng: u64 = 0x9E37_79B9_7F4A_7C15;
    let rows: u64 = 180;
    // ~56 minutes apart, covering the last 7 days; oldest inserted first
    // so row ids stay chronological.
    let step_ms: u64 = 7 * 24 * 60 * 60 * 1000 / rows;
    let now = now_ms();
    for i in 0..rows {
        let (provider, base_url, requested, upstream, protocol) = pool[(i as usize) % pool.len()];
        let failed = i % 12 == 7;
        let status = if failed {
            pick(&mut rng, &failures)
        } else {
            "ok"
        };
        let started = now - (rows - 1 - i) * step_ms - range(&mut rng, 0, 20 * 60 * 1000);
        let input = range(&mut rng, 200, 8000) as i64;
        let output = if failed {
            0
        } else {
            range(&mut rng, 50, 3000) as i64
        };
        let cache_read = if !failed && rng_next(&mut rng) % 3 == 0 {
            Some(range(&mut rng, 1024, 6000))
        } else {
            None
        };
        let key_slot = if rng_next(&mut rng) % 5 == 0 { 1 } else { 0 };
        let stream = rng_next(&mut rng) % 2 == 0;
        let latency = if failed {
            range(&mut rng, 200, 2500)
        } else {
            range(&mut rng, 1500, 9000)
        };
        let effort = pick(&mut rng, &["", "", "low", "medium", "high"]);
        let first_ms = range(&mut rng, 150, latency.max(200));
        // A streamed reply's decode window: first bytes partway in, so
        // w = latency - ttft stays over the 100ms floor.
        let ttft_ms = if !failed && stream {
            range(&mut rng, 100, 800)
        } else {
            0
        };
        // Some replies reason: their answer starts at first_text.
        let reasoning = if !failed && rng_next(&mut rng) % 4 == 0 {
            Some(range(&mut rng, 10, (output.max(11) - 10) as u64))
        } else {
            None
        };
        let first_text_ms = if reasoning.is_some() && stream {
            ttft_ms + range(&mut rng, 100, 1500)
        } else {
            0
        };

        let mut tries = vec![serde_json::json!({
            "provider": provider,
            "model": upstream,
            "key_slot": key_slot,
            "effort": effort,
            "status": if failed && i % 2 == 0 { "rate_limited" } else { status },
            "ms": latency,
            "first_ms": first_ms,
        })];
        if failed {
            tries[0]["rest_ms"] = serde_json::json!(60_000);
            tries.push(serde_json::json!({
                "provider": provider,
                "model": upstream,
                "key_slot": key_slot,
                "effort": effort,
                "status": status,
                "ms": range(&mut rng, 200, 1500),
                "first_ms": 0,
            }));
        }
        let mut usage = serde_json::json!({ "input": input, "output": output });
        if let Some(cached) = cache_read {
            usage["cache_read"] = serde_json::json!(cached);
        }
        if let Some(r) = reasoning {
            usage["reasoning"] = serde_json::json!(r);
        }
        let cost = magpie_router::prices::price_of(base_url, upstream).map(|p| {
            p.cost(
                input as u64,
                output.max(0) as u64,
                cache_read.unwrap_or(0),
                0,
            )
        });

        let body = serde_json::json!({
            "started_unix_ms": started,
            "client_protocol": protocol,
            "requested_model": requested,
            "provider": provider,
            "upstream_model": upstream,
            "key_slot": key_slot,
            "tries": tries,
            "stream": stream,
            "status": status,
            "error": if failed { status } else { "" },
            "latency_ms": latency,
            "ttft_ms": ttft_ms,
            "first_text_ms": first_text_ms,
            "usage": usage,
            "cost": cost,
        });
        store.append_request(started as i64, provider, status, input, output, &body)?;
    }

    // A few affinity sticks so the routing view has something to keep.
    let sticks = serde_json::json!({
        "dev/demo|conv-demo-1": {"who": "anthropic#a1b2c", "model": "claude-sonnet-4-5-20250514", "turn": 4, "at": now - 5 * 60 * 1000, "cacheRead": 4096},
        "dev/demo|conv-demo-2": {"who": "deepseek#d3e4f", "model": "deepseek-chat", "turn": 2, "at": now - 40 * 60 * 1000, "cacheRead": 2048},
        "dev/demo|conv-demo-3": {"who": "openai#9a8b7", "model": "gpt-4o-mini", "turn": 7, "at": now - 3 * 60 * 60 * 1000, "cacheRead": 1536},
    });
    store.set_affinity_snapshot(now as i64, &sticks)?;

    let recent = store.load_recent(1000)?;
    let ok = recent.iter().filter(|r| r["status"] == "ok").count();
    println!(
        "seeded {} requests ({} ok, {} failed) + {} affinity sticks into {}",
        recent.len(),
        ok,
        recent.len() - ok,
        sticks.as_object().map(|o| o.len()).unwrap_or(0),
        path.display(),
    );
    Ok(())
}
