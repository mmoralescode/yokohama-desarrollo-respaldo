import { NextRequest, NextResponse } from "next/server";
import { deploymentMode, requestOrigin } from "./lib/local-security";
import { proposalMode } from "./lib/proposal-mode";

export function proxy(request: NextRequest) {
  if (proposalMode) {
    // The shareable proposal never forwards requests to a private fleet API.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({detail: "La propuesta utiliza datos de ejemplo guardados en este navegador."}, {status: 404});
    }
    return NextResponse.next();
  }
  if (!requestOrigin(request.headers)) {
    return new NextResponse("Acceso restringido al entorno configurado.", {status: 403});
  }
  if (deploymentMode() === "cloud" && request.nextUrl.pathname === "/api/backend/auth/setup") return NextResponse.json({detail: "Ruta no permitida."}, {status: 404, headers: {"Cache-Control": "no-store"}});
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
