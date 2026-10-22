"use client";
import {FormEvent, useState} from "react";
import {api, dateLabel, dateTimeLabel, localDateTime, mexicoDateTimeToISO, numberLabel, useResource} from "@/lib/api";
import type {Evidence, PhotoInput, Reading, Vehicle} from "@/lib/types";
import {Empty, ErrorBox, Loading, MutationForm} from "./ui";
import {EvidenceButton, PhotoPicker} from "./photo-evidence";
import {MANUAL_DECIMAL_PATTERN, parseManualNumber} from "@/lib/manual-capture";

export function OdometerCapture({id, vehicle, onDone}: {id: string; vehicle: Vehicle; onDone: () => void}) {
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || preparing) return;
    const data = new FormData(event.currentTarget); setBusy(true); setError(null); setNotice(null);
    try {
      await api<Reading>(`vehicles/${id}/odometer-captures`, {method: "POST", body: {recorded_at: mexicoDateTimeToISO(String(data.get("recorded_at"))), odometer_km: parseManualNumber(data.get("km")), source: "manual", notes: String(data.get("notes") || ""), photos}});
      setNotice(photos.length ? "Kilometraje y fotos guardados." : "Kilometraje guardado. Puedes agregar fotos después.");
      setPhotos([]); setFormRevision(value => value + 1); onDone();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo guardar el registro.");
    } finally {setBusy(false);}
  }
  return <form className="mutation-form" onSubmit={submit}><h3>Registrar kilometraje</h3><fieldset disabled={busy}>
    <fieldset key={formRevision}><div className="form-grid"><label>Fecha y hora de lectura (CDMX)<input name="recorded_at" type="datetime-local" required min={`${vehicle.in_service_date}T00:00`} max={localDateTime()} defaultValue={localDateTime()}/></label><label>Kilometraje (km)<input name="km" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} maxLength={20} required placeholder={String(vehicle.current_km)}/></label></div></fieldset>
    <PhotoPicker label="Fotos del kilometraje (máximo 3)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/><label>Notas (opcional)<textarea name="notes" rows={2} maxLength={2000}/></label>
    <button className="button primary" type="submit" disabled={preparing}>{busy ? "Guardando…" : "Guardar kilometraje"}</button>
  </fieldset>{error && <ErrorBox message={error}/>} {notice && <p role="status" className="message success">{notice}</p>}</form>;
}

export default function OdometerEvidence({id, readings, revision}: {id: string; readings: Reading[]; revision?: string}) {
  const resource = useResource<Evidence[]>(`vehicles/${id}/odometer-evidence${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [adding, setAdding] = useState(false);
  return <section className="panel administrative-panel"><div className="panel-header"><div><h2>Evidencias del kilometraje</h2></div><button type="button" className="button secondary small-button" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? "Cerrar formulario" : "Adjuntar foto a una lectura"}</button></div><div className="panel-body">
    {adding && (readings.length ? <MutationForm title="Foto de una lectura existente" submitLabel="Guardar evidencia" onDone={() => {setPhotos([]); resource.refresh();}} onSave={async data => {
      if (preparing) throw new Error("Espera a que se prepare la fotografía.");
      if (!photos[0]) throw new Error("Selecciona una foto del kilometraje.");
      await api(`vehicles/${id}/odometer-evidence`, {method: "POST", body: {reading_id: Number(data.get("reading_id")), notes: String(data.get("notes") || ""), photo: photos[0]}});
      return "Foto adjunta a la lectura; no se creó una lectura duplicada.";
    }}><label>Lectura a respaldar<select name="reading_id" required defaultValue=""><option value="">Selecciona fecha y kilometraje</option>{[...readings].sort((a, b) => (b.recorded_at || b.date).localeCompare(a.recorded_at || a.date)).map(reading => <option value={reading.id} key={reading.id}>{reading.recorded_at ? dateTimeLabel(reading.recorded_at) : dateLabel(reading.date)} · {numberLabel(reading.odometer_km)} km</option>)}</select></label><PhotoPicker label="Foto del kilometraje" value={photos} onChange={setPhotos} onBusy={setPreparing}/><label>Notas (opcional)<textarea name="notes" maxLength={2000} rows={2}/></label></MutationForm> : <p className="message">Primero registra el kilometraje.</p>)}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}{resource.loading && !resource.data ? <Loading/> : resource.data?.length ? <div className="evidence-list">{resource.data.map(photo => <article key={photo.id} className="evidence-row"><strong>{numberLabel(photo.odometer_km)} km · {dateLabel(photo.observed_on)}</strong><p className="small muted">Foto cargada: {dateTimeLabel(photo.captured_at)}</p>{photo.notes && <p className="small">{photo.notes}</p>}<EvidenceButton photo={photo}/></article>)}</div> : !resource.error && <Empty title="Sin fotos del kilometraje">Las lecturas y pronósticos existentes se conservan.</Empty>}
  </div></section>;
}
