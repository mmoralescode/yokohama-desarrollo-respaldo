"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useId, useRef, useState, type KeyboardEvent} from "react";
import {filterSections, revealSection, type SectionNavigationItem} from "@/lib/section-navigation";
import {useAuth} from "@/lib/auth-context";
import {useResource} from "@/lib/api";
import {matchesVehicle} from "@/lib/vehicle-administration";
import type {VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading} from "./ui";
import "./section-search.css";

export default function SectionSearch({items, onOpen}: {items: readonly SectionNavigationItem[]; onOpen?: () => void}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [unitQuery, setUnitQuery] = useState("");
  const [selectedUnitSection, setSelectedUnitSection] = useState<SectionNavigationItem | null>(null);
  const pathname = usePathname();
  const auth = useAuth();
  const fleet = useResource<VehicleSummary[]>("vehicles", open && !!selectedUnitSection && !auth.loading && !auth.error && !!auth.user);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const dialogId = `section-search-${id}`;
  const inputId = `${dialogId}-input`;
  const results = filterSections(items, query);
  const currentVehicle = pathname.match(/^\/vehiculos\/(\d+)\/?$/)?.[1];
  const currentVehicleId = currentVehicle ? Number(currentVehicle) : null;
  const canOpenCurrentVehicle = currentVehicleId !== null && Number.isSafeInteger(currentVehicleId) && currentVehicleId > 0 && (auth.isAdmin || !!auth.user?.vehicle_ids.includes(currentVehicleId));
  const assignedVehicles = (fleet.data || []).filter(vehicle => auth.isAdmin || auth.user?.vehicle_ids.includes(vehicle.id));
  const visibleVehicles = assignedVehicles.filter(vehicle => matchesVehicle(vehicle, unitQuery));

  function hrefForSection(item: SectionNavigationItem) {
    return item.unitAnchor && canOpenCurrentVehicle ? `/vehiculos/${currentVehicleId}#${item.unitAnchor}` : item.href;
  }

  function navigate(href: string) {
    revealSection(href);
    close(false);
  }

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }

  useEffect(() => {setOpen(false); setQuery(""); setUnitQuery(""); setSelectedUnitSection(null);}, [pathname]);
  useEffect(() => {if (open) input.current?.focus();}, [open, selectedUnitSection]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {event.preventDefault(); close();}
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const links = Array.from(dialog.current?.querySelectorAll<HTMLElement>(".section-search-result") || []);
    const active = document.activeElement;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!links.length) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const current = links.indexOf(active as HTMLElement);
      const next = current === -1 ? (direction === 1 ? 0 : links.length - 1) : (current + direction + links.length) % links.length;
      event.preventDefault();
      links[next].focus();
    } else if (event.key === "Enter" && active === input.current && links.length) {
      event.preventDefault();
      links[0].click();
    } else if (event.key === "Tab") {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), a[href]") || []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && active === first) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && active === last) {event.preventDefault(); first?.focus();}
    }
  }

  return <div ref={root} className="section-search">
    <button ref={trigger} type="button" className="section-search-trigger" aria-label="Buscar apartados" title="Buscar apartados" aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId} onClick={() => {
      if (open) close();
      else {onOpen?.(); setQuery(""); setUnitQuery(""); setSelectedUnitSection(null); setOpen(true);}
    }}><Icon name="search" size={20}/></button>
    {open && <div ref={dialog} id={dialogId} className="section-search-dialog" role="dialog" aria-label="Buscar apartados" onKeyDown={keyboard}>
      <div className="section-search-heading"><strong>{selectedUnitSection?.label || "Buscar apartados"}</strong><button type="button" className="section-search-close" aria-label="Cerrar búsqueda" onClick={() => close()}><span aria-hidden="true">×</span></button></div>
      {selectedUnitSection && <button type="button" className="section-search-back" onClick={() => {setSelectedUnitSection(null); setUnitQuery("");}}>Volver a apartados</button>}
      <label className="sr-only" htmlFor={inputId}>{selectedUnitSection ? "Buscar unidad" : "Buscar apartado"}</label>
      <div className="section-search-input"><Icon name="search" size={18}/><input ref={input} id={inputId} type="search" value={selectedUnitSection ? unitQuery : query} onChange={event => selectedUnitSection ? setUnitQuery(event.target.value) : setQuery(event.target.value)} placeholder={selectedUnitSection ? "Buscar por placa o apodo" : "Buscar apartado"} autoComplete="off" maxLength={100}/></div>
      <div className="section-search-results" aria-label={selectedUnitSection ? "Unidades disponibles" : "Apartados disponibles"}>
        {selectedUnitSection ? <>
          {fleet.loading || (!fleet.data && !fleet.error) ? <Loading label="Consultando unidades…"/> : fleet.error ? <ErrorBox message={fleet.error} retry={fleet.refresh}/> : visibleVehicles.length ? <ul>{visibleVehicles.map(vehicle => {
            const href = `/vehiculos/${vehicle.id}#${selectedUnitSection.unitAnchor}`;
            return <li key={vehicle.id}><Link href={href} className="section-search-result" prefetch={false} onClick={() => navigate(href)}><Icon name="fleet" size={19}/><span className="section-search-result-label">{vehicle.plate}<small>{[vehicle.nickname, vehicle.make, vehicle.model].filter(Boolean).join(" · ")}</small></span><Icon name="arrow" size={16}/></Link></li>;
          })}</ul> : <Empty title={unitQuery ? "Sin unidades coincidentes" : auth.isAdmin ? "Sin unidades registradas" : "Sin unidades asignadas"}/>}
        </> : results.length ? <ul>{results.map(item => {
          const contents = <><Icon name={item.icon} size={19}/><span className="section-search-result-label">{item.label}{item.parentLabel && <small>{item.parentLabel}</small>}</span><Icon name="arrow" size={16}/></>;
          const href = hrefForSection(item);
          return <li key={`${item.href}-${item.unitAnchor || ""}-${item.label}`}>{item.unitAnchor && !canOpenCurrentVehicle ? <button type="button" className="section-search-result" onClick={() => {setUnitQuery(""); setSelectedUnitSection(item);}}>{contents}</button> : <Link href={href} className="section-search-result" prefetch={false} onClick={() => navigate(href)}>{contents}</Link>}</li>;
        })}</ul> : <p className="section-search-empty" role="status">Sin apartados coincidentes</p>}
      </div>
    </div>}
  </div>;
}
