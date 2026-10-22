"use client";
import Link from "next/link";
import {useEffect, useState} from "react";
import {dateLabel, dateTimeLabel, localDate, numberLabel, useResource} from "@/lib/api";
import type {VehicleSummary, Visit} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, StatusBadge} from "@/components/ui";
import CalendarEntryForm, {type CalendarAction} from "@/components/calendar-entry-form";
import {matchesDriverNames} from "@/lib/drivers";
import {matchesVehicle} from "@/lib/vehicle-administration";
import {useAuth} from "@/lib/auth-context";
import {DriverNames} from "@/components/vehicle-drivers";
import VehicleSearchFields from "@/components/vehicle-search-fields";
import {ProgressiveList} from "@/components/disclosure";
import CalendarServiceEvidence from "@/components/calendar-service-evidence";

export default function CalendarPage() {
  const {isAdmin} = useAuth();
  const [month, setMonth] = useState(() => localDate().slice(0, 7));
  const [action, setAction] = useState<CalendarAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedMonth = parameters.get("mes");
    if (requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)) setMonth(requestedMonth);
    const plate = parameters.get("placa");
    if (plate) setSearch(plate);
    const unit = parameters.get("unidad");
    if (unit && /^[1-9]\d*$/.test(unit)) setAction({mode: "complete", vehicleId: Number(unit)});
    else if (parameters.get("registro") === "1") setAction({mode: "complete"});
  }, []);
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : localDate().slice(0, 7);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const start = `${safeMonth}-01`;
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const resource = useResource<Visit[]>(`calendar?start=${start}&end=${end}`);
  const fleet = useResource<VehicleSummary[]>("vehicles");
  const catalog = useResource<{servicios: {id: string; servicio: string}[]}>("catalog");
  const names = Object.fromEntries((catalog.data?.servicios || []).map(service => [service.id, service.servicio]));
  const allVisits = resource.data || [];
  const vehiclesById = new Map((fleet.data || []).map(vehicle => [vehicle.id, vehicle]));
  const driversByVehicle = new Map((fleet.data || []).map(vehicle => [vehicle.id, vehicle.drivers || []]));
  const visitDrivers = (visit: Visit) => driversByVehicle.get(visit.vehicle_id || 0) ?? visit.drivers ?? [];
  const visits = allVisits.filter(visit => (filter === "all" || (filter === "completed" ? visit.status === "completed" : visit.status !== "completed")) && matchesVehicle(vehiclesById.get(visit.vehicle_id || 0) || {plate: visit.plate, version: visit.version}, search) && matchesDriverNames(visitDrivers(visit), driverSearch));
  const groups = visits.reduce<Record<string, Visit[]>>((result, visit) => { (result[visit.performed_on || visit.planned_date] ||= []).push(visit); return result; }, {});
  const monthLabel = new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", month: "long", year: "numeric"}).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const totalDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = localDate();
  function moveMonth(delta: number) {setMonth(new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7));}
  function begin(next: CalendarAction) {setNotice(null); setAction(next);}
  function saved(date: string, message: string) {setAction(null); setNotice(message); setMonth(date.slice(0, 7)); setFilter("all"); setSearch(""); setDriverSearch(""); resource.refresh(); fleet.refresh();}
  return <>
    <PageHeader eyebrow="" title="Calendario" description="" action={<div className="inline gap wrap calendar-heading-actions">{isAdmin && <button className="button primary" onClick={() => begin({mode: "complete"})} disabled={!!action}><Icon name="check" size={17}/>Registrar servicio realizado</button>}<button className="button secondary" onClick={() => {resource.refresh(); fleet.refresh();}} disabled={resource.loading || !!action}><Icon name="refresh" size={17}/>Actualizar</button></div>}/>
    {notice && <div className="message success" role="status"><Icon name="check"/><div><strong>Guardado</strong><p>{notice}</p></div></div>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {fleet.error && <ErrorBox message={fleet.error} retry={fleet.refresh}/>}
    {isAdmin && action && (fleet.loading && !fleet.data ? <Loading label="Cargando unidades…"/> : <CalendarEntryForm key={`${action.mode}-${action.visit?.id || "new"}`} action={action} vehicles={fleet.data || []} onClose={() => setAction(null)} onSaved={saved}/>)}
    <div className="calendar-layout calendar-simple-layout"><section className="panel calendar-panel"><div className="panel-header"><h2 className="capitalize">{monthLabel}</h2><div className="calendar-controls"><button className="icon-link" onClick={() => moveMonth(-1)} aria-label="Mes anterior">←</button><label><span className="sr-only">Mes de visitas</span><input type="month" value={month} onChange={e => setMonth(e.target.value)}/></label><button className="icon-link" onClick={() => moveMonth(1)} aria-label="Mes siguiente">→</button></div></div>
      <div className="calendar-grid" aria-label={`Agenda de ${monthLabel}`}>{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => <div key={day} className="calendar-weekday">{day}</div>)}{Array.from({length: firstWeekday}, (_, index) => <div key={`blank-${index}`} className="calendar-day blank"/>)}{Array.from({length: totalDays}, (_, index) => {
        const date = `${safeMonth}-${String(index + 1).padStart(2, "0")}`;
        const dayVisits = groups[date] || [];
        return <div key={date} className={`calendar-day ${today === date ? "today" : ""} ${dayVisits.length ? "has-visits" : ""}`}><span className="day-number">{index + 1}{date === today && <span className="sr-only">, hoy</span>}</span>{dayVisits.length > 0 && <a href={`#dia-${date}`} className={`day-visits ${dayVisits.every(visit => visit.status === "completed") ? "day-completed" : ""}`} aria-label={`${dateLabel(date)}: ${dayVisits.length} registros`}><span className="desktop-label">{dayVisits.length} {dayVisits.length === 1 ? "registro" : "registros"}</span><span className="mobile-label">{dayVisits.length}</span></a>}</div>;
      })}</div></section>
    </div>
    <section className="panel"><div className="panel-header"><h2>Servicios</h2><span className="badge neutral">{visits.length} registros</span></div>
      <div className="table-toolbar"><VehicleSearchFields plateLabel="Buscar por placa, terminación o apodo" platePlaceholder="Placa, últimos 4 caracteres o apodo" plate={search} driver={driverSearch} onPlateChange={setSearch} onDriverChange={setDriverSearch}/><label><span className="sr-only">Filtrar agenda</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los registros</option><option value="pending">Por atender</option><option value="completed">Realizados</option></select></label></div>
      {resource.loading && !resource.data ? <Loading/> : !visits.length ? <Empty title="Sin registros en este periodo"/> : <div className="panel-body">{Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => <div id={`dia-${date}`} key={date} className="agenda-day"><h3>{dateLabel(date)}</h3><ProgressiveList items={entries} initialCount={3} label="registros" render={visit => {
        const done = visit.status === "completed";
        const rescheduled = !done && !!visit.original_date && visit.original_date !== visit.planned_date;
        return <article key={`${visit.vehicle_id}-${visit.id}`} className={`agenda-entry ${done ? "agenda-completed" : ""}`}><div><Link className="plate-link" href={`/vehiculos/${visit.vehicle_id}`}>{visit.plate}</Link><span className="cell-sub">{visit.version}</span><DriverNames drivers={visitDrivers(visit)}/></div><div><strong>{done ? "Servicio realizado" : visit.fault_ids?.length ? `Atención de ${visit.fault_ids.length} ${visit.fault_ids.length === 1 ? "falla" : "fallas"}${visit.service_ids.length ? ` y ${visit.service_ids.length} servicios` : ""}` : `${visit.service_ids.length} ${visit.service_ids.length === 1 ? "servicio" : "servicios agrupados"}`}</strong><details className="service-details"><summary>Mostrar más</summary><ul className="compact-list">{visit.service_ids.map((service, index) => <li key={service}>{visit.service_names?.[index] || names[service] || service}</li>)}{visit.fault_ids?.map(fault => <li key={`fault-${fault}`}>Reporte de falla #{fault}</li>)}</ul>{visit.notes && <p className="small">{visit.notes}</p>}{done && visit.captured_at && <p className="cell-sub">Capturado: {dateTimeLabel(visit.captured_at)}</p>}{done && <CalendarServiceEvidence visit={visit}/>}</details>
          {(!!visit.changes?.length || rescheduled) && <details className="calendar-date-history"><summary>Ver cambios de fecha ({visit.changes?.length || 1})</summary><ul>{visit.changes?.length ? visit.changes.map((change, index) => <li key={`${change.changed_at}-${index}`}>{dateLabel(change.previous_date)} → {dateLabel(change.scheduled_date)}{change.notes ? ` · ${change.notes}` : ""}</li>) : <li>{dateLabel(visit.original_date)} → {dateLabel(visit.planned_date)}</li>}</ul></details>}
          {visit.status === "immediate" && <p className="critical-text">Atender de inmediato; ante falla crítica, detener operación y coordinar traslado seguro.</p>}
        </div><div className="agenda-entry-actions"><StatusBadge status={rescheduled ? "rescheduled" : visit.status}/>{!done && <><span className="cell-sub">{visit.provisional ? "Propuesta por confirmar" : visit.appointment_id ? "Fecha registrada" : "Por confirmar"}</span><span className="cell-sub">{visit.total_duration_hours == null ? "Duración por validar" : `${numberLabel(visit.total_duration_hours, 1)} h estimadas`}</span>{isAdmin && (visit.service_ids.length > 0 ? <><button type="button" className="button secondary small-button" onClick={() => begin({mode: "reschedule", visit})} disabled={!!action}><Icon name="calendar" size={15}/>Cambiar fecha</button><button type="button" className="button primary small-button" onClick={() => begin({mode: "complete", visit})} disabled={!!action}><Icon name="check" size={15}/>Registrar realizado</button></> : <Link className="button secondary small-button" href={`/fallas?unidad=${visit.vehicle_id}`}>Atender falla<Icon name="arrow" size={15}/></Link>)}</>}</div></article>;
      }}/></div>)}</div>}</section>
  </>;
}
