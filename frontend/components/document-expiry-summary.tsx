"use client";
import Link from "next/link";
import {useState} from "react";
import {dateLabel, useResource} from "@/lib/api";
import type {Alert} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading} from "./ui";

export default function DocumentExpirySummary({vehicleIds}: {vehicleIds: number[]}) {
  const [showAll, setShowAll] = useState(false);
  const documents = useResource<Alert[]>("document-alerts");
  const rows = (documents.data || []).filter(alert => vehicleIds.includes(alert.vehicle_id)).sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""));
  return <section className="panel" aria-labelledby="document-summary-heading"><div className="panel-header"><div><p className="eyebrow">TRÁMITES A TIEMPO</p><h2 id="document-summary-heading">Documentos y pagos por vencer</h2></div><Link href="/alertas?origen=document" className="button secondary small-button">Ver avisos<Icon name="arrow" size={16}/></Link></div><p className="section-note">Avisos basados en las fechas capturadas de verificación, tarjeta, placas y pago vehicular.</p>{documents.error ? <div className="panel-body"><ErrorBox message={documents.error} retry={documents.refresh}/></div> : documents.loading && !documents.data ? <Loading label="Revisando vencimientos…"/> : rows.length ? <><div className="table-scroll"><table><thead><tr><th>Unidad</th><th>Pendiente</th><th>Fecha límite</th><th>Estado</th></tr></thead><tbody>{(showAll ? rows : rows.slice(0, 5)).map(alert => <tr key={alert.key}><td><Link className="plate-link" href={`/vehiculos/${alert.vehicle_id}#documentos`}>{alert.plate}</Link></td><td>{alert.message}</td><td>{dateLabel(alert.deadline)}</td><td><span className={`badge ${alert.days_remaining != null && alert.days_remaining < 0 ? "severity-critico" : "severity-importante"}`}>{alert.days_remaining == null ? "Por revisar" : alert.days_remaining < 0 ? "Vencido" : alert.days_remaining === 0 ? "Vence hoy" : `En ${alert.days_remaining} días`}</span></td></tr>)}</tbody></table></div>{rows.length > 5 && <button type="button" className="show-more-button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Mostrar menos" : `Mostrar más avisos (${rows.length - 5})`}</button>}</> : <Empty title="Sin vencimientos próximos registrados">Verifica que todas las unidades tengan sus fechas capturadas.</Empty>}</section>;
}
