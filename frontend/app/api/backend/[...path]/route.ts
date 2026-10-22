import { NextRequest, NextResponse } from "next/server";
import {createHmac} from "node:crypto";
import {apiOrigin, deploymentMode, requestOrigin, trustedVercelClientIp} from "@/lib/local-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32_768;
const PHOTO_BODY_BYTES = 13 * 1024 * 1024;
const CLOUD_BODY_BYTES = 3.5 * 1024 * 1024;
const SESSION_COOKIE = "yokohama_session";
const routes: Record<string, RegExp[]> = {
  GET: [/^vehicles$/, /^vehicles\/[1-9]\d*$/, /^vehicles\/[1-9]\d*\/(plan|incidents|odometer-evidence|evidence|documents|administration-history)$/, /^fleet-statistics$/, /^calendar$/, /^alerts$/, /^document-alerts$/, /^incidents$/, /^evidence\/[0-9a-f-]{36}$/, /^catalog$/, /^variants$/, /^notifications$/, /^metrics$/, /^auth\/(status|me)$/, /^users$/],
  POST: [/^vehicles$/, /^vehicles\/[1-9]\d*\/(readings|services|faults|downtime|appointments|incidents|odometer-evidence|odometer-captures|evidence|documents)$/, /^vehicles\/[1-9]\d*\/(readings|services)\/batch$/, /^recalculate$/, /^auth\/(setup|login|logout|password)$/, /^users$/],
  PATCH: [/^faults\/[1-9]\d*\/resolve$/, /^vehicles\/[1-9]\d*$/, /^vehicles\/[1-9]\d*\/administration$/, /^vehicles\/[1-9]\d*\/downtime\/[1-9]\d*$/, /^vehicles\/[1-9]\d*\/appointments\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, /^incidents\/[0-9a-f-]{36}$/, /^users\/[1-9]\d*$/]
};
function error(detail: string, status: number) { return NextResponse.json({detail}, {status, headers: {"Cache-Control": "no-store"}}); }

// Never log the exception, URL, headers, key or payload. Allowlist transport codes only.
function transportCode(cause: unknown): string {
  const failure = cause as {name?: string; code?: unknown; cause?: {code?: unknown}} | null;
  if (failure?.name === "TimeoutError") return "REQUEST_TIMEOUT";
  if (failure?.name === "AbortError") return "REQUEST_ABORTED";
  const code = failure?.cause?.code ?? failure?.code;
  const allowed = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_ABORTED"]);
  return typeof code === "string" && allowed.has(code) ? code : "TRANSPORT_ERROR";
}

async function fetchUpstream(url: URL, options: RequestInit): Promise<Response> {
  const method = options.method || "GET";
  try { return await fetch(url, options); }
  catch (cause) {
    console.warn(`[yokohama-proxy] ${method} ${transportCode(cause)}`);
    // GET alone is safe to repeat after a dropped socket. HTTP errors and
    // parsing failures are outside this catch; mutations must never be replayed.
    if (method !== "GET" || options.signal?.aborted) throw cause;
    try { return await fetch(url, options); }
    catch (retryCause) {
      console.warn(`[yokohama-proxy] ${method} ${transportCode(retryCause)}`);
      throw retryCause;
    }
  }
}

async function forward(request: NextRequest, context: {params: Promise<{path: string[]}>}) {
  if (process.env.NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE === "true") return error("La propuesta no utiliza la API privada.", 404);
  const mode = deploymentMode();
  const origin = requestOrigin(request.headers);
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return error("Acceso reservado al panel autorizado.", 403);
  const method = request.method;
  if (method !== "GET" && request.headers.get("origin") !== origin) return error("La operación debe originarse en este panel.", 403);
  const {path} = await context.params;
  const route = path.join("/");
  if (!(routes[method] || []).some(pattern => pattern.test(route))) return error("Ruta no permitida.", 404);
  if (mode === "cloud" && route === "auth/setup") return error("Ruta no permitida.", 404);
  const localBodyLimit = /^(?:vehicles\/[1-9]\d*\/(?:incidents|odometer-evidence|odometer-captures|evidence|documents|faults|services(?:\/batch)?|downtime(?:\/[1-9]\d*)?)|incidents\/[0-9a-f-]{36}|faults\/[1-9]\d*\/resolve)$/.test(route) ? PHOTO_BODY_BYTES : /^vehicles\/[1-9]\d*\/readings\/batch$/.test(route) ? 262_144 : MAX_BODY_BYTES;
  const bodyLimit = mode === "cloud" ? Math.min(localBodyLimit, CLOUD_BODY_BYTES) : localBodyLimit;
  const key = process.env.YOKOHAMA_API_KEY;
  if (!key?.trim() || !process.env.YOKOHAMA_API_URL) return error("Configura YOKOHAMA_API_URL y YOKOHAMA_API_KEY en el servidor del panel.", 503);
  const upstream = apiOrigin();
  if (!upstream) return error(mode === "cloud" ? "Configura una API HTTPS privada y un origen público autorizado, sin rutas ni credenciales en sus direcciones." : "La API local debe usar una dirección HTTP loopback sin rutas ni credenciales.", 503);
  upstream.pathname = `/api/${route}`;
  if (route === "calendar") {
    for (const name of ["start", "end"]) {
      const value = request.nextUrl.searchParams.get(name);
      if (value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return error("Fechas de calendario inválidas.", 400);
        upstream.searchParams.set(name, value);
      }
    }
  }
  if (route === "metrics") {
    const synthetic = request.nextUrl.searchParams.get("synthetic");
    if (synthetic !== null) {
      if (!["true", "false", "null"].includes(synthetic)) return error("Filtro de métricas inválido.", 400);
      upstream.searchParams.set("synthetic", synthetic);
    }
  }
  let body: string | undefined;
  if (method !== "GET") {
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return error("Se requiere contenido JSON.", 415);
    if (Number(request.headers.get("content-length")) > bodyLimit) return error("El formulario excede el tamaño permitido.", 413);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader) {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > bodyLimit) { await reader.cancel(); return error("El formulario excede el tamaño permitido.", 413); }
          chunks.push(next.value);
        }
      }
    } catch {return error("No se pudo leer el formulario completo.", 400);}
    body = Buffer.concat(chunks).toString("utf8");
    try { JSON.parse(body); } catch { return error("JSON inválido.", 400); }
  }
  try {
    // One timeout budget is shared by the initial GET and its optional retry.
    const headers: Record<string, string> = {"X-API-Key": key, "Content-Type": "application/json", "Accept": "application/json"};
    // Only our HttpOnly cookie supplies the person session. Never trust a token
    // header or a role/identity supplied by browser JavaScript.
    const session = request.cookies.get(SESSION_COOKIE)?.value;
    if (session && /^[A-Za-z0-9_-]{32,128}$/.test(session)) headers["X-Session-Token"] = session;
    const clientIp = trustedVercelClientIp(request.headers);
    if (clientIp) headers["X-Trusted-Client"] = createHmac("sha256", key).update(clientIp).digest("hex");
    const response = await fetchUpstream(upstream, {
      method, headers,
      body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000)
    });
    if (response.headers.get("X-Auth-Error") === "api-key") return error("La clave del panel no coincide con la API. Revisa la configuración del servidor.", 503);
    if (response.status >= 500) return error("La API no pudo completar la operación. Revisa sus registros privados.", 502);
    const data = await response.json();
    const login = response.ok && ["auth/login", "auth/setup"].includes(route);
    let sessionToken: string | undefined;
    let expires: Date | undefined;
    if (login) {
      sessionToken = data.session_token;
      expires = new Date(data.expires_at);
      if (!sessionToken || !/^[A-Za-z0-9_-]{32,128}$/.test(sessionToken) || !Number.isFinite(expires.getTime()) || expires.getTime() <= Date.now()) return error("La API no devolvió una sesión válida.", 502);
      delete data.session_token;
    }
    const result = NextResponse.json(data, {status: response.status, headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
    // Cloud is HTTPS externally even when Next receives an internal HTTP URL.
    const secure = mode === "cloud" || request.nextUrl.protocol === "https:";
    if (login && sessionToken && expires) result.cookies.set(SESSION_COOKIE, sessionToken, {httpOnly: true, sameSite: "strict", secure, path: "/", expires, priority: "high"});
    if ((response.ok && ["auth/logout", "auth/password"].includes(route)) || (response.status === 401 && !["auth/login", "auth/setup"].includes(route))) result.cookies.set(SESSION_COOKIE, "", {httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 0});
    return result;
  } catch { return error("No se pudo conectar con la API. Comprueba la disponibilidad del servidor privado.", 502); }
}
export {forward as GET, forward as POST, forward as PATCH};
