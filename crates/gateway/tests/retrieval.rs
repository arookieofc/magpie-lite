//! `/v1/embeddings` and `/v1/rerank` are not chats: the body goes to the
//! model's provider untranslated at its base plus the endpoint path, the
//! model id swapped for the provider's own, and the answer comes back as
//! the vendor said it (the reference's `retrieve`, embeddings.go).

use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use magpie_gateway::{AppState, Config, Protocol, ProviderConfig, RoutingPolicy, build_router};
use serde_json::{Value, json};

#[derive(Clone)]
struct MockRetrieval {
    last: Arc<Mutex<Option<(String, Value)>>>,
}

async fn upstream_endpoint(
    State(mock): State<MockRetrieval>,
    axum::extract::Path(path): axum::extract::Path<String>,
    body: axum::body::Bytes,
) -> Json<Value> {
    let v: Value = serde_json::from_slice(&body).expect("upstream body is JSON");
    *mock.last.lock().unwrap() = Some((path.clone(), v.clone()));
    match path.as_str() {
        "embeddings" => Json(json!({
            "object": "list",
            "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2]}],
            "model": v["model"],
            "usage": {"prompt_tokens": 4, "total_tokens": 4}
        })),
        _ => Json(json!({
            "results": [{"index": 0, "relevance_score": 0.9}],
            "model": v["model"]
        })),
    }
}

async fn spawn_upstream() -> (String, Arc<Mutex<Option<(String, Value)>>>) {
    let last = Arc::new(Mutex::new(None));
    let app = Router::new()
        .route("/v1/{*path}", post(upstream_endpoint))
        .with_state(MockRetrieval { last: last.clone() });
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), last)
}

async fn spawn_gateway(upstream: String, embeddings: Vec<String>, rerankers: Vec<String>) -> String {
    let config = Config {
        port: 0,
        token: "magpie-lite".into(),
        key_cooldown_ms: 60_000,
        stream_first_content_timeout_ms: Config::default().stream_first_content_timeout_ms,
        stream_idle_timeout_ms: Config::default().stream_idle_timeout_ms,
        stream_progress_timeout_ms: Config::default().stream_progress_timeout_ms,
        stream_keepalive_interval_ms: Config::default().stream_keepalive_interval_ms,
        stream_keepalive_max_silence_ms: Config::default().stream_keepalive_max_silence_ms,
        stream_responses_hold_timeout_ms: Config::default().stream_responses_hold_timeout_ms,
        stream_loop_guard: Config::default().stream_loop_guard,
        history_path: None,
        default_provider: "mock".into(),
        hidden_auto_groups: Vec::new(),
        no_auto_groups: false,
        vision: None,
        provider: vec![ProviderConfig {
            id: "mock".into(),
            name: "Mock".into(),
            protocol: Protocol::Chat,
            capabilities: Default::default(),
            base_url: format!("{upstream}/v1"),
            api_key: "test-key".into(),
            api_keys: Vec::new(),
            models: vec!["mock-chat".into()],
            embeddings,
            rerankers,
            contexts: Default::default(),
            outputs: Default::default(),
            free_models: Vec::new(),
            fallback: Vec::new(),
            key_cooldown_ms: None,
            routing: RoutingPolicy::Rotate,
            weights: Vec::new(),
            affinity: Default::default(),
            max_concurrency: None,
            max_rpm: None,
            queue_limit: None,
            queue_wait_s: None,
            icon: String::new(),
            key_generation: 0,
            pin_upstream: false,
            key_limits: Vec::new(),
        }],
        group: Vec::new(),
    };
    let state = Arc::new(AppState {
        config: magpie_gateway::ConfigStore::new(config, None),
        http: magpie_gateway::upstream::http_client().unwrap(),
        requests: Arc::new(Mutex::new(magpie_gateway::usage::RequestLog::default())),
        key_rotation: magpie_gateway::KeyRotator::default(),
        affinity: magpie_gateway::AffinityStore::default(),
        lanes: magpie_gateway::lanes::Lanes::default(),
        rpms: magpie_gateway::lanes::Rpms::default(),
    });
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test]
async fn embeddings_passes_through_by_bare_and_qualified_id() {
    let (upstream, last) = spawn_upstream().await;
    let gw = spawn_gateway(upstream, vec!["text-embedding-3-small".into()], Vec::new()).await;

    for asked in ["text-embedding-3-small", "mock/text-embedding-3-small"] {
        let resp = reqwest::Client::new()
            .post(format!("{gw}/v1/embeddings"))
            .json(&json!({"model": asked, "input": "hi"}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200, "{}", resp.text().await.unwrap_or_default());
        let (path, sent) = last.lock().unwrap().clone().expect("upstream called");
        assert_eq!(path, "embeddings");
        assert_eq!(sent["model"], "text-embedding-3-small");
        assert_eq!(sent["input"], "hi");
    }
}

#[tokio::test]
async fn rerank_passes_through() {
    let (upstream, last) = spawn_upstream().await;
    let gw = spawn_gateway(upstream, Vec::new(), vec!["bge-reranker-v2-m3".into()]).await;

    let resp = reqwest::Client::new()
        .post(format!("{gw}/v1/rerank"))
        .json(&json!({"model": "bge-reranker-v2-m3", "query": "q", "documents": ["a", "b"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let (path, sent) = last.lock().unwrap().clone().expect("upstream called");
    assert_eq!(path, "rerank");
    assert_eq!(sent["model"], "bge-reranker-v2-m3");
}

#[tokio::test]
async fn unknown_and_chat_models_are_not_retrieval() {
    let (upstream, _) = spawn_upstream().await;
    let gw = spawn_gateway(upstream, vec!["emb-1".into()], Vec::new()).await;

    // A chat model must not route to /v1/embeddings, and an embedding
    // model must not route to /v1/rerank.
    for (path, model) in [
        ("embeddings", "mock-chat"),
        ("rerank", "emb-1"),
        ("embeddings", "nope"),
    ] {
        let resp = reqwest::Client::new()
            .post(format!("{gw}/v1/{path}"))
            .json(&json!({"model": model}))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404, "{path} {model}");
    }
}
