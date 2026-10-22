"use client";
import {useEffect, useRef, useState} from "react";
import {api} from "@/lib/api";
import {preparePhoto} from "@/lib/photos";
import type {Evidence, PhotoInput} from "@/lib/types";
import {ErrorBox, Loading} from "./ui";
import "./administration.css";

export function PhotoPicker({value, onChange, onBusy, maximum = 1, label = "Foto del kilometraje (opcional)"}: {value: PhotoInput[]; onChange: (value: PhotoInput[]) => void; onBusy: (busy: boolean) => void; maximum?: number; label?: string}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => {generation.current++; onBusy(false);}, [onBusy]);
  return <div className="photo-input"><label>{label}<input type="file" accept="image/jpeg,image/png,image/webp" multiple={maximum > 1} disabled={busy} onChange={async event => {
    const files = Array.from(event.target.files || []); event.target.value = "";
    setError(null);
    if (!files.length) return;
    if (files.length + value.length > maximum) {setError(`Puedes agregar como máximo ${maximum} ${maximum === 1 ? "foto" : "fotos"}. Quita una vista previa para reemplazarla.`); return;}
    const current = ++generation.current;
    setBusy(true); onBusy(true);
    try {const photos = await Promise.all(files.map(preparePhoto)); if (generation.current === current) onChange([...value, ...photos]);}
    catch (error) {if (generation.current === current) setError(error instanceof Error ? error.message : "No se pudieron preparar las fotos.");}
    finally {if (generation.current === current) {setBusy(false); onBusy(false);}}
  }}/></label><span className="field-help">JPG, PNG o WebP · hasta 20 MB por original.</span>
    {busy && <Loading label="Preparando fotografía…"/>}{error && <ErrorBox message={error}/>}
    {!!value.length && <div className="photo-previews">{value.map((photo, index) => <figure className="photo-preview" key={`${photo.filename}-${index}`}><img src={photo.data_url} alt={`Vista previa: ${photo.filename}`}/><figcaption>{photo.filename}</figcaption><button type="button" className="text-button" onClick={() => onChange(value.filter((_, position) => position !== index))}>Quitar foto {index + 1}</button></figure>)}</div>}
  </div>;
}

export function EvidenceButton({photo, label = "Ver foto"}: {photo: Evidence; label?: string}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="button secondary small-button" onClick={() => setOpen(true)}>{label}</button>{open && <EvidenceViewer photo={photo} onClose={() => setOpen(false)}/>}</>;
}
function EvidenceViewer({photo, onClose}: {photo: Evidence; onClose: () => void}) {
  const [data, setData] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(null);
    api<Evidence>(`evidence/${photo.id}`, {signal: controller.signal}).then(value => {
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value.data_url || "")) throw new Error("La evidencia recibida no es una imagen válida.");
      if (!controller.signal.aborted) setData(value);
    }).catch(error => {if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "No se pudo abrir la fotografía.");});
    return () => controller.abort();
  }, [photo.id, revision]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="evidence-viewer" onClick={event => {if (event.target === event.currentTarget) onClose();}}><div ref={dialog} className="evidence-dialog" role="dialog" aria-modal="true" aria-label="Fotografía adjunta" onKeyDown={event => {
    if (event.key === "Escape") onClose();
    if (event.key === "Tab") {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
    }
  }}><div className="inline gap wrap"><strong>{photo.filename}</strong><button className="button secondary" type="button" onClick={onClose}>Cerrar foto</button></div>{error ? <ErrorBox message={error} retry={() => setRevision(value => value + 1)}/> : data ? <img src={data.data_url} alt={`Evidencia: ${photo.filename}`}/> : <Loading label="Abriendo fotografía…"/>}</div></div>;
}
