"use client";
import {useState} from "react";
import {api, dateLabel, localDate, useResource} from "@/lib/api";
import {dateTimeLabel} from "@/lib/dates";
import {useAuth} from "@/lib/auth-context";
import {administrationLabels, administrationPayload, plateEnding} from "@/lib/vehicle-administration";
import {MEXICAN_STATES} from "@/lib/vehicle-jurisdictions";
import type {AdministrationChange, Vehicle} from "@/lib/types";
import {Empty, ErrorBox, Loading, MutationForm} from "./ui";
import {ProgressiveList} from "./disclosure";
import DocumentPhotos from "./document-photos";
import "./administration.css";

function SavedDocumentStatus({date, advance = 30, paid}: {date?: string | null; advance?: number; paid?: string | null}) {
  const days = date ? Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${localDate()}T12:00:00Z`)) / 86400000) : null;
  const tone = paid ? "green" : days != null && days < 0 ? "red" : days != null && days <= advance ? "amber" : "neutral";
  const label = paid ? `Pago: ${dateLabel(paid)}` : days == null ? "Por capturar" : days < 0 ? "Vencido" : days === 0 ? "Vence hoy" : days <= advance ? `Vence en ${days} días` : "Fecha registrada";
  return <span className={`badge ${tone}`}>Guardado: {label}</span>;
}

export function AdministrationFields({vehicle, inline = false, creation = false}: {vehicle?: Vehicle; plate?: string; inline?: boolean; creation?: boolean}) {
  const [state, setState] = useState(vehicle?.registration_state || "");
  const [start, setStart] = useState(vehicle?.verification_period_start || "");
  const [end, setEnd] = useState(vehicle?.verification_period_end || "");
  const [stateChanged, setStateChanged] = useState(false);
  const [taxDue, setTaxDue] = useState(vehicle?.vehicle_tax_due_on || "");
  const [taxPaid, setTaxPaid] = useState(vehicle?.vehicle_tax_paid_on || "");
  const newTaxPeriod = Boolean(vehicle?.vehicle_tax_paid_on && taxDue !== (vehicle.vehicle_tax_due_on || ""));
  const legacyState = state && !MEXICAN_STATES.some(item => item === state);
  if (inline) return <div className="document-inline-editor">
    <div className="form-grid document-editor-identification"><label>Apodo de la unidad (opcional)<input name="nickname" maxLength={80} defaultValue={vehicle?.nickname || ""} placeholder="Ej. Reparto centro"/></label><label>Estado de emplacamiento<select name="registration_state" value={state} onChange={event => {setState(event.target.value); setStateChanged(true);}}><option value="">Por capturar</option>{legacyState && <option value={state}>{state} (valor guardado)</option>}{MEXICAN_STATES.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>
    <div className="document-grid document-editor-grid">
      <section className="document-deadline document-edit-card"><h3>Verificación</h3><SavedDocumentStatus date={vehicle?.verification_period_end} advance={vehicle?.document_alert_days}/><label>Inicio del periodo de verificación<input name="verification_period_start" type="date" value={start} onChange={event => setStart(event.target.value)}/></label><label>Fin del periodo de verificación<input name="verification_period_end" type="date" value={end} onChange={event => setEnd(event.target.value)}/></label></section>
      <section className="document-deadline document-edit-card"><h3>Tarjeta de circulación</h3><SavedDocumentStatus date={vehicle?.circulation_card_expires_on} advance={vehicle?.document_alert_days}/><label>Vencimiento de tarjeta de circulación<input name="circulation_card_expires_on" type="date" defaultValue={vehicle?.circulation_card_expires_on || ""}/></label></section>
      <section className="document-deadline document-edit-card"><h3>Vigencia de placas</h3><SavedDocumentStatus date={vehicle?.plates_expires_on} advance={vehicle?.document_alert_days}/><label>Vencimiento o renovación de placas<input name="plates_expires_on" type="date" defaultValue={vehicle?.plates_expires_on || ""}/></label></section>
      <section className="document-deadline document-edit-card"><h3>Refrendo / tenencia</h3><SavedDocumentStatus date={vehicle?.vehicle_tax_due_on} paid={vehicle?.vehicle_tax_paid_on} advance={vehicle?.document_alert_days}/><label>Fecha límite de refrendo / tenencia<input name="vehicle_tax_due_on" type="date" value={taxDue} onChange={event => setTaxDue(event.target.value)}/></label><label>Fecha real del pago vehicular<input name="vehicle_tax_paid_on" type="date" max={localDate()} value={taxPaid} onChange={event => setTaxPaid(event.target.value)}/></label>{vehicle?.vehicle_tax_paid_on && <button type="button" className="text-button" onClick={() => {setTaxDue(""); setTaxPaid("");}}>Preparar nuevo periodo de pago</button>}</section>
    </div>
    {stateChanged && (start || end) && <p className="field-help" role="status">Cambiaste la entidad. Revisa que las fechas correspondan a las nuevas placas antes de guardar.</p>}
    {newTaxPeriod && <p className="field-help" role="status">Guarda el nuevo plazo sin fecha de pago para no reutilizar el pago del periodo anterior.</p>}
    <details className="document-editor-options"><summary>Más opciones: avisos y notas</summary><div className="form-grid"><label>Avisar con anticipación (días)<input name="document_alert_days" type="number" min={1} max={180} step={1} required defaultValue={vehicle?.document_alert_days ?? 30}/></label><label className="span-2">Notas y referencia documental<textarea name="administrative_notes" maxLength={1500} rows={3} defaultValue={vehicle?.administrative_notes || ""}/></label></div></details>
  </div>;
  return <div className="form-grid administrative-fields">
    <label>Apodo de la unidad (opcional)<input name="nickname" maxLength={80} defaultValue={vehicle?.nickname || ""} placeholder="Ej. La blanca, Reparto centro"/></label>
    <label>Estado de emplacamiento<select name="registration_state" value={state} onChange={event => {setState(event.target.value); setStateChanged(true);}}><option value="">Por capturar</option>{legacyState && <option value={state}>{state} (valor guardado)</option>}{MEXICAN_STATES.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    {creation ? <label>Periodo de verificación (fecha límite)<input name="verification_period_end" type="date" value={end} onChange={event => setEnd(event.target.value)}/></label> : <><label>Inicio del periodo de verificación<input name="verification_period_start" type="date" value={start} onChange={event => setStart(event.target.value)}/></label><label>Fin del periodo de verificación<input name="verification_period_end" type="date" value={end} onChange={event => setEnd(event.target.value)}/></label></>}
    {stateChanged && (start || end) && <p className="span-2 field-help" role="status">Cambiaste la entidad. Conservamos las fechas capturadas; revisa si corresponden a las nuevas placas antes de guardar.</p>}
    <label>Vencimiento de tarjeta de circulación<input name="circulation_card_expires_on" type="date" defaultValue={vehicle?.circulation_card_expires_on || ""}/></label>
    <label>Vencimiento o renovación de placas<input name="plates_expires_on" type="date" defaultValue={vehicle?.plates_expires_on || ""}/></label>
    <label>Fecha límite de refrendo / tenencia<input name="vehicle_tax_due_on" type="date" value={taxDue} onChange={event => setTaxDue(event.target.value)}/></label>
    <label>Fecha real del pago vehicular<input name="vehicle_tax_paid_on" type="date" max={localDate()} value={taxPaid} onChange={event => setTaxPaid(event.target.value)}/></label>
    {vehicle?.vehicle_tax_paid_on && <div className="span-2"><button type="button" className="button secondary small-button" onClick={() => {setTaxDue(""); setTaxPaid("");}}>Preparar nuevo periodo de pago</button><p className="field-help">Limpia estos dos campos para capturar el siguiente plazo. Al guardar, el pago anterior queda en el historial de cambios.</p></div>}
    {newTaxPeriod && <p className="span-2 field-help" role="status">Guarda el nuevo plazo sin fecha de pago para no reutilizar el anterior. Después podrás registrar el pago del nuevo periodo.</p>}
    <label className="span-2">Notas y referencia documental<textarea name="administrative_notes" maxLength={1500} rows={3} defaultValue={vehicle?.administrative_notes || ""} placeholder="Ejercicio fiscal, folio de recibo, fuente consultada, excepción o zona donde circula. No incluyas contraseñas ni datos bancarios."/></label>
    <label>Avisar con anticipación (días)<input name="document_alert_days" type="number" min={1} max={180} step={1} required defaultValue={vehicle?.document_alert_days ?? 30}/></label>
  </div>;
}
function Deadline({title, date, advance, paid}: {title: string; date?: string | null; advance: number; paid?: string | null}) {
  const days = date ? Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${localDate()}T12:00:00Z`)) / 86400000) : null;
  const status = paid ? `Pago capturado: ${dateLabel(paid)}` : days == null ? "Sin registrar" : days < 0 ? "Vencido" : days === 0 ? "Vence hoy" : days <= advance ? `Vence en ${days} días` : "Fecha registrada";
  return <div className={`document-deadline ${!paid && days != null && days <= advance ? "attention" : ""}`}><span>{title}</span><strong>{date ? dateLabel(date) : "Por capturar"}</strong><small>{status}</small></div>;
}
function AdministrationHistory({vehicleId}: {vehicleId: number}) {
  const history = useResource<AdministrationChange[]>(`vehicles/${vehicleId}/administration-history`);
  if (history.error) return <ErrorBox message={history.error} retry={history.refresh}/>;
  if (history.loading || !history.data) return <Loading label="Consultando cambios administrativos…"/>;
  if (!history.data.length) return <Empty title="Sin cambios administrativos registrados">El historial comienza con las modificaciones realizadas desde esta actualización.</Empty>;
  return <div className="administration-history"><p className="small muted">Últimos 50 cambios. Conserva los valores anteriores; no es un estado de cuenta fiscal.</p><ProgressiveList items={history.data} initialCount={5} label="cambios" render={change => <article key={change.id}><strong>{dateTimeLabel(change.changed_at)}</strong><dl>{Object.keys(change.new_values).map(field => <div key={field}><dt>{administrationLabels[field] || field}</dt><dd><span>Antes: {String(change.previous_values[field] ?? "Sin registrar")}</span><span>Ahora: {String(change.new_values[field] ?? "Sin registrar")}</span></dd></div>)}</dl></article>}/></div>;
}
export default function VehicleAdministration({vehicle, onDone}: {vehicle: Vehicle; onDone: () => void}) {
  const {isAdmin} = useAuth();
  const [notice, setNotice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  return <div className="administrative-panel"><div className="panel-body">
    <p className="muted">Terminación de placa: {plateEnding(vehicle.plate) ?? "Sin capturar"}</p>
    {isAdmin ? <div onChange={() => setNotice(false)}><MutationForm key={JSON.stringify(vehicle)} title="" submitLabel="Guardar documentación" onSave={async data => {await api(`vehicles/${vehicle.id}/administration`, {method: "PATCH", body: administrationPayload(data, {allowSingleVerificationDate: !vehicle.verification_period_start && !!vehicle.verification_period_end})}); return "Documentación guardada.";}} onDone={() => {setNotice(true); onDone();}}><AdministrationFields vehicle={vehicle} inline/></MutationForm></div> : <>
      <div className="document-grid"><Deadline title="Verificación: fecha límite" date={vehicle.verification_period_end} advance={vehicle.document_alert_days ?? 30}/><Deadline title="Tarjeta de circulación" date={vehicle.circulation_card_expires_on} advance={vehicle.document_alert_days ?? 30}/><Deadline title="Vigencia de placas" date={vehicle.plates_expires_on} advance={vehicle.document_alert_days ?? 30}/><Deadline title="Refrendo / tenencia: periodo registrado" date={vehicle.vehicle_tax_due_on} paid={vehicle.vehicle_tax_paid_on} advance={vehicle.document_alert_days ?? 30}/></div>
      {vehicle.verification_period_start && <p className="small muted">Periodo de verificación: {dateLabel(vehicle.verification_period_start)} al {dateLabel(vehicle.verification_period_end)}.</p>}
      {vehicle.administrative_notes && <p className="administrative-notes">{vehicle.administrative_notes}</p>}
    </>}{notice && <p className="message success" role="status">Documentación actualizada; los avisos usan las nuevas fechas.</p>}
    <DocumentPhotos key={vehicle.id} vehicleId={vehicle.id}/>
    {isAdmin && <><button className="text-button" type="button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Ocultar historial administrativo" : "Ver historial administrativo"}</button>{showHistory && <AdministrationHistory key={JSON.stringify(vehicle)} vehicleId={vehicle.id}/>}</>}
  </div></div>;
}
