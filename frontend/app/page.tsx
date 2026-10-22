"use client";
import Link from "next/link";
import {useMemo, useState} from "react";
import {api, dateLabel, localDate, numberLabel, useResource} from "@/lib/api";
import type {Variant, VehicleSummary} from "@/lib/types";
import {Empty, ErrorBox, Icon, Loading, MutationForm, PageHeader, Stat, TrafficBadge} from "@/components/ui";

type VehicleDraft = {
  make: string; model: string; model_year: string; version: string; body_style: string;
  engine: string; transmission: string; drive: string; fuel_type: string; color: string;
};

const MAZDA_CATALOG = "mazda3-mx.v0.1.0";

function initialDraft(): VehicleDraft {
  return {make: "", model: "", model_year: String(new Date().getFullYear()), version: "Estándar", body_style: "No especificado", engine: "No especificado", transmission: "No especificada", drive: "No especificada", fuel_type: "Gasolina", color: "No especificado"};
}

function AddVehicle({onDone}: {onDone: () => void}) {
  const variants = useResource<{variantes: Variant[]}>("variants");
  const [variantId, setVariantId] = useState("");
  const [draft, setDraft] = useState<VehicleDraft>(initialDraft);
  const update = (field: keyof VehicleDraft, value: string) => setDraft(current => ({...current, [field]: value}));
  const selectVariant = (nextVariantId: string) => {
    setVariantId(nextVariantId);
    const variant = variants.data?.variantes.find(item => item.id === nextVariantId);
    if (!variant) return;
    setDraft(current => ({...current, make: "Mazda", model: "Mazda3", model_year: String(variant.anio_modelo), version: variant.version, body_style: variant.carroceria, engine: variant.motor, transmission: variant.transmisiones[0] || current.transmission, drive: variant.traccion}));
  };
  return <section className="panel add-vehicle"><MutationForm title="Registrar unidad" description="Registra los datos comprobados de la unidad. La plantilla Mazda3 es opcional y conserva sus reglas documentadas." submitLabel="Agregar a flotilla" onDone={onDone} onSave={async data => {
    await api("vehicles", {method: "POST", body: {make: String(data.get("make")).trim(), model: String(data.get("model")).trim(), model_year: Number(data.get("model_year")), version: String(data.get("version")).trim(), body_style: String(data.get("body_style")).trim(), engine: String(data.get("engine")).trim(), transmission: String(data.get("transmission")).trim(), drive: String(data.get("drive")).trim(), fuel_type: String(data.get("fuel_type")).trim(), color: String(data.get("color")).trim(), vin: String(data.get("vin")).trim().toUpperCase(), plate: String(data.get("plate")).trim().toUpperCase(), current_km: Number(data.get("km")), in_service_date: data.get("in_service_date"), usage_regime: data.get("usage_regime"), is_synthetic: data.get("synthetic") === "on", variant_id: variantId || null, maintenance_catalog: variantId ? MAZDA_CATALOG : null}});
    return "Unidad registrada. Agrega sus lecturas y servicios para mejorar la proyección.";
  }}>
    {variants.error && <ErrorBox message={variants.error} retry={variants.refresh}/>}
    <div className="form-grid"><label className="span-2">Plantilla Mazda3 (opcional)<select value={variantId} onChange={event => selectVariant(event.target.value)}><option value="">Sin plantilla / captura manual</option>{variants.data?.variantes.map(variant => <option key={variant.id} value={variant.id}>{variant.anio_modelo} · {variant.carroceria} · {variant.version} · {variant.motor}</option>)}</select><span className="field-help">Al elegirla se completan los datos; puedes ajustarlos antes de guardar.</span></label>
      <label>Marca<input name="make" required minLength={1} maxLength={80} value={draft.make} onChange={event => update("make", event.target.value)} placeholder="Ej. Toyota"/></label><label>Modelo<input name="model" required minLength={1} maxLength={80} value={draft.model} onChange={event => update("model", event.target.value)} placeholder="Ej. Corolla"/></label>
      <label>Año modelo<input name="model_year" type="number" required min={1886} max={2100} value={draft.model_year} onChange={event => update("model_year", event.target.value)}/></label><label>Versión<input name="version" required minLength={1} maxLength={80} value={draft.version} onChange={event => update("version", event.target.value)}/></label>
      <label>Carrocería o tipo<input name="body_style" required minLength={1} maxLength={80} value={draft.body_style} onChange={event => update("body_style", event.target.value)} placeholder="Ej. SUV, sedán o pickup"/></label><label>Motor<input name="engine" required minLength={1} maxLength={80} value={draft.engine} onChange={event => update("engine", event.target.value)} placeholder="Ej. 2.0 L"/></label>
      <label>Transmisión<input name="transmission" required minLength={1} maxLength={40} value={draft.transmission} onChange={event => update("transmission", event.target.value)} placeholder="Ej. Automática"/></label><label>Tracción<input name="drive" required minLength={1} maxLength={40} value={draft.drive} onChange={event => update("drive", event.target.value)} placeholder="Ej. Delantera"/></label>
      <label>Combustible<input name="fuel_type" required minLength={1} maxLength={40} value={draft.fuel_type} onChange={event => update("fuel_type", event.target.value)} placeholder="Ej. Gasolina"/></label><label>Color<input name="color" required minLength={1} maxLength={40} value={draft.color} onChange={event => update("color", event.target.value)} placeholder="Ej. Blanco"/></label>
      <label>VIN<input name="vin" required minLength={17} maxLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" autoComplete="off" placeholder="17 caracteres"/></label><label>Placas<input name="plate" required minLength={3} maxLength={16} placeholder="ABC-123-A"/></label>
      <label>Odómetro actual (km)<input name="km" type="number" min={0} step="0.1" required/></label><label>Fecha de puesta en servicio<input name="in_service_date" type="date" required max={localDate()}/></label>
      <label>Régimen de uso<select name="usage_regime"><option value="normal">Normal</option><option value="severe">Severo</option></select></label>
    </div><label className="check-label"><input type="checkbox" name="synthetic"/>Esta unidad es un dato sintético de demostración</label>
  </MutationForm></section>;
}

export default function FleetPage() {
  const resource = useResource<VehicleSummary[]>("vehicles");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const vehicles = resource.data || [];
  const visible = useMemo(() => vehicles.filter(v => (status === "all" || v.traffic_light === status) && `${v.plate} ${v.make || ""} ${v.model || ""} ${v.version} ${v.vin} ${v.model_year}`.toLowerCase().includes(search.toLowerCase())), [vehicles, search, status]);
  const urgent = vehicles.filter(v => v.traffic_light === "red").length;
  const planned = vehicles.filter(v => v.next_visit_date).length;
  const unvalidated = vehicles.filter(v => v.traffic_light === "gray" || v.traffic_light === "amber").length;
  async function recalculate() {
    setRecalculating(true); setMutationError(null); setNotice(null);
    try {const result = await api<{vehicles_processed: number; alerts_open: number}>("recalculate", {method: "POST"}); setNotice(`${result.vehicles_processed} unidades recalculadas · ${result.alerts_open} alertas abiertas.`); resource.refresh();}
    catch(e) {setMutationError(e instanceof Error ? e.message : "No se pudo recalcular.");}
    finally {setRecalculating(false);}
  }
  return <>
    <PageHeader eyebrow="VISIÓN GENERAL" title="Más tiempo en ruta." description="Anticipa el mantenimiento y coordina cada ingreso a taller desde un solo lugar." action={<button className="button primary" onClick={() => setShowAdd(value => !value)} aria-expanded={showAdd}><Icon name="plus" size={18}/>{showAdd ? "Cerrar registro" : "Agregar unidad"}</button>}/>
    {showAdd && <AddVehicle onDone={resource.refresh}/>}
    {resource.error && <ErrorBox message={resource.error} retry={resource.refresh}/>}
    {mutationError && <ErrorBox message={mutationError}/>}{notice && <p className="message success" role="status">{notice}</p>}
    <div className="stats-grid"><Stat label="UNIDADES EN FLOTILLA" value={resource.data ? vehicles.length : "—"} note="Flotilla multimarca"/><Stat label="ATENCIÓN PRIORITARIA" value={resource.data ? urgent : "—"} note="Revisar antes de asignar ruta" accent="red"/><Stat label="VISITAS PROPUESTAS" value={resource.data ? planned : "—"} note="Unidades con fecha provisional"/><Stat label="POR PLANEAR / VALIDAR" value={resource.data ? unvalidated : "—"} note="No equivalen a unidades seguras" accent="amber"/></div>
    <section className="panel fleet-panel"><div className="panel-header"><div><p className="eyebrow">CONTROL DE UNIDADES</p><h2>Tu flotilla, de un vistazo</h2></div><button className="button secondary small-button" onClick={recalculate} disabled={recalculating || resource.loading}><Icon name="refresh" size={16}/>{recalculating ? "Recalculando…" : "Recalcular planes"}</button></div>
      <div className="table-toolbar"><label className="search-field"><span className="sr-only">Buscar unidad</span><Icon name="search" size={18}/><input type="search" placeholder="Buscar placa, versión o VIN…" value={search} onChange={e => setSearch(e.target.value)}/></label><label className="status-filter"><span className="sr-only">Filtrar estado</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos los estados</option><option value="red">Atención prioritaria</option><option value="amber">Planear / validar</option><option value="gray">Datos insuficientes</option><option value="green">En ventana</option></select></label><span className="muted small result-count">{visible.length} unidades</span></div>
      {resource.loading && !resource.data ? <Loading/> : !visible.length ? <Empty title={search || status !== "all" ? "Sin coincidencias" : "Aún no hay unidades"}>{search || status !== "all" ? "Prueba otra placa o cambia el filtro." : "Registra una unidad o carga los 20 vehículos sintéticos con el generador del backend."}</Empty> : <div className="table-scroll"><table><caption className="sr-only">Estado de mantenimiento de las unidades de la flotilla</caption><thead><tr><th>Unidad</th><th>Estado</th><th>Odómetro</th><th>Uso estimado</th><th>Próxima visita</th><th>Alertas</th><th><span className="sr-only">Ver detalle</span></th></tr></thead><tbody>{visible.map(vehicle => <tr key={vehicle.id}>
        <td><Link href={`/vehiculos/${vehicle.id}`} className="plate-link">{vehicle.plate}</Link><span className="cell-sub">{[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Unidad"} · {vehicle.model_year} · {vehicle.version}</span>{vehicle.is_synthetic && <span className="synthetic-label">DATO SINTÉTICO</span>}</td><td><TrafficBadge value={vehicle.traffic_light}/></td><td className="numeric">{numberLabel(vehicle.current_km)} <span className="muted">km</span></td><td className="numeric">{numberLabel(vehicle.usage_km_per_day, 1)} <span className="muted">km/día</span></td><td>{vehicle.next_visit_date ? dateLabel(vehicle.next_visit_date) : <span className="muted">Sin fecha validada</span>}{vehicle.next_visit_date && <span className="cell-sub">Provisional</span>}</td><td><span className={vehicle.open_alerts ? "alert-count" : "muted"}>{vehicle.open_alerts}</span></td><td><Link className="icon-link" href={`/vehiculos/${vehicle.id}`} aria-label={`Ver unidad ${vehicle.plate}`}><Icon name="arrow"/></Link></td>
      </tr>)}</tbody></table></div>}
    </section>
    <div className="bottom-note"><Icon name="wrench"/><p><strong>Una visita bien planeada, menos tiempo detenido.</strong><br/>El motor agrupa ventanas compatibles; nunca difiere una falla crítica ni supone tolerancias sin respaldo.</p><Link href="/calendario">Ver calendario <Icon name="arrow" size={16}/></Link></div>
  </>;
}
