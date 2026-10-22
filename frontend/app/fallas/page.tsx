"use client";
import {useEffect, useState} from "react";
import {api, dateLabel, localDate, useResource} from "@/lib/api";
import {useAuth} from "@/lib/auth-context";
import type {Evidence, PhotoInput} from "@/lib/types";
import {CaptureUnitPicker, useCaptureUnit} from "@/components/capture-unit";
import EvidenceAttachment from "@/components/evidence-attachment";
import {PhotoPicker} from "@/components/photo-evidence";
import {Empty, ErrorBox, Loading, MutationForm, PageHeader, SeverityBadge, StatusBadge} from "@/components/ui";

function ResolveFault({id, onDone}: {id: number; onDone: () => void}) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const panelId = `fault-resolution-${id}`;
  return <div className="fault-resolution"><button type="button" className="button secondary" disabled={saving} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>{open ? "Cancelar solución" : "Registrar solución"}</button>{open && <div id={panelId} className="fault-resolution-panel" role="region" aria-label={`Registrar solución del reporte #${id}`}><MutationForm title="Solución aplicada" submitLabel="Guardar solución y cerrar reporte" onSave={async data => {
    if (preparing) throw new Error("Espera a que se preparen las fotos.");
    setSaving(true);
    try {await api(`faults/${id}/resolve`, {method: "PATCH", body: {resolution_notes: String(data.get("resolution_notes") || "").trim(), photos}}); setPhotos([]); return "Solución guardada. Reporte resuelto.";}
    finally {setSaving(false);}
  }} onDone={() => {setOpen(false); onDone();}}><label>Describe la solución aplicada<textarea name="resolution_notes" required minLength={8} maxLength={2000} rows={3} placeholder="Ej. Se reemplazó la pieza dañada y se comprobó el funcionamiento." autoFocus/></label><PhotoPicker label="Fotos de la solución (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/></MutationForm></div>}</div>;
}

export default function FaultsPage() {
  const state = useCaptureUnit();
  const {isAdmin} = useAuth();
  const evidence = useResource<Evidence[]>(`vehicles/${state.selected?.id || 0}/evidence`, !!state.selected);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState(6);
  const [filter, setFilter] = useState("open");
  useEffect(() => {setPhotos([]); setLimit(6);}, [state.unit]);
  const faults = [...(state.detail.data?.faults || [])].filter(fault => filter === "all" || fault.status !== "resolved").sort((a, b) => b.reported_on.localeCompare(a.reported_on) || b.id - a.id);
  const refresh = () => {state.refresh(); evidence.refresh();};
  return <><PageHeader eyebrow="ATENCIÓN DE LA UNIDAD" title="Fallas" description="Describe el problema y agrega fotos. Ante un riesgo, detén la operación y coordina asistencia; este reporte no sustituye un diagnóstico."/><CaptureUnitPicker state={state}/>
    {state.detail.error && <ErrorBox message={state.detail.error} retry={state.detail.refresh}/>}
    {state.selected && (state.detail.loading && !state.detail.data ? <Loading/> : state.detail.data && <>
      <section className="panel"><div className="panel-body"><MutationForm key={`${state.selected.id}-${revision}`} title="Reportar falla" submitLabel="Guardar reporte de falla" description="Indica el día en que detectaste el problema, aunque lo reportes después." onSave={async data => {
        if (preparing) throw new Error("Espera a que se preparen las fotos.");
        await api(`vehicles/${state.selected!.id}/faults`, {method: "POST", body: {reported_on: data.get("reported_on"), description: String(data.get("description") || "").trim(), severity: data.get("severity"), photos}});
        return photos.length ? "Falla y fotos registradas." : "Falla registrada con evidencia pendiente. Puedes agregar fotos después.";
      }} onDone={() => {setPhotos([]); setRevision(value => value + 1); refresh();}}>
        <div className="form-grid"><label>Fecha en que detectaste la falla<input name="reported_on" type="date" required min={state.detail.data.vehicle.in_service_date} max={localDate()} defaultValue={localDate()}/></label><label>Prioridad<select name="severity" defaultValue="importante"><option value="critico">Crítica: riesgo / unidad no segura</option><option value="importante">Importante: necesita revisión</option><option value="menor">Menor: detalle sin riesgo identificado</option></select></label></div><label>¿Qué problema observaste?<textarea name="description" rows={3} required minLength={8} maxLength={3000} placeholder="Ej. Se encendió un testigo, hay una fuga o ruido al frenar…"/></label><PhotoPicker label="Fotos de la falla (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/>
      </MutationForm></div></section>
      <section className="panel"><div className="panel-header"><h2>Reportes y seguimiento</h2><label><span className="sr-only">Filtrar fallas</span><select value={filter} onChange={event => {setFilter(event.target.value); setLimit(6);}}><option value="open">Pendientes</option><option value="all">Todos los reportes</option></select></label></div><div className="panel-body">{evidence.error && <ErrorBox message={evidence.error} retry={evidence.refresh}/>} {faults.length ? faults.slice(0, limit).map(fault => <article key={fault.id} className="service-row"><div className="inline gap wrap"><strong>Reporte #{fault.id} · {dateLabel(fault.reported_on)}</strong><SeverityBadge value={fault.severity}/><StatusBadge status={fault.status}/></div><p>{fault.description}</p><EvidenceAttachment vehicleId={state.selected!.id} target={{fault_id: fault.id}} photos={evidence.data?.filter(photo => photo.fault_id === fault.id) || fault.photos || []} onDone={refresh}/>{fault.resolution_notes && <p className="small"><strong>Solución:</strong> {fault.resolution_notes}</p>}{isAdmin && fault.status !== "resolved" && <ResolveFault id={fault.id} onDone={() => {setFilter("all"); refresh();}}/>}</article>) : <Empty title="Sin reportes en este filtro"/>}{faults.length > 6 && <button className="button secondary" onClick={() => setLimit(limit >= faults.length ? 6 : limit + 6)}>{limit >= faults.length ? "Mostrar menos" : "Mostrar más"}</button>}</div></section>
    </>)}
  </>;
}
