"use client";

import {useState} from "react";
import {api, localDate, useResource} from "@/lib/api";
import {parseDriverNames} from "@/lib/drivers";
import {MANUAL_DECIMAL_PATTERN, parseManualNumber} from "@/lib/manual-capture";
import {administrationPayload} from "@/lib/vehicle-administration";
import type {Variant} from "@/lib/types";
import {AdministrationFields} from "./vehicle-administration";
import {ErrorBox, MutationForm} from "./ui";

type VehicleFields = {
  make: string; model: string; model_year: string; version: string; body_style: string;
  engine: string; transmission: string; drive: string; fuel_type: string; color: string;
};

const emptyVehicleFields: VehicleFields = {make: "", model: "", model_year: "", version: "", body_style: "", engine: "", transmission: "", drive: "", fuel_type: "", color: ""};

export type AddVehicleProps = {onDone: () => void; assignedUser?: {id: number; name: string}};

/** The same registration form is used in the fleet and after creating a driver. */
export function AddVehicle({onDone, assignedUser}: AddVehicleProps) {
  const variants = useResource<{variantes: Variant[]}>("variants");
  const [template, setTemplate] = useState<"manual" | "mazda3">("manual");
  const [variantId, setVariantId] = useState("");
  const [plate, setPlate] = useState("");
  const [fields, setFields] = useState<VehicleFields>(emptyVehicleFields);
  const chosen = variants.data?.variantes.find(v => v.id === variantId);
  const usingMazdaTemplate = template === "mazda3";
  const updateField = (name: keyof VehicleFields, value: string) => setFields(current => ({...current, [name]: value}));

  function selectTemplate(value: "manual" | "mazda3") {
    setTemplate(value);
    if (value === "manual") setVariantId("");
  }
  function selectVariant(id: string) {
    setVariantId(id);
    const variant = variants.data?.variantes.find(item => item.id === id);
    if (!variant) return;
    setFields(current => ({...current, make: "Mazda", model: "Mazda3", model_year: String(variant.anio_modelo), version: variant.version, body_style: variant.carroceria, engine: variant.motor, transmission: variant.transmisiones[0] || current.transmission, drive: variant.traccion}));
  }

  return <section className="panel add-vehicle"><MutationForm title="Registrar unidad" submitLabel={assignedUser ? "Registrar y asignar unidad" : "Agregar a flotilla"} onDone={onDone} onSave={async data => {
    const text = (name: string) => String(data.get(name) || "").trim();
    await api("vehicles", {method: "POST", body: {
      vin: text("vin").toUpperCase(), plate: text("plate").toUpperCase(), make: text("make"), model: text("model"), model_year: Number(data.get("model_year")), version: text("version"), body_style: text("body_style"), engine: text("engine"), transmission: text("transmission"), drive: text("drive"), fuel_type: text("fuel_type") || null, color: text("color") || null,
      current_km: parseManualNumber(data.get("km")), in_service_date: data.get("in_service_date"), usage_regime: "normal", severity_multiplier: 1, is_synthetic: data.get("synthetic") === "on", drivers: parseDriverNames(text("drivers")),
      ...administrationPayload(data, {creation: true}), ...(usingMazdaTemplate ? {variant_id: variantId, maintenance_catalog: "mazda3-mx.v0.1.0"} : {}),
      ...(assignedUser ? {assigned_user_id: assignedUser.id} : {})
    }});
    return assignedUser ? `Unidad registrada y asignada a ${assignedUser.name}.` : "Unidad registrada.";
  }}>
    {assignedUser && <p className="small muted">Conductor: <strong>{assignedUser.name}</strong></p>}
    {usingMazdaTemplate && variants.error && <ErrorBox message={variants.error} retry={variants.refresh}/>}
    <div className="form-grid"><label>Número de serie<input name="vin" required minLength={17} maxLength={17} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" autoComplete="off" placeholder="17 caracteres"/></label><label>Placas<input name="plate" required minLength={3} maxLength={16} value={plate} onChange={event => setPlate(event.target.value)} placeholder="ABC-123-A"/></label>
      <label className="span-2">Configuración inicial<select aria-label="Plantilla de vehículo" value={template} onChange={event => selectTemplate(event.target.value as "manual" | "mazda3")}><option value="manual">Captura manual (cualquier marca)</option><option value="mazda3">Plantilla Mazda3 (catálogo existente)</option></select></label>
      {usingMazdaTemplate && <label className="span-2">Modelo Mazda3 del catálogo<select required value={variantId} onChange={event => selectVariant(event.target.value)}><option value="">Selecciona año, carrocería y versión</option>{variants.data?.variantes.map(variant => <option key={variant.id} value={variant.id}>{variant.anio_modelo} · {variant.carroceria} · {variant.version} · {variant.motor}</option>)}</select></label>}
      <label>Marca<input name="make" required value={fields.make} onChange={event => updateField("make", event.target.value)} placeholder="Ej. Toyota"/></label><label>Modelo<input name="model" required value={fields.model} onChange={event => updateField("model", event.target.value)} placeholder="Ej. Corolla"/></label>
      <label>Año modelo<input name="model_year" type="number" required min={1886} max={Number(localDate().slice(0, 4)) + 1} value={fields.model_year} onChange={event => updateField("model_year", event.target.value)} placeholder="2024"/></label><label>Versión<input name="version" required value={fields.version} onChange={event => updateField("version", event.target.value)} placeholder="Ej. XLE"/></label>
      <label>Carrocería<input name="body_style" required value={fields.body_style} onChange={event => updateField("body_style", event.target.value)} placeholder="Ej. sedán"/></label><label>Motor<input name="engine" required value={fields.engine} onChange={event => updateField("engine", event.target.value)} placeholder="Ej. 2.0 L"/></label>
      <label>Transmisión<input name="transmission" required list={chosen ? "mazda-transmissions" : undefined} value={fields.transmission} onChange={event => updateField("transmission", event.target.value)} placeholder="Ej. automática"/></label><label>Tracción<input name="drive" required value={fields.drive} onChange={event => updateField("drive", event.target.value)} placeholder="Ej. FWD"/></label>
      {chosen && <datalist id="mazda-transmissions">{chosen.transmisiones.map(transmission => <option key={transmission} value={transmission}/>)}</datalist>}
      <label>Combustible (opcional)<input name="fuel_type" value={fields.fuel_type} onChange={event => updateField("fuel_type", event.target.value)} placeholder="Ej. gasolina"/></label><label>Color (opcional)<input name="color" value={fields.color} onChange={event => updateField("color", event.target.value)} placeholder="Ej. blanco"/></label>
      <label>Kilometraje actual (km)<input name="km" type="text" inputMode="decimal" pattern={MANUAL_DECIMAL_PATTERN} required/></label><label>Fecha de puesta en servicio<input name="in_service_date" type="date" required max={localDate()}/></label>
    </div><AdministrationFields plate={plate} creation/><label className="check-label"><input type="checkbox" name="synthetic"/>Unidad de demostración</label>
  </MutationForm></section>;
}

export default AddVehicle;
