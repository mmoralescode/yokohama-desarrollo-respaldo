"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useRef, useState, type ReactNode} from "react";
import {ErrorBox, Icon, Loading} from "./ui";
import {proposalMode} from "@/lib/proposal-mode";
import {useAuth} from "@/lib/auth-context";
import {api} from "@/lib/api";
import {adminSectionPaths, getNavigationSections} from "@/lib/section-navigation";
import "./accounts.css";
import "./simplified.css";

const adminPaths = [...adminSectionPaths, "/normativa"];

export default function Shell({children}: {children: ReactNode}) {
  const path = usePathname();
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const accessPage = path === "/acceso";
  const showOperationMenu = !accessPage && !auth.loading && (proposalMode || !!auth.user);
  const needsLogin = !proposalMode && !auth.user;
  const denied = !auth.isAdmin && adminPaths.some(route => path === route || path.startsWith(`${route}/`));
  const visibleLinks = getNavigationSections(auth.isAdmin);
  useEffect(() => {setMenuOpen(false);}, [path, auth.user?.id]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);};
    const escape = (event: KeyboardEvent) => {if (event.key === "Escape") {setMenuOpen(false); menuButton.current?.focus();}};
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape);};
  }, [menuOpen]);
  async function logout() {
    setLoggingOut(true); setLogoutError(null);
    try {await api("auth/logout", {method: "POST"}); await auth.refresh();}
    catch (reason) {setLogoutError(reason instanceof Error ? reason.message : "No se pudo cerrar la sesión.");}
    finally {setLoggingOut(false);}
  }
  return <div className="app-shell simple-shell professional-shell"><a className="skip-link" href="#contenido">Ir al contenido</a><div className="workspace">
    <header className="topbar simple-topbar">{showOperationMenu ? <div ref={menu} className="operation-menu"><button ref={menuButton} type="button" className="operation-toggle" aria-expanded={menuOpen} aria-controls="operation-navigation" onClick={() => setMenuOpen(value => !value)}><span className="brand">YOKOHAMA</span><span className="operation-label">Operación <span aria-hidden="true">⌄</span></span></button>{menuOpen && <div id="operation-navigation" className="operation-dropdown"><nav aria-label="Navegación principal">{visibleLinks.map(link => {
      const active = link.href === "/" ? path === "/" || path.startsWith("/vehiculos") : path === link.href || path.startsWith(`${link.href}/`);
      return <Link key={link.href} href={link.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}><Icon name={link.icon}/>{link.label}</Link>;
    })}</nav></div>}</div> : <span className="brand">YOKOHAMA</span>}<div className="account-topbar inline gap">{auth.user ? <><Link href="/cuenta" className="account-name">{auth.user.name}</Link><button className="text-button" disabled={loggingOut} onClick={logout}>{loggingOut ? "Saliendo…" : "Salir"}</button></> : !accessPage && <Link href="/acceso" className="button secondary small-button">Iniciar sesión</Link>}</div></header>
    {proposalMode && <div className="demo-notice compact-notice"><Icon name="fleet" size={17}/><p><strong>Propuesta con datos ficticios.</strong> Las capturas se guardan solo en este navegador. Usa datos de ejemplo.</p></div>}
    <main id="contenido" tabIndex={-1}>{logoutError && <ErrorBox message={logoutError}/>}<div key={`${auth.user?.id || "local"}-${auth.user?.role || ""}-${[...(auth.user?.vehicle_ids || [])].sort((a,b) => a-b).join(",")}`}>
      {auth.loading ? <Loading label="Verificando acceso…"/> : auth.error ? <ErrorBox message={auth.error} retry={() => {void auth.refresh();}}/> : needsLogin && !accessPage ? <section className="panel account-gate"><Icon name="users" size={32}/><h1>Entra a tu cuenta</h1><p>Consulta tus unidades asignadas y registra tus reportes con fotografías.</p><Link href="/acceso" className="button primary">Iniciar sesión<Icon name="arrow"/></Link></section> : denied ? <section className="panel account-gate"><h1>Tu espacio de conductor</h1><p>Desde tus unidades puedes consultar la información asignada y cargar tus propias evidencias.</p><Link href="/" className="button primary">Ver mis unidades<Icon name="arrow"/></Link></section> : children}
    </div></main><footer className="footer"><span>Yokohama · Control de unidades</span><span>{proposalMode ? "Propuesta interactiva" : auth.isAdmin ? "Administración" : "Mi espacio"}</span></footer>
  </div></div>;
}
