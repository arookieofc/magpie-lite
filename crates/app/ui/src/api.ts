let localToken = "";
let onUnauthorized: (() => void) | undefined;

export function setLocalToken(value: string): void {
  localToken = value;
}

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function request<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(localToken ? { authorization: `Bearer ${localToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await response.text();
  let payload: T & { error?: { message?: string } };
  try {
    payload = JSON.parse(text) as T & { error?: { message?: string } };
  } catch {
    payload = text as T & { error?: { message?: string } };
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    const message = (payload as { error?: { message?: string } })?.error?.message
      ?? `Request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export const get = <T = unknown>(path: string) => request<T>(path);
export const post = <T = unknown>(path: string, body?: unknown) => request<T>(path, "POST", body);
export const put = <T = unknown>(path: string, body?: unknown) => request<T>(path, "PUT", body);
export const del = <T = unknown>(path: string) => request<T>(path, "DELETE");

export async function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
}
