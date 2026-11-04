export const API_URL =
  import.meta.env.PUBLIC_API_URL ?? "http://localhost:3000";

export async function api<T>(
  path: string,
  init: RequestInit = {},
  cookie?: string,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  });
  return readApi<T>(res, path);
}

/** Lee una respuesta de la API sin reventar si el cuerpo no es JSON. */
export async function readApi<T>(res: Response, path: string): Promise<T> {
  const text = await res.text();
  let json: { success: boolean; data?: T; error?: string } | null = null;
  try {
    json = text ? (JSON.parse(text) as typeof json) : null;
  } catch {
    throw new Error(
      `La API devolvió una respuesta no-JSON en ${path} (HTTP ${res.status}). ¿Está la API en marcha?`,
    );
  }
  if (!res.ok || !json?.success) {
    const err = new Error(json?.error ?? `Error ${res.status} en ${path}`);
    (err as unknown as { status?: number }).status = res.status;
    throw err;
  }
  return json.data as T;
}

/** GET autenticado para páginas SSR: propaga la cookie del navegador a la API. */
export async function apiGet<T>(path: string, cookie: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: cookie ? { cookie } : {},
  });
  return readApi<T>(res, path);
}

export function getCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1];
}

export function fmtPrice(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
