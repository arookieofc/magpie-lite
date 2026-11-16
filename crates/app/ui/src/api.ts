// The webview sits on the app's own scheme, so calls to the embedded
// gateway go through the shell's `gateway_request` command, which
// forwards them to the loopback axum server and hands back status and
// body — the console never sees an origin it cannot reach.

declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
  }
}

export async function request<T = unknown>(
  path: string,
  method: string = "GET",
  body?: unknown,
): Promise<T> {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("The app shell is not available.");
  const res = (await invoke("gateway_request", {
    method,
    path,
    body: body === undefined ? null : body,
  })) as { status: number; body: T & { error?: { message?: string } } };
  if (res.status < 200 || res.status >= 300) {
    const message = res.body?.error?.message ?? `Request failed (HTTP ${res.status}).`;
    throw new Error(message);
  }
  return res.body;
}

export const get = <T = unknown>(path: string) => request<T>(path, "GET");
export const post = <T = unknown>(path: string, body?: unknown) => request<T>(path, "POST", body);
export const put = <T = unknown>(path: string, body?: unknown) => request<T>(path, "PUT", body);
export const del = <T = unknown>(path: string) => request<T>(path, "DELETE");

// Key-portal links leave the console: inside the shell they go through
// the `open_url` command to the system browser, so the app webview
// itself never navigates away. In dev browsers there is no shell, so a
// plain new tab does the same job.
export async function openExternal(url: string): Promise<void> {
  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    await invoke("open_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
