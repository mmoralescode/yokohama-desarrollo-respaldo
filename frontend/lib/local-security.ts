import {isIP} from "node:net";

export type DeploymentMode = "local" | "cloud";
type ServerEnvironment = {readonly [key: string]: string | undefined; YOKOHAMA_DEPLOYMENT_MODE?: string; YOKOHAMA_PUBLIC_ORIGIN?: string; YOKOHAMA_API_URL?: string; VERCEL?: string};

/** An unknown mode must never relax either environment's boundary. */
export function deploymentMode(environment: ServerEnvironment = process.env): DeploymentMode | null {
  const value = environment.YOKOHAMA_DEPLOYMENT_MODE;
  if (value === undefined || value === "local") return "local";
  return value === "cloud" ? "cloud" : null;
}

export function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname.toLowerCase());
}

function publicHttpsRoot(value: string | undefined): URL | null {
  if (!value || value !== value.trim() || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.port
      || isLoopback(hostname) || isIP(hostname) || hostname.startsWith("[")
      || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)
      || /\.(?:localhost|local|internal)$/.test(hostname)) return null;
    // Reject normalized-away paths, credentials, empty queries/fragments and ports.
    if (!/^https:\/\/[a-z0-9.-]+\/?$/i.test(value)) return null;
    return url;
  } catch {return null;}
}

/** The public HTTPS origin comes only from server configuration, never forwarding headers. */
export function requestOrigin(headers: Headers, environment: ServerEnvironment = process.env): string | null {
  const mode = deploymentMode(environment);
  if (mode === "local") return localRequestOrigin(headers.get("host"));
  if (mode !== "cloud") return null;
  const origin = publicHttpsRoot(environment.YOKOHAMA_PUBLIC_ORIGIN);
  return origin && headers.get("host")?.toLowerCase() === origin.host ? origin.origin : null;
}

/** A fixed server-configured root is the only upstream; user URLs/hosts cannot select it. */
export function apiOrigin(environment: ServerEnvironment = process.env): URL | null {
  const mode = deploymentMode(environment);
  if (mode === "cloud") {
    const upstream = publicHttpsRoot(environment.YOKOHAMA_API_URL);
    const publicOrigin = publicHttpsRoot(environment.YOKOHAMA_PUBLIC_ORIGIN);
    return upstream && publicOrigin && upstream.origin !== publicOrigin.origin ? upstream : null;
  }
  if (mode !== "local" || !environment.YOKOHAMA_API_URL) return null;
  try {
    const upstream = new URL(environment.YOKOHAMA_API_URL);
    return upstream.protocol === "http:" && isLoopback(upstream.hostname) && !upstream.username && !upstream.password
      && upstream.pathname === "/" && !upstream.search && !upstream.hash ? upstream : null;
  } catch {return null;}
}

/**
 * Trust platform-supplied IP only on Vercel, and only one valid address.
 * https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for
 * Never fall back to browser-supplied X-Forwarded-For or X-Trusted-Client.
 */
export function trustedVercelClientIp(headers: Headers, environment: ServerEnvironment = process.env): string | null {
  if (deploymentMode(environment) !== "cloud" || environment.VERCEL !== "1") return null;
  const address = headers.get("x-vercel-forwarded-for");
  if (!address || !/^[a-fA-F0-9:.]+$/.test(address)) return null;
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;
  try {return new URL(`http://[${address}]/`).hostname.slice(1, -1);} catch {return null;}
}

export function localRequestOrigin(host: string | null): string | null {
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host.toLowerCase())) return null;
  try {
    const parsed = new URL(`http://${host}`);
    return isLoopback(parsed.hostname) ? parsed.origin : null;
  } catch { return null; }
}
