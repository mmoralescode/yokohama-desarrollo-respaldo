import {canonicalRegistrationState, type MexicanState} from "./vehicle-jurisdictions";
import {northernStateSources} from "./state-sources-north";
import {southernStateSources} from "./state-sources-south";

export type OfficialSource = {title: string; url: string; topic: "vehicle_control" | "verification" | "legislation" | "circulation"; kind: "official_portal" | "program"};
export type OfficialStateReference = {reviewedOn: string; sources: OfficialSource[]; note: string};
const central: Partial<Record<MexicanState, OfficialStateReference>> = {
  "Ciudad de México": {reviewedOn: "2026-09-30", sources: [
    {title: "SAF: consultas y pagos vehiculares", url: "https://finanzas.cdmx.gob.mx/consultas_pagos", topic: "vehicle_control", kind: "official_portal"},
    {title: "SEMOVI: tarjeta de circulación", url: "https://tramites.cdmx.gob.mx/tarjeta-circulacion/public/", topic: "circulation", kind: "official_portal"},
  ], note: "Consulta tenencia/refrendo y la vigencia documental por unidad. No se presuponen subsidios de personas físicas para una empresa ni se calculan importes o fechas desde la placa."},
  "Estado de México": {reviewedOn: "2026-09-30", sources: [
    {title: "Servicios al Contribuyente: control vehicular", url: "https://pagosytramites.edomex.gob.mx/controlv/ControlVehicular/ControlVehicular.jsp", topic: "vehicle_control", kind: "official_portal"},
    {title: "Tenencia y derechos de control vehicular", url: "https://tenencia.edomex.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
  ], note: "Confirma vencimiento de placas, tarjeta y pago por separado. Reemplacamiento, subsidios y plazos requieren consultar la situación de la unidad y el ejercicio fiscal; no se aplican automáticamente."},
  "Guanajuato": {reviewedOn: "2026-09-30", sources: [
    {title: "SATEG: servicios tributarios estatales", url: "https://sateg.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
  ], note: "Portal oficial para consultar trámites, refrendo y obligaciones. La fecha e importe deben confirmarse para el ejercicio y vehículo; el acceso al portal no equivale a validación integral de normativa."},
  "Hidalgo": {reviewedOn: "2026-09-30", sources: [
    {title: "Hacienda: Portal Tributario y refrendo 2026", url: "https://portaltributario.hidalgo.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
    {title: "Reglas de control vehicular para el ejercicio 2026", url: "https://portaltributario.hidalgo.gob.mx/assets/pdf/2026%20Reglas%20de%20Car%C3%A1cter%20General%20en%20Materia%20de%20Control%20Vehicular%20para%20el%20Ejercicio%20Fiscal%202026.pdf", topic: "legislation", kind: "program"},
  ], note: "Fuentes fiscales oficiales localizadas. Revisa requisitos y posibles prórrogas, sin extrapolar beneficios a una empresa. El calendario ambiental no está habilitado para cálculo en esta versión."},
  "Jalisco": {reviewedOn: "2026-09-30", sources: [
    {title: "Gobierno de Jalisco: refrendo y verificación 2026", url: "https://refrendo.jalisco.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
  ], note: "Distingue el pago de refrendo, vigencia de placas y obligación ambiental por municipio. El portal 2026 es una referencia; no determina por sí solo la situación de cada unidad."},
  "Morelos": {reviewedOn: "2026-09-30", sources: [
    {title: "Morelos Digital: refrendo anual vehicular", url: "https://digital.morelos.gob.mx/tramitesdigitales/", topic: "vehicle_control", kind: "official_portal"},
    {title: "Gobierno de Morelos: plataforma oficial de citas de verificación", url: "https://www.morelos.gob.mx/ultimas-noticias/lanza-gobierno-de-morelos-sistema-agil-de-citas-para-verificacion-vehicular", topic: "verification", kind: "official_portal"},
  ], note: "Se confirmaron los canales oficiales de refrendo y citas. Sus enlaces no sustituyen la revisión del programa ambiental, la documentación ni posibles excepciones; las fechas permanecen manuales."},
  "Puebla": {reviewedOn: "2026-09-30", sources: [
    {title: "Finanzas: consulta de adeudo vehicular", url: "https://rl.puebla.gob.mx/adeudovehicular", topic: "vehicle_control", kind: "official_portal"},
    {title: "Gobierno de Puebla: confirmación del portal autorizado", url: "https://puebla.gob.mx/index.php/noticias/item/22384-gobierno-estatal-alerta-sobre-sitios-web-falsos-para-el-pago-de-control-vehicular", topic: "vehicle_control", kind: "official_portal"},
    {title: "Medio Ambiente: verificación vehicular", url: "https://smadsot.puebla.gob.mx/verificacion", topic: "verification", kind: "official_portal"},
  ], note: "Usa el portal autorizado y confirma requisitos del programa vigente. No se incorporan automáticamente montos, subsidios ni prórrogas; calendario ambiental pendiente de cotejo para cálculo."},
  "Querétaro": {reviewedOn: "2026-09-30", sources: [
    {title: "Recaudanet: tenencia y pagos vehiculares 2026", url: "https://tenencia.queretaro.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
    {title: "Asistencia al Contribuyente: trámites vehiculares", url: "https://asistenciaspf.queretaro.gob.mx/tenencias.html", topic: "vehicle_control", kind: "official_portal"},
  ], note: "Los apoyos fiscales tienen condiciones por contribuyente y vehículo. Confirma si corresponden a la empresa; no se aplican por defecto. Verificación y pago vehicular son controles distintos."},
  "Tlaxcala": {reviewedOn: "2026-09-30", sources: [
    {title: "Finanzas: canales oficiales para refrendo y tenencia", url: "https://sefintlax.gob.mx/portalsf/index.php/preguntas", topic: "vehicle_control", kind: "official_portal"},
    {title: "Finanzas: reposición de tarjeta de circulación", url: "https://rtsp.sefintlax.gob.mx/", topic: "circulation", kind: "official_portal"},
  ], note: "Se contrastaron los accesos oficiales. No reutilices fechas antiguas publicadas en versiones previas del portal; confirma ejercicio, documentos y obligaciones ambientales. Revisión legal integral pendiente."},
  "Veracruz": {reviewedOn: "2026-09-30", sources: [
    {title: "Oficina Virtual de Hacienda: consulta de adeudo vehicular", url: "https://www.ovh.gob.mx/", topic: "vehicle_control", kind: "official_portal"},
  ], note: "Referencia fiscal oficial, no dictamen de cumplimiento. Confirma vigencia documental, programa ambiental y reglas del lugar de operación; no se asignan exenciones ni fechas automáticas por falta de revisión."},
};

export const OFFICIAL_STATE_SOURCES: Partial<Record<MexicanState, OfficialStateReference>> = {...northernStateSources, ...southernStateSources, ...central};
export function officialStateReference(value?: string | null): OfficialStateReference | null {
  const state = canonicalRegistrationState(value);
  return state ? OFFICIAL_STATE_SOURCES[state] || null : null;
}
export const CIRCULATION_SOURCES: OfficialSource[] = [
  {title: "SEDEMA: Programa Hoy No Circula (Valle de México)", url: "https://sedema.cdmx.gob.mx/programas/programa/hoy-no-circula", topic: "circulation", kind: "program"},
  {title: "CAMe: avisos y contingencias ambientales", url: "https://www.gob.mx/comisionambiental/es", topic: "circulation", kind: "official_portal"},
];
