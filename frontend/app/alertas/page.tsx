"use client";
import Link from "next/link";
import {useEffect, useState} from "react";
import {dateLabel, useResource} from "@/lib/api";
import type {Alert} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, PageHeader, SeverityBadge, Stat} from "@/components/ui";

export default function AlertsPage() {
  const [showAll, setShowAll] = useState(false);
  const alerts = useResource<Alert[]>("alerts");
  const documents = useResource<Alert[]>("document-alerts");
  const [severity, setSeverity] = useState("all");
  const [kind, setKind] = useState("all");
  useEffect(() => {if (new URLSearchParams(window.location.search).get("origen") === "document") setKind("document");}, []);
  const data = [...(alerts.data || []), ...(documents.data || [])];
  const complete = !!alerts.data && !!documents.data;
  const filtered = data.filter(alert => (severity === "all" || alert.severity === severity) && (kind === "all" || alert.kind === kind));
  const priority = {critico: 0, importante: 1, menor: 2};
  const ordered = [...filtered].sort((a, b) => priority[a.severity] - priority[b.severity] || (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  return <>
    <PageHeader eyebrow="" title="Alertas" description="" action={<button className="button secondary" onClick={() => {alerts.refresh(); documents.refresh();}} disabled={alerts.loading || documents.loading}><Icon name="refresh" size={17}/>Actualizar</button>}/>
    {alerts.error && <ErrorBox message={alerts.error} retry={alerts.refresh}/>}{documents.error && <ErrorBox message={`No se pudieron consultar los vencimientos: ${documents.error}`} retry={documents.refresh}/>}
    <div className="stats-grid three"><Stat label="CRÍTICAS" value={complete ? data.filter(a => a.severity === "critico").length : "—"} note="" accent="red"/><Stat label="IMPORTANTES" value={complete ? data.filter(a => a.severity === "importante").length : "—"} note="" accent="amber"/><Stat label="MENORES" value={complete ? data.filter(a => a.severity === "menor").length : "—"} note=""/></div>
    <section className="panel"><div className="panel-header"><h2>Pendientes</h2><span className="muted small">{ordered.length} resultados</span></div><div className="table-toolbar"><label><span className="sr-only">Severidad de alerta</span><select value={severity} onChange={e => {setSeverity(e.target.value); setShowAll(false);}}><option value="all">Todas las severidades</option><option value="critico">Crítico</option><option value="importante">Importante</option><option value="menor">Menor</option></select></label><label><span className="sr-only">Origen de alerta</span><select value={kind} onChange={e => {setKind(e.target.value); setShowAll(false);}}><option value="all">Todos los orígenes</option><option value="maintenance">Mantenimiento</option><option value="fault">Fallas reportadas</option><option value="data">Validación de datos</option><option value="document">Documentos y verificación</option></select></label></div>
      {(alerts.loading || documents.loading) && !complete ? <Loading/> : !ordered.length ? <Empty title={complete ? "Sin alertas para este filtro" : "Consulta incompleta"}/> : <><div className="alerts-list">{(showAll ? ordered : ordered.slice(0, 6)).map(alert => <article key={alert.key || alert.id} className={`alert-card ${alert.severity}`}><div className="alert-symbol"><Icon name={alert.kind === "fault" ? "warning" : "bell"} size={22}/></div><div className="alert-content"><div className="inline gap wrap"><SeverityBadge value={alert.severity}/><span className="alert-kind">{({maintenance: "Mantenimiento", fault: "Falla reportada", data: "Validación de datos", document: "Documentos y verificación"})[alert.kind] || alert.kind}</span><Link className="plate-link" href={`/vehiculos/${alert.vehicle_id}`}>{alert.plate || `Unidad ${alert.vehicle_id}`}</Link></div><h3>{alert.message}</h3><div className="inline gap wrap muted small"><span>Límite: {dateLabel(alert.deadline)}</span>{alert.days_remaining != null && <span>{alert.days_remaining < 0 ? `${Math.abs(alert.days_remaining)} días vencido` : alert.days_remaining === 0 ? "Hoy" : `${alert.days_remaining} días restantes`}</span>}</div>{alert.severity === "critico" && <p className="critical-text">{alert.kind === "document" ? "Revisa el documento y coordina su actualización." : "Detén la operación y coordina asistencia segura."}</p>}{alert.threshold_days != null && <details className="service-details"><summary>Mostrar más</summary><p>Anticipación: {alert.threshold_days} días</p></details>}</div><Link href={alert.kind === "fault" ? `/fallas?unidad=${alert.vehicle_id}` : `/vehiculos/${alert.vehicle_id}`} className="icon-link" aria-label={`Atender alerta de ${alert.plate || `unidad ${alert.vehicle_id}`}`}><Icon name="arrow"/></Link></article>)}</div>{ordered.length > 6 && <button type="button" className="show-more-button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "Mostrar menos" : `Mostrar más alertas (${ordered.length - 6})`}</button>}</>}
    </section>
  </>;
}
