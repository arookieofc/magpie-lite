# Magpie Lite frontend

This is a standalone React + TypeScript frontend. It does not bundle or start
the Rust gateway and does not use Tauri. The browser talks to the gateway HTTP
API directly; development requests are proxied by Vite.

## Run locally

```sh
cd crates/app
npm install
npm run dev
# In another terminal, from the repository root:
cargo run -p magpie-lite -- serve

# Production static build:
npm run build
```

`npm run build` writes `ui/dist`. Host that directory as static files and
configure the static host or reverse proxy to forward the API paths to the
gateway. During development, set `MAGPIE_GATEWAY_URL` to override the default
`http://127.0.0.1:3426` API target.

## Layout

- `ui/src` — React + TypeScript console
- `ui/src/console.css` — frontend styles
