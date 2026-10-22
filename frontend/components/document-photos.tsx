"use client";

import {useState} from "react";
import {api, useResource} from "@/lib/api";
import {dateTimeLabel} from "@/lib/dates";
import type {DocumentType, Evidence, PhotoInput} from "@/lib/types";
import {ProgressiveList} from "./disclosure";
import {EvidenceButton, PhotoPicker} from "./photo-evidence";
import {ErrorBox, Loading, MutationForm} from "./ui";

const documentLabels: Record<DocumentType, string> = {
  verification: "Verificación", circulation: "Tarjeta de circulación", plates: "Placas",
  vehicle_tax: "Refrendo / tenencia", other: "Otro documento",
};

export default function DocumentPhotos({vehicleId}: {vehicleId: number}) {
  const resource = useResource<Evidence[]>(`vehicles/${vehicleId}/documents`);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  return <section id="fotos-documentacion" tabIndex={-1} className="document-photos" aria-label="Fotos de documentación">
    <h3>Fotos de documentación</h3>
    <MutationForm title="" submitLabel="Guardar fotos" onSave={async data => {
      if (preparing) throw new Error("Espera a que se preparen las fotos.");
      if (!photos.length) throw new Error("Selecciona al menos una foto del documento.");
      await api(`vehicles/${vehicleId}/documents`, {method: "POST", body: {
        document_type: data.get("document_type"), notes: String(data.get("document_notes") || "").trim(), photos,
      }});
      setPhotos([]); resource.refresh();
      return "Fotos guardadas en el expediente de esta unidad.";
    }}>
      <label>Documento<select name="document_type" required defaultValue="verification">{Object.entries(documentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <PhotoPicker label="Fotos del documento (máximo 3 por carga)" maximum={3} value={photos} onChange={setPhotos} onBusy={setPreparing}/>
      <label>Notas del documento (opcional)<textarea name="document_notes" rows={2} maxLength={2000}/></label>
    </MutationForm>
    <div className="inline between gap wrap"><h3>Documentos guardados</h3><button type="button" className="text-button" disabled={resource.loading} onClick={resource.refresh}>Actualizar fotos</button></div>
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {resource.loading && !resource.data ? <Loading label="Consultando documentos…"/> : resource.data?.length ? <ProgressiveList items={resource.data} initialCount={4} label="fotos" className="evidence-list" render={photo => <article className="evidence-row" key={photo.id}>
      <strong>{photo.document_type ? documentLabels[photo.document_type] : "Documento"}</strong>
      <p className="small muted">{photo.filename} · {dateTimeLabel(photo.captured_at)}</p>
      {photo.notes && <p className="administrative-notes">{photo.notes}</p>}
      <EvidenceButton photo={photo} label="Ver documento"/>
    </article>}/> : !resource.error && <p className="small muted">Sin fotografías documentales registradas.</p>}
  </section>;
}
