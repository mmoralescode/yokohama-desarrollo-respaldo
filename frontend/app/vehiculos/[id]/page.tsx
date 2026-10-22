"use client";
import Link from "next/link";
import {useParams} from "next/navigation";
import {useState} from "react";
import {dateLabel, numberLabel, useResource} from "@/lib/api";
import type {Plan, ServicePlan, VehicleDetail} from "@/lib/types";
import {ErrorBox, Icon, Loading, PageHeader, SeverityBadge, StatusBadge, TrafficBadge} from "@/components/ui";
import {DowntimePanel} from "@/components/vehicle-records";
import {useAuth} from "@/lib/auth-context";
import VehicleAdministration from "@/components/vehicle-administration";
import {Disclosure, ProgressiveList} from "@/components/disclosure";

function ServiceRow({service}: {service: ServicePlan}) {
  return <article className={`service-row ${service.status}`}><div className="service-main"><div><div className="inline gap wrap"><h3>{service.name}</h3><StatusBadge status={service.status}/></div><p className="muted small">{service.action}</p></div><SeverityBadge value={service.severity}/></div><div className="service-dates"><div><span>Vencimiento probable</span><strong>{dateLabel(service.due_date)}</strong><small>{service.due_odometer == null ? "Sin intervalo por km" : `${numberLabel(service.due_odometer)} km`}</small></div><div><span>Fecha límite provisional</span><strong>{dateLabel(service.latest_entry_date)}</strong><small>{service.km_remaining == null ? "Kilometraje por validar" : `${numberLabel(service.km_remaining)} km restantes`}</small></div></div><details className="service-details"><summary>Mostrar más: criterio y fuentes</summary><p>{service.explanation}</p><dl className="uncertainty"><div><dt>Fecha temprana</dt><dd>{dateLabel(service.prediction.pessimistic)}</dd></div><div><dt>Fecha probable</dt><dd>{dateLabel(service.prediction.probable)}</dd></div><div><dt>Fecha tardía</dt><dd>{dateLabel(service.prediction.optimistic)}</dd></div></dl><p className="small muted">El rango es una estimación de uso y requiere revisión técnica.</p><div className="source-links">{service.source_urls.filter(url => /^https:\/\//.test(url)).map((url, index) => <a key={`${url}-${index}`} href={url} target="_blank" rel="noopener noreferrer">Fuente {index + 1} ↗</a>)}</div></details></article>;
}

export default function VehiclePage() {
  const {isAdmin} = useAuth();
  const {id} = useParams<{id: string}>();
  const detail = useResource<VehicleDetail>(`vehicles/${id}`);
  const plan = useResource<Plan>(`vehicles/${id}/plan`, isAdmin);
  const [serviceFilter, setServiceFilter] = useState("all");
  const refresh = () => {detail.refresh(); if (isAdmin) plan.refresh();};
  if (!detail.data) return <><PageHeader eyebrow="MI UNIDAD" title="Información de la unidad" description="Consultando la unidad asignada."/>{detail.error && <ErrorBox message={detail.error} retry={detail.refresh}/>} {detail.loading && <Loading/>}</>;
  const {vehicle, downtime = []} = detail.data;
  const projection = isAdmin ? plan.data : null;
  const services = (projection?.services || []).filter(service => serviceFilter === "all" || (serviceFilter === "scheduled" ? service.due_date : service.requires_validation || service.status === "pending_validation"));
  return <><Link href="/" className="back-link">← Volver a mis unidades</Link><PageHeader eyebrow={`${vehicle.make} ${vehicle.model} · ${vehicle.model_year}`} title={vehicle.nickname ? `${vehicle.plate} · ${vehicle.nickname}` : vehicle.plate} description="Elige qué necesitas registrar. Cada reporte conserva sus fotografías en su propio apartado." action={<button className="button secondary" onClick={refresh} disabled={detail.loading || (isAdmin && plan.loading)}><Icon name="refresh" size={17}/>Actualizar</button>}/>{detail.error && <ErrorBox message={detail.error} retry={detail.refresh}/>}
    <section className="panel simple-identity"><div><span className="muted small">Kilometraje actual de la unidad</span><strong>{numberLabel(vehicle.current_km)} km</strong><p>{vehicle.registration_state || "Estado de placas por capturar"}</p></div>{projection && <TrafficBadge value={projection.traffic_light}/>}</section>
    <div className="simple-unit-actions"><Link href={`/incidencias?unidad=${id}`}><Icon name="warning" size={25}/><strong>Incidencias</strong><Icon name="arrow" size={16}/></Link><Link href={`/kilometraje?unidad=${id}`}><Icon name="check" size={25}/><strong>Kilometraje</strong><Icon name="arrow" size={16}/></Link><Link href={`/fallas?unidad=${id}`}><Icon name="wrench" size={25}/><strong>Fallas</strong><Icon name="arrow" size={16}/></Link></div>
    <Disclosure id="datos-vehiculo" title="Datos del vehículo" description="Identificación y características de esta unidad."><div className="panel-body"><dl className="uncertainty"><div><dt>Número de serie</dt><dd>{vehicle.vin}</dd></div><div><dt>Marca y modelo</dt><dd>{vehicle.make} {vehicle.model} {vehicle.model_year}</dd></div><div><dt>Color</dt><dd>{vehicle.color || "Sin capturar"}</dd></div>{isAdmin && <><div><dt>Versión y motor</dt><dd>{[vehicle.version, vehicle.engine].filter(Boolean).join(" · ")}</dd></div><div><dt>Transmisión y tracción</dt><dd>{[vehicle.transmission, vehicle.drive].filter(Boolean).join(" · ")}</dd></div><div><dt>En servicio desde</dt><dd>{dateLabel(vehicle.in_service_date)}</dd></div></>}</dl></div></Disclosure>
    <Disclosure id="documentos" revealFor={["fotos-documentacion"]} title="Documentación y vencimientos" initiallyOpen><VehicleAdministration vehicle={vehicle} onDone={refresh}/></Disclosure>
    {isAdmin && <>
      {plan.error && <ErrorBox message={plan.error} retry={plan.refresh}/>}{plan.loading && !projection && <Loading label="Consultando el plan administrativo…"/>}
      {projection && <Disclosure id="pronosticos" title="Pronósticos de mantenimiento"><div className="panel-body">{projection.warnings.length > 0 && <details className="warning-panel"><summary>{projection.warnings.length} datos por revisar</summary><ul>{projection.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}<div className="inline between gap wrap"><h3>Próximos servicios</h3><label><span className="sr-only">Filtrar servicios</span><select value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}><option value="all">Todos los servicios</option><option value="scheduled">Con fecha prevista</option><option value="pending">Por validar</option></select></label></div></div><ProgressiveList key={serviceFilter} items={services} initialCount={4} label="servicios" render={service => <ServiceRow key={service.service_id} service={service}/>}/></Disclosure>}
      <section className="panel account-section"><Link href={`/calendario?placa=${encodeURIComponent(vehicle.plate)}`} className="button secondary">Ver servicios en Calendario<Icon name="calendar" size={17}/></Link></section><Disclosure id="disponibilidad" title="Disponibilidad de la unidad"><DowntimePanel id={id} vehicle={vehicle} entries={downtime} onDone={refresh}/></Disclosure>
    </>}
  </>;
}
