import {expect, test} from "@playwright/test";
import {createHmac} from "node:crypto";
import {NextRequest} from "next/server";
import {apiOrigin, deploymentMode, localRequestOrigin, requestOrigin, trustedVercelClientIp} from "../lib/local-security";
import {proxy} from "../proxy";
import {GET, POST, PATCH} from "../app/api/backend/[...path]/route";

const publicOrigin = "https://yokohama-propuesta.vercel.app";
const upstreamOrigin = "https://yokohama-control-api-test.vercel.app";
const testKey = "isolated-cloud-test-key-not-production-2026";
const session = "s".repeat(48);
const cookieSession = "c".repeat(48);
const cloud = {YOKOHAMA_DEPLOYMENT_MODE: "cloud", YOKOHAMA_PUBLIC_ORIGIN: publicOrigin, YOKOHAMA_API_URL: upstreamOrigin, VERCEL: "1"};
const envKeys = ["YOKOHAMA_DEPLOYMENT_MODE", "YOKOHAMA_PUBLIC_ORIGIN", "YOKOHAMA_API_URL", "YOKOHAMA_API_KEY", "VERCEL", "NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE"];
let previousEnv: Record<string, string | undefined>, previousFetch: typeof fetch;

test.beforeEach(() => {
  previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  previousFetch = globalThis.fetch;
  Object.assign(process.env, cloud, {YOKOHAMA_API_KEY: testKey, NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE: "false"});
});
test.afterEach(() => {
  globalThis.fetch = previousFetch;
  for (const key of envKeys) {if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];}
});

function request(route: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(`http://internal.invalid/api/backend/${route}`, {method, headers: {Host: new URL(publicOrigin).host, ...(method !== "GET" ? {Origin: publicOrigin, "Content-Type": "application/json"} : {}), ...headers}, body});
}
function context(route: string) {return {params: Promise.resolve({path: route.split("/")})};}
function stubResponse(data: unknown, status = 200) {return new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json"}});}

test("local is default and cloud cannot authorize localhost or an arbitrary forwarded host", () => {
  expect(deploymentMode({})).toBe("local"); expect(deploymentMode({YOKOHAMA_DEPLOYMENT_MODE: "local"})).toBe("local");
  for (const value of ["", "CLOUD", "prod", "cloud "]) expect(deploymentMode({YOKOHAMA_DEPLOYMENT_MODE: value})).toBeNull();
  for (const host of ["127.0.0.1:3001", "localhost:3001", "[::1]:3001"]) expect(localRequestOrigin(host)).toBe(`http://${host}`);
  expect(requestOrigin(new Headers({Host: "localhost:3001"}), {})).toBe("http://localhost:3001");
  expect(requestOrigin(new Headers({Host: "yokohama-propuesta.vercel.app"}), cloud)).toBe(publicOrigin);
  for (const host of ["localhost:3001", "127.0.0.1", "[::1]", "evil.example.com", "yokohama-propuesta.vercel.app.evil.com", "yokohama-propuesta.vercel.app:443"]) {
    expect(requestOrigin(new Headers({Host: host, "X-Forwarded-Host": "yokohama-propuesta.vercel.app", "X-Forwarded-Proto": "https"}), cloud)).toBeNull();
  }
  expect(requestOrigin(new Headers({Host: "evil.example.com"}), {})).toBeNull();
  expect(requestOrigin(new Headers({Host: "localhost:3001"}), {YOKOHAMA_DEPLOYMENT_MODE: "unknown"})).toBeNull();
});

test("cloud configuration permits only distinct public HTTPS roots without paths or URL tricks", () => {
  expect(apiOrigin(cloud)?.href).toBe(`${upstreamOrigin}/`);
  expect(apiOrigin({YOKOHAMA_API_URL: "http://127.0.0.1:8000"})?.href).toBe("http://127.0.0.1:8000/");
  expect(apiOrigin({YOKOHAMA_API_URL: upstreamOrigin})).toBeNull();
  for (const value of [undefined, "http://api.example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://[::1]", "https://api.internal", `${upstreamOrigin}/api`, `${upstreamOrigin}/../`, `${upstreamOrigin}?`, `${upstreamOrigin}#`, `${upstreamOrigin}:443`, "https://u:p@api.example.com", `${upstreamOrigin}/%2f`, ` ${upstreamOrigin}`, `${upstreamOrigin}\\x`, publicOrigin]) {
    expect(apiOrigin({...cloud, YOKOHAMA_API_URL: value})).toBeNull();
  }
  for (const value of [undefined, "http://yokohama-propuesta.vercel.app", "https://localhost", `${publicOrigin}/path`, `${publicOrigin}?x=1`, "https://u@company.example.com"]) {
    expect(requestOrigin(new Headers({Host: "yokohama-propuesta.vercel.app"}), {...cloud, YOKOHAMA_PUBLIC_ORIGIN: value})).toBeNull();
  }
});

test("only a valid Vercel address can create a client fingerprint, never browser forwarding headers", () => {
  const headers = new Headers({"x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.99", "x-trusted-client": "a".repeat(64)});
  expect(trustedVercelClientIp(headers, cloud)).toBe("203.0.113.7");
  expect(trustedVercelClientIp(headers, {...cloud, VERCEL: undefined})).toBeNull();
  expect(trustedVercelClientIp(headers, {...cloud, YOKOHAMA_DEPLOYMENT_MODE: "local"})).toBeNull();
  expect(trustedVercelClientIp(new Headers({"x-forwarded-for": "203.0.113.7"}), cloud)).toBeNull();
  expect(trustedVercelClientIp(new Headers({"x-vercel-forwarded-for": "2001:0DB8:0:0:0:0:0:1"}), cloud)).toBe("2001:db8::1");
  for (const value of ["", "203.0.113.7, 198.51.100.1", "203.0.113.7:443", "not-an-ip", "999.1.1.1", "fe80::1%eth0"]) {
    expect(trustedVercelClientIp(new Headers({"x-vercel-forwarded-for": value}), cloud)).toBeNull();
  }
});

test("the page proxy fails closed for foreign hosts and blocks public setup", () => {
  expect(proxy(request("vehicles")).headers.get("x-middleware-next")).toBe("1");
  expect(proxy(request("vehicles", "GET", {Host: "localhost:3001", "X-Forwarded-Host": "yokohama-propuesta.vercel.app"})).status).toBe(403);
  expect(proxy(request("auth/setup")).status).toBe(404);
  process.env.YOKOHAMA_DEPLOYMENT_MODE = "typo";
  expect(proxy(request("vehicles")).status).toBe(403);
});

test("cloud route blocks CSRF, unknown routes, setup and proposal mode without contacting upstream", async () => {
  let calls = 0; globalThis.fetch = (async () => {calls++; throw new Error("must not contact the API");}) as typeof fetch;
  const invalidHeaders: Record<string, string>[] = [{Origin: "https://evil.example.com"}, {Origin: "null"}, {Origin: ""}, {Host: "localhost:3001"}, {"Sec-Fetch-Site": "cross-site"}];
  for (const headers of invalidHeaders) {
    expect((await POST(request("auth/login", "POST", headers, "{}"), context("auth/login"))).status).toBe(403);
  }
  expect((await GET(request("vehicles", "GET", {"Sec-Fetch-Site": "cross-site"}), context("vehicles"))).status).toBe(403);
  for (const route of ["auth/setup", "auth/register", "private-files", "../users"]) expect((await POST(request(route, "POST", {}, "{}"), context(route))).status).toBe(404);
  process.env.NEXT_PUBLIC_YOKOHAMA_PROPOSAL_MODE = "true";
  expect((await GET(request("vehicles"), context("vehicles"))).status).toBe(404);
  expect(calls).toBe(0);
});

test("login forwards only private key/cookie and hashed platform IP and returns a Secure HttpOnly cookie", async () => {
  let seenUrl = "", seenOptions: RequestInit | undefined;
  globalThis.fetch = (async (url, options) => {seenUrl = String(url); seenOptions = options; return stubResponse({session_token: session, expires_at: new Date(Date.now() + 3600_000).toISOString(), user: {name: "Administrador ficticio"}});}) as typeof fetch;
  const route = "auth/login";
  const response = await POST(request(route, "POST", {Cookie: `yokohama_session=${cookieSession}`, "X-API-Key": "browser-key", "X-Session-Token": "browser-token", "X-Trusted-Client": "b".repeat(64), "X-Forwarded-For": "198.51.100.9", "X-Vercel-Forwarded-For": "203.0.113.7"}, "{}"), context(route));
  expect(response.status).toBe(200); expect(seenUrl).toBe(`${upstreamOrigin}/api/auth/login`);
  const headers = new Headers(seenOptions!.headers);
  expect(headers.get("X-API-Key")).toBe(testKey); expect(headers.get("X-Session-Token")).toBe(cookieSession);
  expect(headers.get("X-Trusted-Client")).toBe(createHmac("sha256", testKey).update("203.0.113.7").digest("hex"));
  expect(headers.get("X-Forwarded-For")).toBeNull(); expect(headers.get("Cookie")).toBeNull();
  expect(seenOptions!.redirect).toBe("error"); expect(seenOptions!.cache).toBe("no-store");
  const data = await response.json(); expect(data).not.toHaveProperty("session_token");
  const cookie = response.headers.get("set-cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=strict", "Path=/"]) expect(cookie).toContain(flag);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("logout, password change and expired sessions clear a Secure cookie; header spoofing supplies no session", async () => {
  for (const [route, method, status] of [["auth/logout", "POST", 200], ["auth/password", "POST", 200], ["vehicles", "GET", 401]] as const) {
    let headers = new Headers(); globalThis.fetch = (async (_url, options) => {headers = new Headers(options?.headers); return stubResponse({detail: "fixture"}, status);}) as typeof fetch;
    const response = await (method === "GET" ? GET : POST)(request(route, method, {"X-Session-Token": session, "X-Trusted-Client": "a".repeat(64), "X-Forwarded-For": "203.0.113.99"}, method === "GET" ? undefined : "{}"), context(route));
    expect(headers.get("X-Session-Token")).toBeNull(); expect(headers.get("X-Trusted-Client")).toBeNull();
    const cookie = response.headers.get("set-cookie")!;
    for (const flag of ["HttpOnly", "Secure", "SameSite=strict", "Max-Age=0"]) expect(cookie).toContain(flag);
  }
});

test("JSON and evidence body limits are enforced both from stream and Content-Length", async () => {
  let calls = 0; globalThis.fetch = (async () => {calls++; return stubResponse({ok: true});}) as typeof fetch;
  const route = "vehicles/1/evidence";
  const huge = JSON.stringify({data: "x".repeat(3.5 * 1024 * 1024)});
  expect((await POST(request(route, "POST", {}, huge), context(route))).status).toBe(413);
  expect((await POST(request(route, "POST", {"Content-Length": String(4 * 1024 * 1024)}, "{}"), context(route))).status).toBe(413);
  expect((await POST(request("auth/login", "POST", {}, JSON.stringify({data: "x".repeat(32_768)})), context("auth/login"))).status).toBe(413);
  expect((await POST(request(route, "POST", {"Content-Type": "application/json-fake"}, "{}"), context(route))).status).toBe(415);
  expect((await POST(request(route, "POST", {}, "{"), context(route))).status).toBe(400);
  expect(calls).toBe(0);
  const photo = {filename: "example.jpg", data_url: `data:image/jpeg;base64,${"A".repeat(700 * 1024 * 4 / 3 | 0)}`};
  expect((await POST(request(route, "POST", {}, JSON.stringify({photos: [photo, photo, photo], reading_id: 1})), context(route))).status).toBe(200);
  expect(calls).toBe(1);
});

test("missing keys, invalid HTTPS upstreams and backend failures never expose internal secrets", async () => {
  let calls = 0; globalThis.fetch = (async () => {calls++; return stubResponse({detail: "private-stack-api-key-password"}, 500);}) as typeof fetch;
  delete process.env.YOKOHAMA_API_KEY;
  expect((await GET(request("vehicles"), context("vehicles"))).status).toBe(503);
  process.env.YOKOHAMA_API_KEY = testKey; process.env.YOKOHAMA_API_URL = "http://127.0.0.1:8000";
  expect((await GET(request("vehicles"), context("vehicles"))).status).toBe(503); expect(calls).toBe(0);
  process.env.YOKOHAMA_API_URL = upstreamOrigin;
  const response = await GET(request("vehicles"), context("vehicles")); expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("private-stack"); expect(calls).toBe(1);
});

test("local transport keeps its loopback setup and HTTP cookie behavior", async () => {
  Object.assign(process.env, {YOKOHAMA_DEPLOYMENT_MODE: "local", YOKOHAMA_API_URL: "http://127.0.0.1:8000"});
  let seen = ""; globalThis.fetch = (async url => {seen = String(url); return stubResponse({session_token: session, expires_at: new Date(Date.now() + 3600_000).toISOString()});}) as typeof fetch;
  const route = "auth/setup";
  const incoming = new NextRequest(`http://127.0.0.1:3001/api/backend/${route}`, {method: "POST", headers: {Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001", "Content-Type": "application/json"}, body: "{}"});
  const response = await POST(incoming, context(route)); expect(response.status).toBe(200);
  expect(seen).toBe("http://127.0.0.1:8000/api/auth/setup");
  expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(response.headers.get("set-cookie")).not.toContain("Secure");
  expect((await PATCH(request("users/1", "PATCH", {}, "{}"), context("users/1"))).status).toBe(403);
});
