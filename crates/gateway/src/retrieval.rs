//! `/v1/embeddings` and `/v1/rerank`: retrieval calls that are not
//! chats, so nothing is translated — the body goes to the model's
//! provider at its base URL plus the endpoint path as the agent sent it,
//! the model id swapped for the provider's own, and the vendor's answer
//! comes back as it said it (the reference's `retrieve`,
//! `internal/gateway/embeddings.go`).

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures::StreamExt as _;
use serde_json::{Value, json};

use magpie_router::serves::Serves;

use crate::config::ProviderConfig;
use crate::server::AppState;
use crate::upstream;

/// A vendor answers one embedding in seconds; a long rerank batch takes
/// a minute or two (the reference's `retrieveTimeout`).
const RETRIEVE_TIMEOUT: Duration = Duration::from_secs(180);
/// The largest retrieval answer passed on: big enough for a full batch,
/// bounded so a dishonest upstream cannot stream forever.
const ANSWER_LIMIT: usize = 256 * 1024 * 1024;

fn error(status: StatusCode, message: &str) -> Response {
    let wire = reqwest::StatusCode::from_u16(status.as_u16())
        .unwrap_or(reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    (status, axum::Json(upstream::chat_error(wire, message))).into_response()
}

/// Serve `POST /v1/embeddings`: OpenAI's embedding shape forwarded to
/// the provider that lists the asked model among `embeddings`.
pub async fn embeddings(state: State<Arc<AppState>>, body: Bytes) -> Response {
    retrieve(state, body, Serves::Embedding, "/embeddings").await
}

/// Serve `POST /v1/rerank`: the Cohere/Jina/Voyage-shared shape
/// forwarded to the provider that lists the asked model among
/// `rerankers`.
pub async fn rerank(state: State<Arc<AppState>>, body: Bytes) -> Response {
    retrieve(state, body, Serves::Rerank, "/rerank").await
}

async fn retrieve(
    State(state): State<Arc<AppState>>,
    body: Bytes,
    kind: Serves,
    path: &str,
) -> Response {
    let mut request: Value = match serde_json::from_slice(&body) {
        Ok(value @ Value::Object(_)) => value,
        _ => return error(StatusCode::BAD_REQUEST, "the body isn't a JSON object"),
    };
    let asked = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if asked.is_empty() {
        return error(
            StatusCode::BAD_REQUEST,
            "name the model: \"model\" is a magpie model id, as /v1/models lists them",
        );
    }
    let config = state.config.current();
    let Some((provider, model)) = config.resolve_retrieval(&asked, kind) else {
        let what = match kind {
            Serves::Embedding => "an embedding",
            Serves::Rerank => "a rerank",
            _ => "a retrieval",
        };
        return error(
            StatusCode::NOT_FOUND,
            &format!("no provider lists {asked} as {what} model"),
        );
    };
    let provider: ProviderConfig = provider.clone();

    // The vendor is asked for the model's own id: `provider/model` and
    // bare names alike resolve to the configured upstream spelling.
    request["model"] = json!(model);

    // A provider's key pool spreads the call as a chat's does, first
    // healthy key first, the rest failover (the reference's `onKeys`).
    let rotated = state.key_rotation.rotate(
        &provider.id,
        provider.key_generation,
        &provider.api_key_pool(),
    );
    let keys: Vec<String> = if rotated.is_empty() {
        vec![String::new()]
    } else {
        rotated.into_iter().map(|(_, key)| key).collect()
    };

    let base = provider.base_url.trim_end_matches('/');
    let url = format!("{base}{path}");

    let mut last_status = StatusCode::BAD_GATEWAY;
    let mut last_body: Vec<u8> = Vec::new();
    for (index, api_key) in keys.iter().enumerate() {
        let last = index + 1 == keys.len();
        let result = tokio::time::timeout(
            RETRIEVE_TIMEOUT,
            send(&state.http, &provider, api_key, &url, &request),
        )
        .await;
        let response = match result {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => {
                last_status = StatusCode::BAD_GATEWAY;
                last_body = format!("could not reach {base}").into_bytes();
                if last {
                    break;
                }
                continue;
            }
        };
        last_status = response.status();
        // A successful answer, or one the vendor meant for this caller
        // (a bad request, a missing model), comes back as it came; only a
        // key's own refusal — auth, quota, rate limit — tries the next.
        let retry = matches!(
            last_status.as_u16(),
            401 | 402 | 403 | 429 | 500 | 502 | 503 | 504
        );
        let bytes = match read_bounded(response).await {
            Ok(bytes) => bytes,
            Err(message) => return error(StatusCode::BAD_GATEWAY, &message),
        };
        if retry && !last {
            last_body = bytes;
            continue;
        }
        return reply(last_status, bytes);
    }
    reply(last_status, last_body)
}

fn reply(status: StatusCode, body: Vec<u8>) -> Response {
    (
        status,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
        .into_response()
}

/// POST `request` to `url` as the provider signs its OpenAI-style calls:
/// Bearer for chat/responses providers, `x-api-key` for Anthropic-shaped
/// ones, `x-goog-api-key` for Gemini hosts.
async fn send(
    http: &reqwest::Client,
    provider: &ProviderConfig,
    api_key: &str,
    url: &str,
    request: &Value,
) -> anyhow::Result<reqwest::Response> {
    let req = upstream::authenticate(http.post(url), provider.protocol, api_key);
    Ok(req.json(request).send().await?)
}

/// Read an answer bounded: `remaining` counts down per chunk so a
/// missing or dishonest Content-Length cannot grow it.
async fn read_bounded(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > ANSWER_LIMIT as u64)
    {
        return Err("provider response exceeded the retrieval size limit".to_owned());
    }
    let mut remaining = ANSWER_LIMIT;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "provider answer was cut off".to_owned())?;
        if chunk.len() > remaining {
            return Err("provider response exceeded the retrieval size limit".to_owned());
        }
        remaining -= chunk.len();
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
