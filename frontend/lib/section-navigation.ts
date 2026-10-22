import type {IconName} from "@/components/ui";
import {normalizeSearch} from "./drivers";

export type SectionNavigationItem = {
  href: string;
  label: string;
  icon: IconName;
  keywords: readonly string[];
  unitAnchor?: string;
  parentLabel?: string;
};

const sharedSections: readonly SectionNavigationItem[] = [
  {href: "/", label: "Mis unidades", icon: "fleet", keywords: ["flotilla", "unidad", "unidades", "auto", "autos", "vehículo", "vehículos", "placa", "placas", "apodo", "marca", "modelo"]},
  {href: "/incidencias", label: "Incidencias", icon: "warning", keywords: ["incidente", "reporte", "foto", "evidencia", "seguimiento"]},
  {href: "/kilometraje", label: "Kilometraje", icon: "check", keywords: ["lectura", "odómetro", "km", "foto del tablero", "captura"]},
  {href: "/fallas", label: "Fallas", icon: "wrench", keywords: ["avería", "problema", "reportar", "solución", "taller"]},
];

const adminSections: readonly SectionNavigationItem[] = [
  {href: "/usuarios", label: "Usuarios", icon: "users", keywords: ["conductor", "conductores", "correo", "cuentas", "registrar usuario", "alta de conductor", "asignación", "asignaciones"]},
  {href: "/calendario", label: "Calendario", icon: "calendar", keywords: ["agenda", "cita", "fecha", "servicio", "mantenimiento", "reprogramar"]},
  {href: "/alertas", label: "Alertas", icon: "bell", keywords: ["aviso", "prioridad", "pendiente", "mantenimiento", "documentos", "vencimientos"]},
  {href: "/dashboard", label: "Dashboard", icon: "dashboard", keywords: ["estadísticas", "gráficas", "resumen", "dasboard"]},
];

const accountSection: SectionNavigationItem = {
  href: "/cuenta", label: "Mi cuenta", icon: "users", keywords: ["perfil", "acceso"],
};

export const adminSectionPaths = adminSections.map(section => section.href);

export function getNavigationSections(isAdmin: boolean): SectionNavigationItem[] {
  return [
    ...sharedSections.map(section => section.href === "/" && isAdmin ? {...section, label: "Mi flotilla"} : section),
    ...(isAdmin ? adminSections : []),
    accountSection,
  ];
}

export function getSearchSections(isAdmin: boolean): SectionNavigationItem[] {
  const navigation = getNavigationSections(isAdmin);
  return [
    navigation[0],
    {href: "/", label: "Documentación y vencimientos", icon: "calendar", parentLabel: "Unidad", unitAnchor: "documentos", keywords: ["documentos", "verificación", "periodo", "tarjeta de circulación", "vigencia de placas", "refrendo", "tenencia", "fecha límite"]},
    {href: "/", label: "Fotos de documentación", icon: "fleet", parentLabel: "Unidad", unitAnchor: "fotos-documentacion", keywords: ["fotografías", "documento", "evidencia", "subir foto"]},
    {href: "/", label: "Datos del vehículo", icon: "fleet", parentLabel: "Unidad", unitAnchor: "datos-vehiculo", keywords: ["características", "número de serie", "marca", "modelo", "color", "vin"]},
    ...navigation.slice(1),
    {href: "/cuenta#cambiar-contrasena", label: "Cambiar contraseña", icon: "users", parentLabel: "Mi cuenta", keywords: ["contraseña", "password", "clave"]},
    {href: "/cuenta#unidades-asignadas", label: "Unidades asignadas", icon: "fleet", parentLabel: "Mi cuenta", keywords: ["unidad asignada", "asignación"]},
    {href: "/cuenta#perfil", label: "Nombre de usuario", icon: "users", parentLabel: "Mi cuenta", keywords: ["nombre", "correo electrónico"]},
    ...(isAdmin ? [
      {href: "/", label: "Pronósticos de mantenimiento", icon: "wrench", parentLabel: "Unidad", unitAnchor: "pronosticos", keywords: ["proyecciones", "próximos servicios", "predicción"]},
      {href: "/", label: "Disponibilidad de la unidad", icon: "fleet", parentLabel: "Unidad", unitAnchor: "disponibilidad", keywords: ["tiempo fuera de servicio", "baja", "operativa"]},
      {href: "/dashboard#kilometraje-unidades", label: "Kilometraje acumulado por unidad", icon: "dashboard", parentLabel: "Dashboard", keywords: ["gráfica de kilometraje", "estadísticas de kilómetros"]},
      {href: "/dashboard#fallas-unidades", label: "Fallas por unidad", icon: "wrench", parentLabel: "Dashboard", keywords: ["gráfica de fallas", "estadísticas de reportes"]},
    ] satisfies SectionNavigationItem[] : []),
  ];
}

export const SECTION_NAVIGATION_EVENT = "yokohama-open-section";

export function scrollToSection(anchor: string) {
  const target = document.getElementById(anchor);
  target?.scrollIntoView({block: "start"});
  if (target?.hasAttribute("tabindex")) target.focus({preventScroll: true});
}

// Reveal collapsed content on same-page navigation, including the same hash.
// Cross-page disclosures reveal themselves after their data has mounted.
export function revealSection(href: string) {
  if (typeof window === "undefined") return;
  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin || target.pathname !== window.location.pathname || !target.hash) return;
  const anchor = target.hash.slice(1);
  window.dispatchEvent(new CustomEvent(SECTION_NAVIGATION_EVENT, {detail: anchor}));
  requestAnimationFrame(() => scrollToSection(anchor));
}

export function filterSections(items: readonly SectionNavigationItem[], query: string): SectionNavigationItem[] {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return items.filter(item => {
    const text = normalizeSearch([item.label, ...item.keywords].join(" "));
    return terms.every(term => text.includes(term));
  });
}
