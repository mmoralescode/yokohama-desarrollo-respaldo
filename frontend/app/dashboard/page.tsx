"use client";

import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {numberLabel, useResource} from "@/lib/api";
import {useAuth} from "@/lib/auth-context";
import {matchesVehicle} from "@/lib/vehicle-administration";
import {Empty, ErrorBox, Icon, Loading, PageHeader} from "@/components/ui";
import {revealSection} from "@/lib/section-navigation";
import "./dashboard.css";
import "./dashboard-presentation.css";

type UnitStatistics = {id: number; plate: string; nickname: string | null; current_km: number; drivers: string[]; open_faults: number; total_faults: number; critical_faults: number};
const INITIAL_UNITS = 8;

function UnitDrivers({drivers}: {drivers: string[] | undefined}) {
  const names = drivers || [];
  return <span className="unit-chart-drivers">{names.length ? `${names.length === 1 ? "Conductor" : "Conductores"}: ${names.join(", ")}` : "Sin conductor asignado"}</span>;
}

function MoreUnits({shown, total, onMore, onLess, chart}: {shown: number; total: number; onMore: () => void; onLess: () => void; chart: string}) {
  if (total <= INITIAL_UNITS) return null;
  return <div className="unit-chart-footer"><span>{Math.min(shown, total)} de {total} unidades</span>
    {shown < total ? <button type="button" className="show-more-button" onClick={onMore} aria-label={`Mostrar más unidades en ${chart}`}>Mostrar más</button>
      : <button type="button" className="show-more-button" onClick={onLess} aria-label={`Mostrar menos unidades en ${chart}`}>Mostrar menos</button>}
  </div>;
}

export default function DashboardPage() {
  const auth = useAuth();
  const resource = useResource<UnitStatistics[]>("fleet-statistics", auth.isAdmin);
  useEffect(() => {if (resource.data) revealSection(window.location.href);}, [resource.data]);
  const [search, setSearch] = useState("");
  const [kilometersShown, setKilometersShown] = useState(INITIAL_UNITS);
  const [faultsShown, setFaultsShown] = useState(INITIAL_UNITS);
  const units = useMemo(() => {
    return (resource.data || []).filter(unit => matchesVehicle(unit, search));
  }, [resource.data, search]);
  const byKilometers = useMemo(() => [...units].sort((a, b) => b.current_km - a.current_km || a.plate.localeCompare(b.plate)), [units]);
  const byFaults = useMemo(() => [...units].sort((a, b) => b.total_faults - a.total_faults || b.open_faults - a.open_faults || a.plate.localeCompare(b.plate)), [units]);
  const totals = useMemo(() => units.reduce((result, unit) => ({kilometers: result.kilometers + unit.current_km,
    faults: result.faults + unit.total_faults, open: result.open + unit.open_faults, critical: result.critical + unit.critical_faults}),
  {kilometers: 0, faults: 0, open: 0, critical: 0}), [units]);
  const maxKilometers = Math.max(1, byKilometers[0]?.current_km || 0);
  const maxFaults = Math.max(1, byFaults[0]?.total_faults || 0);

  if (auth.loading) return <Loading label="Verificando acceso…"/>;
  if (!auth.isAdmin) return <div><PageHeader eyebrow="" title="Dashboard" description=""/><Empty title="Acceso exclusivo de administración"/></div>;

  return <div className="dashboard unit-dashboard">
    <PageHeader eyebrow="" title="Dashboard" description="" action={<button className="button secondary" type="button" aria-label="Actualizar dashboard" disabled={resource.loading} onClick={resource.refresh}><Icon name="refresh" size={17}/>{resource.loading ? "Actualizando…" : "Actualizar"}</button>}/>
    {resource.error && <><ErrorBox message={resource.error} retry={resource.refresh}/>{resource.data && <p className="dashboard-stale" role="status">Datos de la última consulta correcta.</p>}</>}
    {resource.loading && !resource.data && <Loading label="Consultando estadísticas…"/>}
    {resource.data && <>
      <div className="unit-dashboard-filter"><label>Buscar unidad por placa o apodo<div className="unit-dashboard-search"><Icon name="search" size={17}/><input type="search" value={search} placeholder="Placa, terminación o apodo" onChange={event => {setSearch(event.target.value); setKilometersShown(INITIAL_UNITS); setFaultsShown(INITIAL_UNITS);}}/></div></label></div>
      <div className="dashboard-kpis" aria-label="Indicadores de la flotilla" aria-busy={resource.loading}>
        <div className="dashboard-kpi" data-testid="dashboard-fleet-count"><span className="dashboard-kpi-heading"><Icon name="fleet"/>Unidades</span><strong>{numberLabel(units.length)}</strong></div>
        <div className="dashboard-kpi" data-testid="dashboard-kilometers-count"><span className="dashboard-kpi-heading"><Icon name="dashboard"/>Kilometraje registrado</span><strong>{numberLabel(totals.kilometers, 1)}<small> km</small></strong></div>
        <div className="dashboard-kpi" data-testid="dashboard-faults-count"><span className="dashboard-kpi-heading"><Icon name="wrench"/>Fallas reportadas</span><strong>{numberLabel(totals.faults)}</strong></div>
        <div className="dashboard-kpi dashboard-kpi-urgent" data-testid="dashboard-open-faults-count"><span className="dashboard-kpi-heading"><Icon name="warning"/>Fallas abiertas</span><strong>{numberLabel(totals.open)}</strong>{totals.critical > 0 && <span className="unit-critical-total">{numberLabel(totals.critical)} {totals.critical === 1 ? "crítica" : "críticas"}</span>}</div>
      </div>
      {!units.length ? <section className="panel"><Empty title={search ? "Sin coincidencias" : "Sin unidades registradas"}/></section> : <div className="dashboard-columns">
        <section id="kilometraje-unidades" tabIndex={-1} className="panel dashboard-panel unit-chart" aria-labelledby="unit-kilometers-title" data-testid="dashboard-kilometers-chart">
          <div className="panel-header"><h2 id="unit-kilometers-title">Kilometraje acumulado por unidad</h2><span className="unit-chart-unit">km</span></div>
          <figure><figcaption className="sr-only">Kilometraje acumulado por unidad, de mayor a menor.</figcaption>
            <ul className="unit-chart-list">{byKilometers.slice(0, kilometersShown).map(unit => <li key={unit.id} data-testid={`dashboard-kilometers-unit-${unit.id}`}>
              <div className="unit-chart-row-heading"><Link href={`/vehiculos/${unit.id}`}>{unit.plate}</Link><strong>{numberLabel(unit.current_km, 20)} <span>km</span></strong></div>
              {unit.nickname && <span className="unit-chart-nickname">{unit.nickname}</span>}
              <UnitDrivers drivers={unit.drivers}/>
              <div className="unit-chart-track" role="img" aria-label={`${unit.plate}: ${numberLabel(unit.current_km, 20)} kilómetros`}><span className="unit-chart-kilometers" style={{width: `${unit.current_km / maxKilometers * 100}%`}}/></div>
            </li>)}</ul>
          </figure>
          <MoreUnits shown={kilometersShown} total={units.length} chart="kilometraje" onMore={() => setKilometersShown(value => value + INITIAL_UNITS)} onLess={() => setKilometersShown(INITIAL_UNITS)}/>
        </section>
        <section id="fallas-unidades" tabIndex={-1} className="panel dashboard-panel unit-chart" aria-labelledby="unit-faults-title" data-testid="dashboard-faults-chart">
          <div className="panel-header"><h2 id="unit-faults-title">Fallas por unidad</h2><span className="unit-chart-unit">reportes</span></div>
          <div className="unit-chart-legend"><span><i className="legend-open"/>Abiertas</span><span><i className="legend-resolved"/>Resueltas</span></div>
          <figure><figcaption className="sr-only">Total de reportes de falla por unidad, indicando cuáles siguen abiertos y cuáles se resolvieron.</figcaption>
            <ul className="unit-chart-list">{byFaults.slice(0, faultsShown).map(unit => <li key={unit.id} data-testid={`dashboard-faults-unit-${unit.id}`}>
              <div className="unit-chart-row-heading"><Link href={`/vehiculos/${unit.id}`}>{unit.plate}</Link><strong>{numberLabel(unit.total_faults)}</strong></div>
              {unit.nickname && <span className="unit-chart-nickname">{unit.nickname}</span>}
              <UnitDrivers drivers={unit.drivers}/>
              <div className="unit-chart-track" role="img" aria-label={`${unit.plate}: ${unit.total_faults} ${unit.total_faults === 1 ? "falla" : "fallas"}, ${unit.open_faults} ${unit.open_faults === 1 ? "abierta" : "abiertas"} y ${unit.total_faults - unit.open_faults} ${unit.total_faults - unit.open_faults === 1 ? "resuelta" : "resueltas"}`}>
                <span className="unit-chart-open" style={{width: `${unit.open_faults / maxFaults * 100}%`}}/><span className="unit-chart-resolved" style={{width: `${(unit.total_faults - unit.open_faults) / maxFaults * 100}%`}}/>
              </div>
              <div className="unit-fault-counts"><span>{unit.open_faults} {unit.open_faults === 1 ? "abierta" : "abiertas"} · {unit.total_faults - unit.open_faults} {unit.total_faults - unit.open_faults === 1 ? "resuelta" : "resueltas"}</span>{unit.critical_faults > 0 && <span className="unit-critical-count">{unit.critical_faults} {unit.critical_faults === 1 ? "crítica abierta" : "críticas abiertas"}</span>}</div>
            </li>)}</ul>
          </figure>
          <MoreUnits shown={faultsShown} total={units.length} chart="fallas" onMore={() => setFaultsShown(value => value + INITIAL_UNITS)} onLess={() => setFaultsShown(INITIAL_UNITS)}/>
        </section>
      </div>}
    </>}
  </div>;
}
