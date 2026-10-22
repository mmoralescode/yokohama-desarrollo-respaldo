"use client";
import {useState} from "react";
import {dateLabel} from "@/lib/api";
import {numericPlateEnding} from "@/lib/vehicle-administration";
import {canonicalRegistrationState, stateRegulation, stateVerificationPeriod} from "@/lib/vehicle-jurisdictions";
import OfficialStateReference from "./official-state-reference";

export default function StateRegulationHelp({state, plate, hasDates, onApply, initiallyOpen = false}: {
  state: string; plate: string; hasDates: boolean; onApply?: (start: string, end: string) => void; initiallyOpen?: boolean;
}) {
  const [period, setPeriod] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [applied, setApplied] = useState(false);
  const canonical = canonicalRegistrationState(state);
  const rule = stateRegulation(state);
  const suggestion = stateVerificationPeriod(state, plate, period);
  const availableCalendars = rule?.calendars || [];
  if (!state.trim()) return <p className="span-2 field-help">Selecciona el estado indicado en las placas o tarjeta para consultar su normativa. No se deduce por la terminación.</p>;
  return <details className="span-2 verification-help" open={initiallyOpen || undefined}><summary>Ayuda de verificación para {canonical || state}</summary>
    {!rule ? <>
      <p><strong>Normativa pendiente de revisión para esta entidad.</strong></p>
      <p className="small">No hay un calendario validado en el sistema para este estado. Esto no significa que esté exento ni que no exista obligación de verificar. Consulta a la autoridad correspondiente y captura las fechas comprobadas manualmente.</p>
    </> : <>
      <p className="small"><strong>Alcance revisado:</strong> {rule.coverage}</p>
      <p className="small muted">Fuentes consultadas el {dateLabel(rule.reviewedOn)}. Esta ficha no certifica cumplimiento ni incorpora automáticamente cambios posteriores.</p>
      <ul className="compact-list">{rule.conditions.map(condition => <li key={condition}>{condition}</li>)}</ul>
      {onApply && availableCalendars.length > 0 && <>
        <label>Periodo del calendario<select value={period} onChange={event => {setPeriod(event.target.value); setConfirmed(false); setApplied(false);}}><option value="">Selecciona el periodo que vas a registrar</option>{availableCalendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.label}</option>)}</select></label>
        <p className="small muted">Usa el último número de la placa, aunque termine en letra. Puedes registrar periodos anteriores; para años o periodos no revisados, conserva la captura manual.</p>
        {suggestion ? <p className="verification-suggestion">Terminación <strong>{suggestion.ending}</strong>: <strong>{dateLabel(suggestion.start)} al {dateLabel(suggestion.end)}</strong>.</p> : <p className="small muted">{numericPlateEnding(plate) === null ? "Primero captura una placa con al menos un número." : "Selecciona un periodo para consultar las fechas."}</p>}
        <label className="check-label"><input type="checkbox" checked={confirmed} onChange={event => {setConfirmed(event.target.checked); setApplied(false);}}/>Confirmo que aplica el calendario ordinario</label>
        <p className="small muted">Revisé las condiciones anteriores y esta unidad no tiene una excepción o plazo especial.</p>
        <button className="button secondary small-button" type="button" disabled={!suggestion || !confirmed} onClick={() => {if (suggestion && confirmed) {onApply(suggestion.start, suggestion.end); setApplied(true); setConfirmed(false);}}}>{hasDates ? "Reemplazar con periodo sugerido" : "Usar periodo sugerido"}</button>
        {hasDates && !applied && <p className="small muted">Ya hay fechas capturadas. Solo se reemplazan si presionas el botón; todavía debes guardar el formulario.</p>}
        {applied && <p role="status" className="small">Fechas colocadas en el formulario. Revísalas y guarda para activar los avisos. No se registra una verificación como realizada.</p>}
      </>}
      <div className="verification-help-actions">{rule.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</div>
    </>}
    <p className="small">La entidad de las placas no basta para resolver todos los casos: considera el lugar de circulación, uso, combustible, holograma y documentos de la unidad. El vencimiento de la tarjeta de circulación se captura según el documento; no se calcula a partir de la placa.</p>
    <OfficialStateReference state={state}/>
  </details>;
}
