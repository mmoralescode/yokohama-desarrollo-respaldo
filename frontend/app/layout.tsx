import type {Metadata} from "next";
import Shell from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {title: "Yokohama | Flotilla", description: "Panel local de planeación de mantenimiento para flotillas multimarcas", robots: {index: false, follow: false}};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="es-MX" data-scroll-behavior="smooth"><body><Shell>{children}</Shell></body></html>;
}
