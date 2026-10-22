"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useEffect, useMemo, useState} from "react";
import {api, dateLabel, numberLabel, useResource} from "@/lib/api";
import {SHOW_MAZDA_3D_VIEWER} from "@/lib/feature-flags";
import {proposalMode} from "@/lib/proposal-mode";
import type {VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, TrafficBadge} from "@/components/ui";
import {compareUrgency} from "@/lib/fleet-order";
import {matchesDriverNames} from "@/lib/drivers";
import {useAuth} from "@/lib/auth-context";
import {matchesVehicle, plateEnding} from "@/lib/vehicle-administration";
import AddVehicle from "@/components/add-vehicle";
import {DriverNames} from "@/components/vehicle-drivers";
import VehicleSearchFields from "@/components/vehicle-search-fields";

// The source stays available, but the off flag avoids rendering or fetching
// the 3D component and its local Mazda asset in the current fleet UI.
const MazdaViewer = SHOW_MAZDA_3D_VIEWER
  ? dynamic(() => import("@/components/mazda-viewer"), {ssr: false})
  : null;

export default function FleetPage() {
  const {isAdmin} = useAuth();
  const resource = useResource<VehicleSummary[]>("vehicles");
  const [search, setSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {if (new URLSearchParams(window.location.search).get("alta") === "1") setShowAdd(true);}, []);
  const [recalculating, setRecalculating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const vehicles = resource.data || [];
  const visible = useMemo(() => vehicles.filter(v => (!isAdmin || status === "all" || v.traffic_light === status) && matchesVehicle(v, search) && (!isAdmin || matchesDriverNames(v.drivers, driverSearch))).sort(isAdmin ? compareUrgency : (a, b) => a.id - b.id), [vehicles, search, driverSearch, status, isAdmin]);
  async function recalculate() {
    setRecalculating(true); setMutationError(null); setNotice(null);
    try {const result = await api<{vehicles_processed: number; alerts_open: number}>("recalculate", {method: "POST"}); setNotice(proposalMode ? "Agenda e historial actualizados. En esta propuesta los pronósticos son ejemplos; los cambios administrativos se guardan en este navegador." : `${result.vehicles_processed} unidades recalculadas · ${result.alerts_open} alertas abiertas.`); resource.refresh();}
    catch(e) {setMutationError(e instanceof Error ? e.message : "No se pudo recalcular.");}
    finally {setRecalculating(false);}
  }
  return <>
    <PageHeader eyebrow={isAdmin ? "CONTROL DE UNIDADES" : "MI ESPACIO"} title={isAdmin ? "Mi flotilla" : "Mis unidades"} description={isAdmin ? "Abre una unidad para consultar sus datos. Gestiona los accesos desde Conductores." : "Abre tu unidad para cargar kilometraje, incidencias y fallas con fotografías."} action={isAdmin && <button className="button primary" onClick={() => setShowAdd(value => !value)} aria-expanded={showAdd}><Icon name="plus" size={18}/>{showAdd ? "Cerrar registro" : "Agregar unidad"}</button>}/>
    {showAdd && isAdmin && <AddVehicle onDone={resource.refresh}/>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {mutationError && <ErrorBox message={mutationError}/>}{notice && <p className="message success" role="status">{notice}</p>}
    {MazdaViewer && <MazdaViewer/>}
    {resource.data && <p className="fleet-summary-line">{vehicles.length} {vehicles.length === 1 ? "unidad" : "unidades"}{isAdmin ? " en flotilla" : " asignadas a tu cuenta"}</p>}
    <section className="panel fleet-panel"><div className="panel-header"><h2>{isAdmin ? "Unidades" : "Mis unidades asignadas"}</h2>{isAdmin && <button className="button secondary small-button" onClick={recalculate} disabled={recalculating || resource.loading}><Icon name="refresh" size={16}/>{recalculating ? "Recalculando…" : "Recalcular planes"}</button>}</div>
      {(isAdmin || vehicles.length > 1) && <div className="table-toolbar">{isAdmin ? <VehicleSearchFields plate={search} driver={driverSearch} onPlateChange={value => {setSearch(value); setShowAll(false);}} onDriverChange={value => {setDriverSearch(value); setShowAll(false);}} platePlaceholder="Placa, terminación o apodo" plateLabel="Buscar por placa, terminación o apodo"/> : <label>Buscar mi unidad<input value={search} onChange={event => {setSearch(event.target.value); setShowAll(false);}} placeholder="Placa o apodo"/></label>}{isAdmin && <label className="status-filter"><span className="sr-only">Filtrar estado</span><select value={status} onChange={e => {setStatus(e.target.value); setShowAll(false);}}><option value="all">Todos los estados</option><option value="red">Atención prioritaria</option><option value="amber">Planear / validar</option><option value="gray">Datos insuficientes</option><option value="green">En ventana</option></select></label>}</div>}
      {resource.loading && !resource.data ? <Loading/> : !visible.length ? <Empty title={search || driverSearch || status !== "all" ? "Sin coincidencias" : isAdmin ? "Aún no hay unidades" : "Aún no tienes una unidad asignada"}>{search || driverSearch || status !== "all" ? "Prueba otra búsqueda o cambia el filtro." : isAdmin ? "Agrega la primera unidad para comenzar." : "El administrador debe asignar una unidad a tu cuenta."}</Empty> : <><div className="table-scroll simple-unit-table"><table><caption className="sr-only">{isAdmin ? "Unidades de la flotilla" : "Mis unidades asignadas"}</caption><thead><tr><th>Unidad{isAdmin ? " / conductores" : ""}</th>{isAdmin && <th className="unit-status-column">Estado</th>}<th>Kilometraje</th><th><span className="sr-only">Ver unidad</span></th></tr></thead><tbody>{(showAll ? visible : visible.slice(0, 8)).map(vehicle => <tr key={vehicle.id}>
        <td><Link href={`/vehiculos/${vehicle.id}`} className="plate-link">{vehicle.plate}</Link>{vehicle.nickname && <strong className="cell-sub">{vehicle.nickname}</strong>}<span className="cell-sub">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unidad"} {vehicle.model_year}</span>{isAdmin && <DriverNames drivers={vehicle.drivers}/>}<details className="unit-table-more"><summary>Mostrar más</summary><p>Terminación: {plateEnding(vehicle.plate) ?? "sin capturar"}{vehicle.registration_state ? ` · ${vehicle.registration_state}` : ""}</p>{isAdmin && <><p>{vehicle.next_visit_date ? `Próxima visita propuesta: ${dateLabel(vehicle.next_visit_date)}` : "Sin fecha de visita validada"}</p><p>{vehicle.open_alerts} alertas abiertas · {numberLabel(vehicle.usage_km_per_day, 1)} km/día estimados</p></>}<Link href={`/vehiculos/${vehicle.id}`} className="text-button">Abrir información completa →</Link></details></td>{isAdmin && <td className="unit-status-column"><TrafficBadge value={vehicle.traffic_light}/></td>}<td className="numeric">{numberLabel(vehicle.current_km)} <span className="muted">km</span></td><td><Link className="icon-link" href={`/vehiculos/${vehicle.id}`} aria-label={`Ver unidad ${vehicle.plate}`}><Icon name="arrow"/></Link></td>
      </tr>)}</tbody></table></div>{visible.length > 8 && <button type="button" className="show-more-button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Mostrar menos" : `Mostrar más unidades (${visible.length - 8})`}</button>}</>}
    </section>
  </>;
}
