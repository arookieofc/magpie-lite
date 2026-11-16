//! Console icon helpers: the Add sheet's Get-icon menu fetches a site's
//! own mark or validates a pasted image address server-side, so the
//! console never needs cross-origin fetches and stored providers keep a
//! small validated `data:` URL instead of an arbitrary remote link.
//!
//! Shapes mirror the reference console: success is `{icon}`, a usable
//! picture that fell through is `{icon: "", failed}` with HTTP 200, and
//! only malformed requests are HTTP 400.

use std::time::Duration;

use axum::Json;
use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use serde::Deserialize;

/// Stored icons stay small: a provider row embeds the mark in its config
/// JSON, so anything larger falls back to the letter avatar.
pub const MAX_ICON_BYTES: usize = 200 * 1024;

#[derive(Deserialize)]
struct UploadInput {
    #[serde(default)]
    data: String,
}

#[derive(Deserialize)]
struct FaviconInput {
    #[serde(default)]
    url: String,
    #[serde(default)]
    #[allow(dead_code)]
    name: String,
}

#[derive(Deserialize)]
struct UrlInput {
    #[serde(default)]
    url: String,
    #[serde(default)]
    #[allow(dead_code)]
    base: String,
    #[serde(default)]
    #[allow(dead_code)]
    name: String,
}

fn ok(icon: String) -> Response {
    Json(serde_json::json!({ "icon": icon })).into_response()
}

fn fell_back(why: &str) -> Response {
    Json(serde_json::json!({ "icon": "", "failed": why })).into_response()
}

fn bad(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": { "message": message } })))
        .into_response()
}

/// Sniff an image format from magic bytes; SVG is text, so look for its
/// opening tag in the head instead.
pub fn sniff_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some("image/png");
    }
    if bytes.len() >= 3 && bytes[..3] == [0xFF, 0xD8, 0xFF] {
        return Some("image/jpeg");
    }
    if bytes.len() >= 6 && (bytes[..6] == *b"GIF87a" || bytes[..6] == *b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12
        && bytes[..4] == *b"RIFF"
        && bytes[8..12] == *b"WEBP"
    {
        return Some("image/webp");
    }
    if bytes.len() >= 4 && bytes[..4] == [0x00, 0x00, 0x01, 0x00] {
        return Some("image/x-icon");
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
    let head = head.trim_start();
    if head.starts_with("<svg") || head.starts_with("<?xml") && head.contains("<svg") {
        return Some("image/svg+xml");
    }
    None
}

pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn validated(bytes: Vec<u8>) -> Result<String, &'static str> {
    if bytes.is_empty() {
        return Err("the picture was empty");
    }
    if bytes.len() > MAX_ICON_BYTES {
        return Err("the picture is larger than 200 KiB");
    }
    match sniff_mime(&bytes) {
        Some(mime) => Ok(data_url(mime, &bytes)),
        None => Err("that file is not a PNG, JPEG, GIF, WebP, ICO or SVG picture"),
    }
}

/// `true` for loopback hosts, where plain `http:` icon fetches are safe
/// (Ollama, LM Studio and friends serve no TLS).
pub fn is_loopback(host: &str) -> bool {
    let host = host.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).unwrap_or(host);
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn allow_url(raw: &str) -> Result<reqwest::Url, &'static str> {
    let url = reqwest::Url::parse(raw).map_err(|_| "that address is not a valid URL")?;
    match url.scheme() {
        "https" => Ok(url),
        "http" if url.host_str().is_some_and(is_loopback) => Ok(url),
        _ => Err("icons are fetched from public https addresses"),
    }
}

fn http() -> Result<reqwest::Client, Response> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| bad("could not create icon HTTP client"))
}

async fn get_bytes(http: &reqwest::Client, url: &reqwest::Url) -> Result<Vec<u8>, &'static str> {
    let response = http
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "image/*")
        .send()
        .await
        .map_err(|_| "that address could not be reached")?;
    if !response.status().is_success() {
        return Err("that address could not be reached");
    }
    if let Some(length) = response.content_length() {
        if length > MAX_ICON_BYTES as u64 {
            return Err("the picture is larger than 200 KiB");
        }
    }
    let mut bytes = Vec::new();
    let mut body = response;
    while let Some(chunk) = body.chunk().await.map_err(|_| "that address could not be reached")? {
        if bytes.len() + chunk.len() > MAX_ICON_BYTES {
            return Err("the picture is larger than 200 KiB");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Where a site's own mark may live: the conventional files first, then
/// whatever the homepage's `<link rel="icon">` points at.
pub fn favicon_candidates(origin: &str, link_href: Option<&str>) -> Vec<String> {
    let mut out = vec![
        format!("{origin}/favicon.ico"),
        format!("{origin}/favicon.svg"),
        format!("{origin}/apple-touch-icon.png"),
    ];
    if let Some(href) = link_href.filter(|href| !href.is_empty()) {
        if !out.contains(&href.to_owned()) {
            out.push(href.to_owned());
        }
    }
    out
}

fn link_icon(html: &[u8], origin: &str) -> Option<String> {
    let text = String::from_utf8_lossy(&html[..html.len().min(64 * 1024)]);
    let mut search = text.as_ref();
    // `<link rel="apple-touch-icon" href="...">` or `rel="icon"`: take
    // the first href on a link tag naming an icon.
    while let Some(start) = search.find("<link") {
        let rest = &search[start..];
        let tag_end = rest.find('>')?;
        let href = href_of(&rest[..tag_end]).map(|href| href.trim().to_owned());
        search = &rest[tag_end + 1..];
        if let Some(href) = href.filter(|_| rest[..tag_end].to_lowercase().contains("icon")) {
            if href.is_empty() {
                break;
            }
            if href.starts_with("data:") {
                return None;
            }
            if href.starts_with("http://") || href.starts_with("https://") {
                return Some(href);
            }
            if let Some(url) = origin.strip_suffix('/').or(Some(origin)) {
                let path = href.strip_prefix('/').unwrap_or(&href);
                return Some(format!("{url}/{path}"));
            }
            break;
        }
    }
    None
}

fn href_of(tag: &str) -> Option<&str> {
    let mut search = tag;
    while let Some(at) = search.find("href") {
        let rest = search[at + 4..].trim_start_matches([' ', '\t', '\n', '=']);
        let quote = rest.as_bytes().first()?;
        if *quote == b'"' || *quote == b'\'' {
            let rest = &rest[1..];
            let end = rest.find(*quote as char)?;
            return Some(&rest[..end]);
        }
        search = &search[at + 4..];
    }
    None
}

/// POST `/config/icons` — validate a file-picker upload (base64 bytes)
/// and hand back a `data:` URL for the draft.
pub async fn upload(bytes: Bytes) -> Response {
    let input: UploadInput = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => return bad("expected icon JSON with base64 data"),
    };
    // Accept a bare base64 body or a full `data:…;base64,…` URL.
    let encoded = input.data.split(',').next_back().unwrap_or("");
    if encoded.trim().is_empty() {
        return bad("expected icon JSON with base64 data");
    }
    let raw = match base64::engine::general_purpose::STANDARD.decode(encoded.trim()) {
        Ok(raw) => raw,
        Err(_) => return bad("that picture could not be read"),
    };
    match validated(raw) {
        Ok(icon) => ok(icon),
        Err(why) => bad(why),
    }
}

/// POST `/config/icons/url` — fetch a pasted image address server-side,
/// validate it, and hand back a `data:` URL for the draft.
pub async fn url_icon(bytes: Bytes) -> Response {
    let input: UrlInput = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => return bad("expected icon JSON with a url"),
    };
    let target = input.url.trim();
    if target.is_empty() {
        return bad("expected icon JSON with a url");
    }
    let url = match allow_url(target) {
        Ok(url) => url,
        Err(why) => return fell_back(why),
    };
    let http = match http() {
        Ok(http) => http,
        Err(response) => return response,
    };
    let bytes = match get_bytes(&http, &url).await {
        Ok(bytes) => bytes,
        Err(why) => return fell_back(why),
    };
    match validated(bytes) {
        Ok(icon) => ok(icon),
        Err(why) => fell_back(why),
    }
}

/// POST `/config/icons/favicon` — look for a site's own mark starting
/// from a provider base URL and hand back a `data:` URL for the draft.
pub async fn favicon(bytes: Bytes) -> Response {
    let input: FaviconInput = match serde_json::from_slice(&bytes) {
        Ok(input) => input,
        Err(_) => return bad("expected icon JSON with a url"),
    };
    let base = input.url.trim();
    if base.is_empty() {
        return fell_back("add a Base URL first");
    }
    let parsed = match reqwest::Url::parse(base) {
        Ok(parsed) => parsed,
        Err(_) => return fell_back("that Base URL is not a valid URL"),
    };
    if !matches!(parsed.scheme(), "http" | "https") {
        return fell_back("that Base URL is not a valid URL");
    }
    let origin = format!(
        "{}://{}",
        parsed.scheme(),
        parsed.host_str().unwrap_or_default()
    );
    let origin = match parsed.port() {
        Some(port) => format!("{origin}:{port}"),
        None => origin,
    };
    let http = match http() {
        Ok(http) => http,
        Err(response) => return response,
    };
    // The homepage's `<link rel="icon">` wins when present; the
    // conventional files are the fallback.
    let mut link = None;
    if let Ok(home) = reqwest::Url::parse(&format!("{origin}/")) {
        if let Ok(html) = get_bytes(&http, &home).await {
            link = link_icon(&html, &origin);
        }
    }
    for candidate in favicon_candidates(&origin, link.as_deref()) {
        let Ok(url) = reqwest::Url::parse(&candidate) else {
            continue;
        };
        let Ok(bytes) = get_bytes(&http, &url).await else {
            continue;
        };
        if let Ok(icon) = validated(bytes) {
            return ok(icon);
        }
    }
    fell_back("no usable mark was found on that site")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffing_names_common_picture_formats() {
        assert_eq!(
            sniff_mime(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            Some("image/png")
        );
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF, 0x00]), Some("image/jpeg"));
        assert_eq!(sniff_mime(b"GIF89a..."), Some("image/gif"));
        let mut webp = b"RIFF____WEBP".to_vec();
        webp[4..8].copy_from_slice(&[0, 0, 0, 0]);
        assert_eq!(sniff_mime(&webp), Some("image/webp"));
        assert_eq!(sniff_mime(&[0x00, 0x00, 0x01, 0x00]), Some("image/x-icon"));
        assert_eq!(
            sniff_mime(b"<?xml version=\"1.0\"?><svg xmlns=\"x\"></svg>"),
            Some("image/svg+xml")
        );
        assert_eq!(sniff_mime(b"<svg xmlns=\"x\"></svg>"), Some("image/svg+xml"));
        assert_eq!(sniff_mime(b"hello"), None);
    }

    #[test]
    fn oversized_and_unknown_pictures_are_rejected() {
        assert_eq!(
            validated(vec![0u8; MAX_ICON_BYTES + 1]).unwrap_err(),
            "the picture is larger than 200 KiB"
        );
        assert_eq!(
            validated(b"not a picture".to_vec()).unwrap_err(),
            "that file is not a PNG, JPEG, GIF, WebP, ICO or SVG picture"
        );
    }

    #[test]
    fn favicon_tries_conventional_files_then_the_page_link() {
        let candidates = favicon_candidates("https://api.example.com", Some("https://cdn.example.com/mark.png"));
        assert_eq!(
            candidates,
            vec![
                "https://api.example.com/favicon.ico",
                "https://api.example.com/favicon.svg",
                "https://api.example.com/apple-touch-icon.png",
                "https://cdn.example.com/mark.png",
            ]
        );
    }

    #[test]
    fn page_link_icons_resolve_against_the_origin() {
        let html = br#"<html><head><link rel="icon" href="/assets/mark.svg"></head></html>"#;
        assert_eq!(
            link_icon(html, "https://api.example.com"),
            Some("https://api.example.com/assets/mark.svg".to_owned())
        );
        let html = br#"<html><head><link rel="stylesheet" href="/x.css"><link rel="apple-touch-icon" href="https://cdn.example.com/touch.png"></head></html>"#;
        assert_eq!(
            link_icon(html, "https://api.example.com"),
            Some("https://cdn.example.com/touch.png".to_owned())
        );
    }

    #[test]
    fn loopback_hosts_keep_plain_http() {
        assert!(is_loopback("localhost"));
        assert!(is_loopback("127.0.0.1"));
        assert!(is_loopback("[::1]"));
        assert!(!is_loopback("api.example.com"));
        assert!(allow_url("http://localhost:11434/v1").is_ok());
        assert!(allow_url("http://api.example.com/v1").is_err());
        assert!(allow_url("https://api.example.com/v1").is_ok());
    }

    /// The full auto-icon flow against a loopback origin: the homepage's
    /// `<link rel="icon">` resolves, conventional misses fall through,
    /// and the draft gets a validated `data:` URL back.
    #[tokio::test]
    async fn favicon_flows_from_homepage_link_to_data_url() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mark = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02];
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for _ in 0..8 {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while head.len() < 4096 {
                    if stream.read_exact(&mut byte).await.is_err() {
                        break;
                    }
                    head.extend_from_slice(&byte);
                    if head.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let path = String::from_utf8_lossy(&head)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_owned();
                let (status, body) = match path.as_str() {
                    "/" => (
                        "200 OK",
                        b"<html><head><link rel=\"icon\" href=\"/mark.png\"></head></html>".to_vec(),
                    ),
                    "/mark.png" => ("200 OK", mark.clone()),
                    _ => ("404 Not Found", Vec::new()),
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if stream.write_all(response.as_bytes()).await.is_err() {
                    break;
                }
                if stream.write_all(&body).await.is_err() {
                    break;
                }
            }
        });
        let payload =
            Bytes::from(format!("{{\"url\":\"http://127.0.0.1:{port}/v1\"}}"));
        let body = axum::body::to_bytes(favicon(payload).await.into_body(), 1_000_000)
            .await
            .unwrap();
        server.abort();
        let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(
            value
                .get("icon")
                .and_then(|icon| icon.as_str())
                .is_some_and(|icon| icon.starts_with("data:image/png;base64,")),
            "unexpected favicon reply: {value}"
        );
    }
}
