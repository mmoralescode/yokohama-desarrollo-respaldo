"use client";
import Link from "next/link";
import {useState} from "react";
import {api, dateLabel, dateTimeLabel, localDate, useResource} from "@/lib/api";
import {useAuth} from "@/lib/auth-context";
import type {Incident, IncidentCategory, IncidentStatus, PhotoInput, Vehicle} from "@/lib/types";
import {Empty, ErrorBox, Loading, MutationForm} from "./ui";
import {EvidenceButton, PhotoPicker} from "./photo-evidence";
import EvidenceAttachment from "./evidence-attachment";

export const incidentCategories: Record<IncidentCategory, string> = {accidente: "Accidente", averia: "Avería", documentacion: "Documentación", otro: "Otro"};
export const incidentStatuses: Record<IncidentStatus, string> = {abierta: "Abierta", en_revision: "En revisión", resuelta: "Resuelta"};

export function IncidentForm({vehicles, fixedVehicle, onDone}: {vehicles: Vehicle[]; fixedVehicle?: number; onDone: () => void}) {
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return <>{notice && <p className="message success" role="status">{notice}</p>}<MutationForm key={revision} title="Registrar incidencia" description="Indica cuándo ocurrió, no cuándo la estás capturando. Puedes adjuntar hasta tres fotos y registrar el reporte aunque todavía no tengas evidencias." submitLabel="Guardar incidencia" onSave={async data => {
    if (preparing) throw new Error("Espera a que terminen de prepararse las fotos.");
    const vehicleId = fixedVehicle || Number(data.get("vehicle_id"));
    await api(`vehicles/${vehicleId}/incidents`, {method: "POST", body: {occurred_on: data.get("occurred_on"), category: data.get("category"), description: String(data.get("description") || "").trim(), photos}});
    return "Incidencia registrada.";
  }} onDone={() => {setNotice(photos.length ? "Incidencia y fotos guardadas." : "Incidencia guardada con evidencia pendiente. Puedes agregar fotos después."); setPhotos([]); setRevision(value => value + 1); onDone();}}>
    {!fixedVehicle && <label>Unidad<select name="vehicle_id" required defaultValue=""><option value="">Selecciona placa o apodo</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate}{vehicle.nickname ? ` · ${vehicle.nickname}` : ""}</option>)}</select></label>}
    <div className="form-grid"><label>Fecha en que ocurrió<input type="date" name="occurred_on" required max={localDate()} defaultValue={localDate()}/></label><label>Tipo de incidencia<select name="category" defaultValue="otro">{Object.entries(incidentCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <label>¿Qué ocurrió?<textarea name="description" rows={4} required minLength={8} maxLength={3000} placeholder="Describe lo sucedido, dónde ocurrió y qué atención se necesita…"/></label>
    <PhotoPicker label="Fotos de la incidencia (opcionales, máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/>
    <p className="field-help">Este reporte administrativo no sustituye la atención de una emergencia ni genera un diagnóstico mecánico. Si existe riesgo, detén la operación y coordina asistencia.</p>
  </MutationForm></>;
}

export function IncidentCard({incident, onDone}: {incident: Incident; onDone: () => void}) {
  const {isAdmin} = useAuth();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<IncidentStatus>(incident.status);
  const [followupPhotos, setFollowupPhotos] = useState<PhotoInput[]>([]);
  const [preparingFollowup, setPreparingFollowup] = useState(false);
  return <article className="incident-card"><div className="inline gap wrap"><Link className="plate-link" href={`/vehiculos/${incident.vehicle_id}`}>{incident.plate}</Link>{incident.nickname && <strong>{incident.nickname}</strong>}<span className={`incident-tag ${incident.status}`}>{incidentStatuses[incident.status]}</span><span className="badge neutral">{incidentCategories[incident.category]}</span></div>
    <p className="small muted">Ocurrió: {dateLabel(incident.occurred_on)} · Capturada: {dateTimeLabel(incident.captured_at)}</p><p className="incident-description">{incident.description}</p>
    <EvidenceAttachment vehicleId={incident.vehicle_id} target={{incident_id: incident.id}} photos={incident.photos} onDone={onDone}/>
    {incident.resolution_notes && <p className="small incident-description"><strong>Seguimiento: </strong>{incident.resolution_notes}</p>}
    {isAdmin && <div className="incident-actions"><button type="button" className="text-button" aria-expanded={editing} onClick={() => {setStatus(incident.status); setEditing(!editing);}}>{editing ? "Cancelar seguimiento" : "Actualizar seguimiento"}</button>{editing && <MutationForm title="Seguimiento de la incidencia" submitLabel="Guardar seguimiento" onDone={() => {setEditing(false); onDone();}} onSave={async data => {
      if (preparingFollowup) throw new Error("Espera a que se preparen las fotos.");
      await api(`incidents/${incident.id}`, {method: "PATCH", body: {status, resolution_notes: String(data.get("resolution_notes") || "").trim(), photos: followupPhotos}}); setFollowupPhotos([]); return "Seguimiento actualizado.";
    }}><label>Estado<select value={status} onChange={event => setStatus(event.target.value as IncidentStatus)}>{Object.entries(incidentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Acciones realizadas / resolución<textarea name="resolution_notes" defaultValue={incident.resolution_notes || ""} rows={3} maxLength={2000} required={status === "resuelta"} minLength={status === "resuelta" ? 8 : undefined}/></label><PhotoPicker label="Fotos del seguimiento (máximo 3)" maximum={3} value={followupPhotos} onChange={setFollowupPhotos} onBusy={setPreparingFollowup}/><p className="field-help">Resolver esta incidencia no cierra automáticamente una falla mecánica ni modifica servicios.</p></MutationForm>}</div>}
  </article>;
}
export function VehicleIncidents({vehicle}: {vehicle: Vehicle}) {
  const resource = useResource<Incident[]>(`vehicles/${vehicle.id}/incidents`);
  const [adding, setAdding] = useState(false);
  return <section className="panel administrative-panel"><div className="panel-header"><div><p className="eyebrow">REGISTRO Y SEGUIMIENTO</p><h2>Incidencias de la unidad</h2></div><button type="button" className="button secondary small-button" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? "Cerrar registro" : "Reportar incidencia"}</button></div><div className="panel-body">{adding && <IncidentForm vehicles={[vehicle]} fixedVehicle={vehicle.id} onDone={resource.refresh}/>}{resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}{resource.loading && !resource.data ? <Loading/> : resource.data?.length ? <div className="incident-list">{resource.data.map(incident => <IncidentCard key={incident.id} incident={incident} onDone={resource.refresh}/>)}</div> : !resource.error && <Empty title="Sin incidencias registradas">Agrega reportes y fotografías aunque se capturen días después de lo ocurrido.</Empty>}</div></section>;
}
