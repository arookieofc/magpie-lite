# magpie-lite desktop app

The app starts the gateway on loopback and opens the React console in a Tauri
window. The page talks to the gateway through the `gateway_request` command, so
it never needs a second origin or a token.

## Run locally

```sh
cd crates/app
npm install
npm run build
cargo run -p magpie-app
```

`npm run build` writes `ui/dist`, which Tauri embeds at compile time. Re-run it
after changing anything under `ui/src`.

## Layout

- `src/main.rs` — gateway startup, window creation, loopback request bridge
- `ui/src` — React + TypeScript console
- `ui/src/console.css` — styling shared with the gateway console
