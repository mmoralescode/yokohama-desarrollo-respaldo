import type {Metadata} from "next";
import Shell from "@/components/shell";
import {AuthProvider} from "@/lib/auth-context";
import "./globals.css";
import "@/components/presentation.css";
export const metadata: Metadata = {title: "Yokohama | Control de unidades", description: "Administración de unidades, conductores y evidencias de operación", robots: {index: false, follow: false}};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="es-MX" data-scroll-behavior="smooth"><body><AuthProvider><Shell>{children}</Shell></AuthProvider></body></html>;
}
