"use client";

import {useId, useState} from "react";
import {useResource} from "@/lib/api";
import type {Evidence, VehicleDetail, Visit} from "@/lib/types";
import EvidenceAttachment from "./evidence-attachment";
import {Empty, ErrorBox, Loading} from "./ui";

function ServiceEvidenceRecords({visit}: {visit: Visit}) {
  const vehicleId = visit.vehicle_id!;
  const detail = useResource<VehicleDetail>(`vehicles/${vehicleId}`);
  const evidence = useResource<Evidence[]>(`vehicles/${vehicleId}/evidence`);
  const performedOn = visit.performed_on || visit.planned_date;
  const records = (detail.data?.history || []).filter(record => record.performed_on === performedOn && visit.service_ids.includes(record.service_id));
  if (detail.error || evidence.error) return <ErrorBox message={detail.error || evidence.error!} retry={() => {detail.refresh(); evidence.refresh();}}/>;
  if (!detail.data || !evidence.data) return <Loading label="Consultando fotografías del servicio…"/>;
  if (!records.length) return <Empty title="No se encontró el registro de este servicio"/>;
  return <div className="calendar-service-records">{records.map(record => <article className="calendar-service-record" key={record.id}><h3>{record.catalog_snapshot?.servicio || record.service_name || visit.service_names?.[visit.service_ids.indexOf(record.service_id)] || "Trabajo realizado"}</h3><EvidenceAttachment vehicleId={vehicleId} target={{service_id: record.id}} photos={evidence.data!.filter(photo => photo.service_id === record.id)} onDone={evidence.refresh}/></article>)}</div>;
}

export default function CalendarServiceEvidence({visit}: {visit: Visit}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const available = Number.isInteger(visit.vehicle_id) && Number(visit.vehicle_id) > 0 && visit.service_ids.length > 0;
  return <div className="calendar-service-evidence"><button type="button" className="button secondary small-button" disabled={!available} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? "Ocultar fotos / factura" : "Fotos / factura"}</button>{open && <div id={id}><ServiceEvidenceRecords visit={visit}/></div>}</div>;
}
