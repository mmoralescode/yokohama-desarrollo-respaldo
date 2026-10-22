"use client";
import {useState} from "react";
import {api, dateLabel, dateTimeLabel, localDate, localDateTime, mexicoDateTimeToISO, numberLabel, useResource} from "@/lib/api";
import type {Downtime, Evidence, Fault, MaintenanceType, PhotoInput, Reading, ServiceHistory, ServicePlan, Vehicle} from "@/lib/types";
import {Empty, MutationForm} from "./ui";
import {PhotoPicker} from "./photo-evidence";
import EvidenceAttachment from "./evidence-attachment";
import {MANUAL_DECIMAL_PATTERN, parseManualNumber} from "@/lib/manual-capture";

export const maintenanceLabels: Record<MaintenanceType, string> = {unknown: "Sin clasificar", preventive: "Preventivo (antes de falla)", corrective: "Correctivo (por falla)"};

export function UsageConditions({id, vehicle, onDone}: {id: string; vehicle: Vehicle; onDone: () => void}) {
  return <details className="panel"><summary className="panel-header"><h2>Configuración avanzada</h2><span className="muted small">Condiciones de uso e intervalos</span></summary><div className="panel-body"><MutationForm title="Condiciones de uso" description="El valor habitual es 1. Cambia el factor solo si hay una indicación técnica para adelantar el mantenimiento." submitLabel="Guardar condiciones" onDone={onDone} onSave={async data => {
    const factor = parseManualNumber(data.get("severity_multiplier"), "factor");
    if (factor < 0.1 || factor > 1) throw new Error("El factor debe estar entre 0.1 y 1.");
    await api(`vehicles/${id}`, {method: "PATCH", body: {severity_multiplier: factor, usage_regime: data.get("usage_regime")}});
    return "Condiciones guardadas. Plan recalculado.";
  }}><div className="form-grid"><label>Régimen de uso<select name="usage_regime" defaultValue={vehicle.usage_regime}><option value="normal">Normal</option><option value="severe">Severo (validar criterio técnico)</option></select></label><label>Ajuste del intervalo de mantenimiento<input name="severity_multiplier" aria-label="Ajuste del intervalo de mantenimiento" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} maxLength={8} defaultValue={vehicle.severity_multiplier ?? 1} required/><span className="field-help">1 = normal · 0.8 = 80 % del intervalo.</span></label></div></MutationForm></div></details>;
}

export function ReadingForm({id, vehicle, onDone}: {id: string; vehicle: Vehicle; onDone: () => void}) {
  return <MutationForm title="Registrar kilometraje" onDone={onDone} onSave={async data => {
    await api(`vehicles/${id}/readings`, {method: "POST", body: {recorded_at: mexicoDateTimeToISO(String(data.get("recorded_at"))), odometer_km: parseManualNumber(data.get("km")), source: "manual"}});
    return "Lectura guardada. Proyección recalculada.";
  }}><div className="form-grid"><label>Fecha y hora de lectura (CDMX)<input name="recorded_at" type="datetime-local" required min={`${vehicle.in_service_date}T00:00`} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Kilometraje (km)<input name="km" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} maxLength={20} required placeholder={String(vehicle.current_km)}/></label></div></MutationForm>;
}

export function ServiceForm({id, vehicle, services, faults, onDone}: {id: string; vehicle: Vehicle; services: ServicePlan[]; faults: Fault[]; onDone: () => void}) {
  const [kind, setKind] = useState<MaintenanceType>("unknown");
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  return <MutationForm title="Servicio realizado" onDone={onDone} onSave={async data => {
    if (preparing) throw new Error("Espera a que se preparen las fotos.");
    await api(`vehicles/${id}/services`, {method: "POST", body: {service_id: data.get("service_id"), performed_on: data.get("performed_on"), odometer_km: parseManualNumber(data.get("km")), notes: data.get("notes"), cost: parseManualNumber(data.get("cost"), "costo", true), maintenance_type: kind, fault_id: data.get("fault_id") ? Number(data.get("fault_id")) : null, photos}});
    setPhotos([]);
    return "Servicio registrado. Plan y métricas actualizados.";
  }}><label>Servicio del catálogo<select name="service_id" required defaultValue=""><option value="">Selecciona el servicio</option>{services.map(service => <option key={service.service_id} value={service.service_id}>{service.name}</option>)}</select></label><div className="form-grid"><label>Fecha realizada<input name="performed_on" type="date" required max={localDate()} min={vehicle.in_service_date} defaultValue={localDate()}/></label><label>Kilometraje (km)<input name="km" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} maxLength={20} required/></label><label>Costo (MXN, opcional)<input name="cost" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} maxLength={20} placeholder="Sin registrar"/></label><label>Tipo de mantenimiento<select name="maintenance_type" value={kind} onChange={event => setKind(event.target.value as MaintenanceType)}>{Object.entries(maintenanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {kind === "corrective" && <label>Falla atendida (opcional)<select name="fault_id" defaultValue=""><option value="">Sin asociación</option>{faults.map(fault => <option key={fault.id} value={fault.id}>#{fault.id} · {fault.description}</option>)}</select><span className="field-help">Vincular no cierra el reporte: confirma su resolución por separado.</span></label>}
    <label>Notas del trabajo<textarea name="notes" rows={3} maxLength={2000} placeholder="Comprobante, revisión o trabajo efectuado…"/></label><PhotoPicker label="Fotos del trabajo o comprobante (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/></MutationForm>;
}

export function ReadingHistory({readings}: {readings: Reading[]}) {
  const [limit, setLimit] = useState(8);
  return readings.length ? <><div className="history-scroll"><table><thead><tr><th>Fecha / hora CDMX</th><th>Kilometraje</th></tr></thead><tbody>{[...readings].sort((a, b) => (b.recorded_at || b.date).localeCompare(a.recorded_at || a.date)).slice(0, limit).map(reading => <tr key={reading.id}><td>{reading.recorded_at ? dateTimeLabel(reading.recorded_at) : dateLabel(reading.date)}</td><td className="numeric">{numberLabel(reading.odometer_km)} km</td></tr>)}</tbody></table></div>{readings.length > 8 && <button className="button secondary" onClick={() => setLimit(limit >= readings.length ? 8 : limit + 8)}>{limit >= readings.length ? "Mostrar menos" : "Mostrar más"}</button>}</> : <Empty title="Sin lecturas registradas"/>;
}

export function ServiceHistoryTable({history, names, id, onDone}: {history: ServiceHistory[]; names: Record<string, string>; id?: string; onDone?: () => void}) {
  const [limit, setLimit] = useState(6);
  const evidence = useResource<Evidence[]>(`vehicles/${id || 0}/evidence`, !!id);
  const records = [...history].sort((a, b) => b.performed_on.localeCompare(a.performed_on));
  return history.length ? <><div className="history-scroll"><table><thead><tr><th>Servicio</th><th>Fecha real / captura</th><th>Costo / pronóstico</th></tr></thead><tbody>{records.slice(0, limit).map(service => <tr key={service.id}><td><strong>{service.catalog_snapshot?.servicio || service.service_name || names[service.service_id] || service.service_id}</strong><span className="cell-sub">{maintenanceLabels[service.maintenance_type || "unknown"]}</span><span className="cell-sub">{service.notes}</span>{service.fault_id && <span className="cell-sub">Falla #{service.fault_id}</span>}{id && <EvidenceAttachment vehicleId={Number(id)} target={{service_id: service.id}} photos={evidence.data?.filter(photo => photo.service_id === service.id) || []} onDone={() => {evidence.refresh(); onDone?.();}}/>}</td><td>{dateLabel(service.performed_on)}<span className="cell-sub">{service.odometer_km == null ? "Kilometraje sin registrar" : `${numberLabel(service.odometer_km)} km`}</span>{service.captured_at && <span className="cell-sub">Capturado: {dateTimeLabel(service.captured_at)}</span>}</td><td>{service.cost == null ? "Sin costo registrado" : new Intl.NumberFormat("es-MX", {style: "currency", currency: "MXN"}).format(service.cost)}{service.predicted_due_date && <span className="cell-sub">Previsto: {dateLabel(service.predicted_due_date)}</span>}<span className="cell-sub">{service.prediction_error_days == null ? "Sin predicción previa comparable" : service.prediction_error_days === 0 ? "Realizado en la fecha prevista" : `${numberLabel(Math.abs(service.prediction_error_days))} días ${service.prediction_error_days < 0 ? "antes" : "después"} de lo previsto`}</span></td></tr>)}</tbody></table></div>{history.length > 6 && <button className="button secondary" onClick={() => setLimit(limit >= history.length ? 6 : limit + 6)}>{limit >= history.length ? "Mostrar menos" : "Mostrar más"}</button>}</> : <Empty title="Sin historial de servicios">No se presume que los componentes se atendieron al kilometraje cero.</Empty>;
}

function CloseDowntime({id, entry, onDone}: {id: string; entry: Downtime; onDone: () => void}) {
  const [closing, setClosing] = useState(false);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  return <><button className="text-button" onClick={() => setClosing(value => !value)} aria-expanded={closing}>{closing ? "Cancelar" : "Registrar regreso a operación"}</button>{closing && <MutationForm title="Fin del periodo fuera de servicio" submitLabel="Cerrar periodo" onDone={onDone} onSave={async data => {
    if (preparing) throw new Error("Espera a que se preparen las fotos.");
    await api(`vehicles/${id}/downtime/${entry.id}`, {method: "PATCH", body: {ended_at: mexicoDateTimeToISO(String(data.get("ended_at"))), notes: data.get("notes"), photos}});
    setPhotos([]); setClosing(false);
    return "Periodo cerrado. No modifica el estado de las fallas: confirma su resolución cuando corresponda.";
  }}><label>Regreso a operación (CDMX)<input name="ended_at" type="datetime-local" required min={localDateTime(new Date(entry.started_at))} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Notas<textarea name="notes" maxLength={2000} rows={2} defaultValue={entry.notes}/></label><PhotoPicker label="Fotos del regreso a operación (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/></MutationForm>}</>;
}

export function DowntimePanel({id, vehicle, entries, onDone}: {id: string; vehicle: Vehicle; entries: Downtime[]; onDone: () => void}) {
  const [adding, setAdding] = useState(false);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [limit, setLimit] = useState(5);
  return <section className="panel"><div className="panel-header"><h2>Periodos fuera de servicio</h2><button className="button secondary small-button" onClick={() => setAdding(value => !value)} aria-expanded={adding}>{adding ? "Cerrar registro" : "Registrar periodo"}</button></div><div className="panel-body">
    {adding && <MutationForm title="Unidad fuera de servicio" onDone={onDone} onSave={async data => {
      if (preparing) throw new Error("Espera a que se preparen las fotos.");
      await api(`vehicles/${id}/downtime`, {method: "POST", body: {started_at: mexicoDateTimeToISO(String(data.get("started_at"))), ended_at: data.get("ended_at") ? mexicoDateTimeToISO(String(data.get("ended_at"))) : null, notes: data.get("notes"), photos}});
      setPhotos([]); setAdding(false);
      return "Periodo registrado. Métricas actualizadas.";
    }}><div className="form-grid"><label>Inicio (CDMX)<input type="datetime-local" name="started_at" required min={`${vehicle.in_service_date}T00:00`} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Regreso (opcional, CDMX)<input type="datetime-local" name="ended_at" min={`${vehicle.in_service_date}T00:00`} max={localDateTime()}/></label></div><label>Motivo / notas<textarea name="notes" maxLength={2000} rows={2}/></label><PhotoPicker label="Fotos de la unidad fuera de servicio (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/></MutationForm>}
    {entries.length ? [...entries].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, limit).map(entry => <article className="service-row" key={entry.id}><div className="inline gap wrap"><strong>{dateTimeLabel(entry.started_at)}</strong><span>→ {entry.ended_at ? dateTimeLabel(entry.ended_at) : "Sigue fuera de servicio"}</span></div><p className="muted small">{entry.notes || "Sin notas"}</p><EvidenceAttachment vehicleId={Number(id)} target={{downtime_id: entry.id}} photos={entry.photos} onDone={onDone}/>{!entry.ended_at && <CloseDowntime id={id} entry={entry} onDone={onDone}/>}</article>) : <Empty title="Sin periodos registrados">Cero días registrados no garantiza que no haya existido indisponibilidad.</Empty>}
    {entries.length > 5 && <button className="button secondary" onClick={() => setLimit(limit >= entries.length ? 5 : limit + 5)}>{limit >= entries.length ? "Mostrar menos" : "Mostrar más"}</button>}
  </div></section>;
}
