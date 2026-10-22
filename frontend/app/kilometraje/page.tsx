"use client";
import {useEffect, useState} from "react";
import {dateLabel, dateTimeLabel, numberLabel, useResource} from "@/lib/api";
import type {Evidence} from "@/lib/types";
import {CaptureUnitPicker, useCaptureUnit} from "@/components/capture-unit";
import {OdometerCapture} from "@/components/odometer-evidence";
import EvidenceAttachment from "@/components/evidence-attachment";
import {Empty, ErrorBox, Loading, PageHeader} from "@/components/ui";

export default function MileagePage() {
  const state = useCaptureUnit();
  const evidence = useResource<Evidence[]>(`vehicles/${state.selected?.id || 0}/odometer-evidence`, !!state.selected);
  const [limit, setLimit] = useState(6);
  useEffect(() => {setLimit(6);}, [state.unit]);
  const readings = [...(state.detail.data?.readings || [])].sort((a, b) => (b.recorded_at || b.date).localeCompare(a.recorded_at || a.date));
  const refresh = () => {state.refresh(); evidence.refresh();};
  return <><PageHeader eyebrow="CAPTURA CON EVIDENCIA" title="Kilometraje" description="Registra la lectura del tablero y sus fotos. Si capturas después, indica cuándo se tomó la lectura."/><CaptureUnitPicker state={state}/>
    {state.detail.error && <ErrorBox message={state.detail.error} retry={state.detail.refresh}/>}
    {state.selected && (state.detail.loading && !state.detail.data ? <Loading/> : state.detail.data && <>
      <section className="panel"><div className="panel-body"><OdometerCapture key={state.selected.id} id={String(state.selected.id)} vehicle={state.detail.data.vehicle} onDone={refresh}/></div></section>
      <section className="panel"><div className="panel-header"><h2>Lecturas y sus fotos</h2><span className="muted small">{readings.length} registros</span></div><div className="panel-body">{evidence.error && <ErrorBox message={evidence.error} retry={evidence.refresh}/>} {readings.length ? readings.slice(0, limit).map(reading => <article className="service-row" key={reading.id}><strong>{numberLabel(reading.odometer_km)} km</strong><p className="small muted">Lectura: {reading.recorded_at ? dateTimeLabel(reading.recorded_at) : dateLabel(reading.date)}{reading.captured_at && <> · Captura: {dateTimeLabel(reading.captured_at)}</>}</p><EvidenceAttachment vehicleId={state.selected!.id} target={{reading_id: reading.id}} photos={evidence.data?.filter(photo => photo.reading_id === reading.id) || []} onDone={refresh}/></article>) : <Empty title="Sin lecturas registradas">Tu primera lectura se guarda desde el formulario de arriba.</Empty>}
      {readings.length > 6 && <button className="button secondary" onClick={() => setLimit(limit >= readings.length ? 6 : limit + 6)}>{limit >= readings.length ? "Mostrar menos" : `Mostrar más (${readings.length - limit} restantes)`}</button>}</div></section>
    </>)}
  </>;
}
