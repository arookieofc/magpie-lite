//! magpie-app: the Tauri shell that runs magpie-lite's gateway and opens
//! its console in one desktop window — one binary, no browser needed.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;
use std::sync::Mutex;

use magpie_router::Config;
use tauri::{WebviewUrl, WebviewWindowBuilder};

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
        .setup(move |app| {
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(
                    format!("http://127.0.0.1:{port}/ui")
                        .parse()
                        .expect("loopback url parses"),
                ),
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
