"use client";
import {useEffect, useState} from "react";
import {MEXICAN_STATES, canonicalRegistrationState, stateRegulation} from "@/lib/vehicle-jurisdictions";
import {CIRCULATION_SOURCES} from "@/lib/official-state-sources";
import {PageHeader} from "@/components/ui";
import StateRegulationHelp from "@/components/state-regulation-help";
import {Disclosure} from "@/components/disclosure";
import "@/components/administration.css";

// Retained reference module, deliberately not exposed in the operational UI.
export default function ArchivedRegulationsPage() {
  const [state, setState] = useState("");
  useEffect(() => {setState(canonicalRegistrationState(new URLSearchParams(window.location.search).get("estado")) || "");}, []);
  const rule = stateRegulation(state);
  return <><PageHeader eyebrow="GUÍA ADMINISTRATIVA" title="Normativa y trámites" description="Consulta la entidad de las placas y revisa también las reglas del lugar donde circula la unidad. Fuentes oficiales para las 32 entidades; automatización limitada a los periodos revisados."/>
    <Disclosure title="Qué conviene controlar" description="Verificación, documentos, pagos y condiciones de circulación."><div className="panel-body"><ol className="compliance-checklist"><li><strong>Verificación:</strong> confirma uso, combustible, holograma, municipio y excepciones.</li><li><strong>Tarjeta y placas:</strong> registra sus vigencias por separado según los documentos o consulta oficial.</li><li><strong>Refrendo / tenencia:</strong> captura el plazo del periodo y el día real del pago. No suponemos descuentos ni ausencia de otros adeudos.</li><li><strong>Circulación:</strong> antes de un traslado revisa las restricciones del destino y los avisos extraordinarios.</li></ol><p className="small muted">Este módulo organiza referencias y fechas: no sustituye la revisión de la norma vigente ni certifica cumplimiento legal. Un calendario no revisado nunca significa que la unidad esté exenta.</p></div></Disclosure>
    <section className="panel"><div className="panel-body"><label>Consultar entidad<select value={state} onChange={event => setState(event.target.value)}><option value="">Selecciona una de las 32 entidades</option>{MEXICAN_STATES.map(item => <option key={item}>{item}</option>)}</select></label>{state ? <><p className="small muted">{rule ? `Periodos con ayuda de captura: ${rule.calendars.map(calendar => calendar.label).join("; ")}. Fuera de ese alcance, captura manual.` : "Directorio oficial disponible. Calendario automático no habilitado: consulta la fuente y captura fechas comprobadas."}</p><StateRegulationHelp key={state} state={state} plate="" hasDates={false} initiallyOpen/></> : <p className="muted">No se presume la entidad ni se asignan obligaciones por el nombre de la empresa.</p>}</div></section>
    <Disclosure title="Antes de circular fuera de la base" description="Fuentes y restricciones del lugar de destino."><div className="panel-body"><p>Las reglas del destino pueden afectar a placas foráneas. Los siguientes enlaces son del Valle de México y la Megalópolis, no una regla para todo el país. Consulta también la autoridad del municipio de destino.</p><ul className="compact-list">{CIRCULATION_SOURCES.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul><p className="small muted">No hay consulta en vivo de contingencias ni un indicador automático de “puede circular”. Anota la zona de operación y cualquier excepción en la documentación de la unidad.</p></div></Disclosure>
  </>;
}
