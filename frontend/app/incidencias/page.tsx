"use client";
import {useEffect, useState} from "react";
import {useResource} from "@/lib/api";
import {matchesVehicle} from "@/lib/vehicle-administration";
import {useAuth} from "@/lib/auth-context";
import type {Incident, VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader} from "@/components/ui";
import {IncidentCard, IncidentForm, incidentStatuses} from "@/components/incidents";

export default function IncidentsPage() {
  const resource = useResource<Incident[]>("incidents");
  const fleet = useResource<VehicleSummary[]>("vehicles");
  const {isAdmin} = useAuth();
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState<number | undefined>();
  const [limit, setLimit] = useState(6);
  useEffect(() => {const value = new URLSearchParams(window.location.search).get("unidad"); if (value && /^[1-9]\d*$/.test(value)) {setUnit(Number(value)); setAdding(true);}}, []);
  const selected = fleet.data?.find(vehicle => vehicle.id === unit);
  const visible = (resource.data || []).filter(incident => (!unit || incident.vehicle_id === unit) && (status === "all" || incident.status === status) && matchesVehicle(fleet.data?.find(vehicle => vehicle.id === incident.vehicle_id) || {plate: incident.plate, nickname: incident.nickname}, search));
  return <><PageHeader eyebrow="CONTROL ADMINISTRATIVO" title="Incidencias" description={isAdmin ? "Reportes, fotografías y seguimiento de las unidades, en un solo lugar." : "Registra lo ocurrido en tus unidades asignadas y consulta su seguimiento."} action={<button type="button" className="button primary" aria-expanded={adding} onClick={() => setAdding(!adding)}><Icon name="plus"/>{adding ? "Cerrar registro" : "Reportar incidencia"}</button>}/>
    {fleet.error && <ErrorBox message={fleet.error} retry={fleet.refresh}/>} {selected && <p className="message">Unidad: {selected.plate}{selected.nickname ? ` · ${selected.nickname}` : ""} <button className="text-button" onClick={() => setUnit(undefined)}>Ver todas mis unidades disponibles</button></p>} {adding && <section className="panel"><div className="panel-body">{fleet.loading && !fleet.data ? <Loading/> : fleet.data?.length ? <IncidentForm vehicles={fleet.data} fixedVehicle={selected?.id} onDone={resource.refresh}/> : <Empty title="Sin unidades disponibles">Un administrador debe asignarte una unidad antes de registrar incidencias.</Empty>}</div></section>}
    <section className="panel"><div className="panel-header"><h2>Reportes y seguimiento</h2><span className="muted small">{resource.data ? `${visible.length} incidencias` : "Consultando…"}</span></div><div className="panel-body"><div className="incident-toolbar"><label>Placa, terminación o apodo<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Últimos 4 caracteres, placa o apodo"/></label><label>Estado del reporte<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Todos los estados</option>{Object.entries(incidentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>} {resource.loading && !resource.data ? <Loading/> : visible.length ? <><div className="incident-list">{visible.slice(0, limit).map(incident => <IncidentCard key={incident.id} incident={incident} onDone={resource.refresh}/>)}</div>{visible.length > 6 && <button className="button secondary" onClick={() => setLimit(limit >= visible.length ? 6 : limit + 6)}>{limit >= visible.length ? "Mostrar menos" : "Mostrar más"}</button>}</> : !resource.error && <Empty title={search || status !== "all" ? "Sin coincidencias" : "Sin incidencias registradas"}>Los reportes conservan tanto la fecha real como la fecha de captura.</Empty>}</div></section>
  </>;
}
