//! magpie-app: the Tauri shell that runs magpie-lite's gateway and opens
//! its console in one desktop window — one binary, no browser needed.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;
use std::sync::Mutex;

use magpie_router::Config;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The gateway's bound loopback port, so the page's requests go through
/// the shell to it (a webview on the app's own scheme cannot fetch
/// another origin directly).
struct Gateway {
    client: reqwest::Client,
    port: u16,
}

/// Forward one console request to the embedded gateway and hand back
/// status and body, so the React console stays on the app's scheme.
#[tauri::command]
async fn gateway_request(
    state: tauri::State<'_, Mutex<Gateway>>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let (client, port) = {
        let gateway = state.lock().map_err(|_| "gateway state is poisoned")?;
        (gateway.client.clone(), gateway.port)
    };
    let url = format!("http://127.0.0.1:{port}{path}");
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("bad method {method}"))?;
    let mut request = client.request(method, url);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    let body: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::Value::String(text));
    Ok(serde_json::json!({ "status": status, "body": body }))
}

/// Open an https URL in the system browser, so the console's key links
/// never navigate the app webview itself. Only plain https pages open;
/// anything else is rejected before reaching the OS launcher.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let url = url.trim().to_owned();
    let parsed = reqwest::Url::parse(&url).map_err(|_| "only https links can open")?;
    if parsed.scheme() != "https" || !parsed.has_host() {
        return Err("only https links can open".to_owned());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() -> anyhow::Result<()> {
    // The gateway gets its own runtime: Tauri's main thread stays free
    // for the window, and axum's serving never blocks the UI.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("magpie-gateway")
        .build()?;

    let config_path = magpie_router::config::config_path()?;
    let config = Config::load(&config_path)?;

    // Bind the loopback port first so the window can be pointed at the
    // real address — port 0 lets the OS pick when the configured port is
    // held by another magpie.
    let requested = config.port;
    let listener = std::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], requested)))
        .or_else(|_| {
            std::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        })?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();

    let (bound_tx, bound_rx) = tokio::sync::oneshot::channel::<SocketAddr>();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let config_for_serve = config.clone();
    let config_path_for_serve = config_path.clone();
    runtime.spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener)
            .expect("loopback listener transfers to tokio");
        if let Err(error) = magpie_gateway::serve_on_listener(
            config_for_serve,
            listener,
            Some(config_path_for_serve),
            None,
            bound_tx,
            async move {
                let _ = shutdown_rx.await;
            },
        )
        .await
        {
            eprintln!("gateway stopped: {error}");
        }
    });

    let bound = runtime.block_on(bound_rx);
    let port = bound.map(|addr| addr.port()).unwrap_or(port);

    let shutdown_tx = Mutex::new(Some(shutdown_tx));
    let app = tauri::Builder::default()
        .manage(Mutex::new(Gateway {
            client: reqwest::Client::new(),
            port,
        }))
        .invoke_handler(tauri::generate_handler![gateway_request, open_url])
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("magpie-lite")
            .inner_size(1280.0, 860.0)
            .min_inner_size(960.0, 640.0)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())?;

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            // Window's gone: stop the gateway so the process exits clean
            // instead of holding a listener nobody reaches.
            if let Ok(mut slot) = shutdown_tx.lock()
                && let Some(tx) = slot.take()
            {
                let _ = tx.send(());
            }
        }
    });
    Ok(())
}
