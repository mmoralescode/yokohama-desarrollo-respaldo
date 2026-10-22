"use client";
import {useState} from "react";
import {api} from "@/lib/api";
import type {Evidence, PhotoInput} from "@/lib/types";
import {MutationForm} from "./ui";
import {EvidenceButton, PhotoPicker} from "./photo-evidence";

type Target = {reading_id: number} | {incident_id: string} | {fault_id: number} | {service_id: number} | {downtime_id: number};
export default function EvidenceAttachment({vehicleId, target, photos = [], onDone}: {vehicleId: number; target: Target; photos?: Evidence[]; onDone: () => void}) {
  const [adding, setAdding] = useState(false);
  const [inputs, setInputs] = useState<PhotoInput[]>([]);
  const [preparing, setPreparing] = useState(false);
  return <div className="evidence-actions">{photos.length ? photos.map((photo, index) => <EvidenceButton key={photo.id} photo={photo} label={`Ver foto ${index + 1}`}/>) : <span className="badge neutral">Evidencia pendiente</span>}
    <button type="button" className="text-button" aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? "Cancelar fotos" : "Agregar fotos"}</button>
    {adding && <MutationForm title="Adjuntar evidencia a este registro" submitLabel="Guardar fotos" onSave={async data => {
      if (preparing) throw new Error("Espera a que se preparen las fotos.");
      if (!inputs.length) throw new Error("Selecciona al menos una foto.");
      await api(`vehicles/${vehicleId}/evidence`, {method: "POST", body: {...target, notes: String(data.get("photo_notes") || ""), photos: inputs}});
      return "Fotos guardadas sin duplicar el reporte.";
    }} onDone={() => {setInputs([]); setAdding(false); onDone();}}><PhotoPicker label="Fotos de evidencia (máximo 3 por carga)" maximum={3} value={inputs} onChange={setInputs} onBusy={setPreparing}/><label>Notas de la evidencia (opcional)<textarea name="photo_notes" rows={2} maxLength={2000}/></label></MutationForm>}
  </div>;
}
