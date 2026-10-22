import {normalizeSearch} from "./drivers";
import {numericPlateEnding} from "./vehicle-administration";

/** Display names follow the 32 federal entities; stored legacy text is never rewritten. */
export const MEXICAN_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
  "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero",
  "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
  "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
] as const;
export type MexicanState = typeof MEXICAN_STATES[number];

const aliases: Record<string, MexicanState> = {
  cdmx: "Ciudad de México", "distrito federal": "Ciudad de México", df: "Ciudad de México",
  edomex: "Estado de México", mexico: "Estado de México", "edo mex": "Estado de México",
  qro: "Querétaro", "coahuila de zaragoza": "Coahuila", "michoacan de ocampo": "Michoacán",
  "veracruz de ignacio de la llave": "Veracruz",
};
export function canonicalRegistrationState(value?: string | null): MexicanState | null {
  const key = normalizeSearch(value || "");
  return MEXICAN_STATES.find(state => normalizeSearch(state) === key) || (Object.hasOwn(aliases, key) ? aliases[key] : null);
}

type MonthsByEnding = Readonly<Record<string, readonly [number, number]>>;
export type VerificationCalendar = {id: string; label: string; year: number; months: MonthsByEnding};
export type StateRegulation = {
  state: MexicanState; reviewedOn: string; coverage: string; conditions: string[];
  sources: {title: string; url: string}[]; calendars: VerificationCalendar[];
};
const firstSemester: MonthsByEnding = {"5": [1, 2], "6": [1, 2], "7": [2, 3], "8": [2, 3], "3": [3, 4], "4": [3, 4], "1": [4, 5], "2": [4, 5], "9": [5, 6], "0": [5, 6]};
const secondSemester: MonthsByEnding = {"5": [7, 8], "6": [7, 8], "7": [8, 9], "8": [8, 9], "3": [9, 10], "4": [9, 10], "1": [10, 11], "2": [10, 11], "9": [11, 12], "0": [11, 12]};

/** Each jurisdiction explicitly opts into its reviewed calendars. No national fallback. */
export const STATE_REGULATIONS: Partial<Record<MexicanState, StateRegulation>> = {
  "Ciudad de México": {
    state: "Ciudad de México", reviewedOn: "2026-09-30", coverage: "Programas de verificación de enero–junio y julio–diciembre de 2026; calendario ordinario para automóvil particular de combustión.",
    conditions: [
      "Confirma que la unidad esté sujeta a verificación ordinaria, sin holograma 00 vigente ni constancia exenta.",
      "Eléctricos o híbridos elegibles, altas, cambios de placas, prórrogas y regularizaciones requieren revisión individual; no se calculan aquí. No deduzcas una exención solo por la palabra híbrido.",
      "La tarjeta de circulación usa la vigencia confirmada en el documento o consulta de SEMOVI, no la fecha de la verificación.",
    ],
    sources: [
      {title: "SEDEMA: programa del primer semestre de 2026", url: "https://proyectos.sedema.cdmx.gob.mx/datos/storage/app/media/gacetas/GOCDMX_26-01-02_DGCA.pdf"},
      {title: "SEDEMA: programa del segundo semestre de 2026", url: "https://proyectos.sedema.cdmx.gob.mx/datos/storage/app/media/gacetas/GOCDMX_26-07-01_DGCA.pdf"},
      {title: "CDMX: trámite de tarjeta de circulación", url: "https://tramites.cdmx.gob.mx/tarjeta-circulacion/public/"},
    ],
    calendars: [{id: "2026-1", label: "Primer semestre de 2026", year: 2026, months: firstSemester}, {id: "2026-2", label: "Segundo semestre de 2026", year: 2026, months: secondSemester}],
  },
  "Estado de México": {
    state: "Estado de México", reviewedOn: "2026-09-30", coverage: "Programa del primer semestre de 2026, enero–junio. Segundo semestre de 2026 pendiente de revisión: captura manual.",
    conditions: [
      "Solo calendario ordinario del primer semestre. La publicación del segundo semestre está localizada, pero su contenido aún no fue validado en esta versión.",
      "Holograma 00, exento, eléctricos/híbridos elegibles, autorregulación, discapacidad, GAS, altas, cambios de placas y casos extemporáneos requieren revisión documental individual.",
      "No confundas la vigencia de las placas con el vencimiento de la tarjeta de circulación; registra la fecha del documento correspondiente.",
    ],
    sources: [
      {title: "LEGISTEL: programa del primer semestre de 2026", url: "https://legislacion.edomex.gob.mx/sites/legislacion.edomex.gob.mx/files/files/pdf/gct/2025/diciembre/dic311/dic311b.pdf"},
      {title: "Copia archivada del documento oficial consultado", url: "https://web.archive.org/web/20260118170750if_/https://legislacion.edomex.gob.mx/sites/legislacion.edomex.gob.mx/files/files/pdf/gct/2025/diciembre/dic311/dic311b.pdf"},
      {title: "SEMADES: segundo semestre de 2026 (pendiente de revisión)", url: "https://sma.edomex.gob.mx/sites/sma.edomex.gob.mx/files/images/TramitesServicios/VerificacioVehicular/SegundoSEmes2026/jun301c.pdf"},
    ],
    calendars: [{id: "2026-1", label: "Primer semestre de 2026", year: 2026, months: firstSemester}],
  },
  "Guanajuato": {
    state: "Guanajuato", reviewedOn: "2026-09-30", coverage: "Calendario semestral publicado por SAMA para distintivo usual, consultado en 2026. La edición del programa normativo completo sigue pendiente de cotejo.",
    conditions: [
      "Solo distintivo usual semestral, sin excepción o plazo especial. Confirma la clasificación y la constancia de esta unidad antes de usar la sugerencia.",
      "Los hologramas 00, 0, 1, 2 y exento tienen condiciones propias; no se asignan por año-modelo ni combustible. No aplicar automáticamente el calendario usual a esos casos.",
    ],
    sources: [
      {title: "SAMA: calendario publicado de verificación", url: "https://sama.guanajuato.gob.mx/verificacion-vehicular/"},
      {title: "SAMA: distintivo usual", url: "https://sama.guanajuato.gob.mx/verificacion-vehicular/distintivo-usual/"},
      {title: "Gobierno de Guanajuato: programa activo en 2026", url: "https://boletines.guanajuato.gob.mx/2026/05/20/promueve-secretaria-del-agua-y-medio-ambiente-programa-estatal-de-verificacion-vehicular/"},
    ],
    calendars: [{id: "2026-1", label: "Primer semestre de 2026 — usual", year: 2026, months: firstSemester}, {id: "2026-2", label: "Segundo semestre de 2026 — usual", year: 2026, months: secondSemester}],
  },
  "Jalisco": {
    state: "Jalisco", reviewedOn: "2026-09-30", coverage: "Calendario anual 2026 para vehículos particulares obligados. No es un calendario semestral.",
    conditions: [
      "Confirma que la unidad circula de forma permanente en un municipio cubierto por el programa. La obligación no depende únicamente de que tenga placas de Jalisco; consulta la cobertura oficial.",
      "La ayuda solo cubre el uso particular ordinario. Vehículos exentos, placas federales, modelos nuevos, permisos temporales y otros usos o plazos especiales requieren revisión individual.",
      "No basta que el vehículo se anuncie como híbrido para considerarlo exento: un microhíbrido (MHEV) tiene tratamiento distinto.",
    ],
    sources: [
      {title: "Gobierno de Jalisco: calendario y programa 2026", url: "https://refrendo.jalisco.gob.mx/"},
      {title: "Verificación Responsable: cobertura, calendario y excepciones", url: "https://verificacionresponsable.jalisco.gob.mx/preguntas-frecuentes"},
    ],
    calendars: [{id: "2026-anual", label: "Periodo anual de 2026 — particular", year: 2026, months: {"1": [1, 2], "2": [2, 3], "3": [3, 4], "4": [4, 5], "5": [5, 6], "6": [7, 8], "7": [8, 9], "8": [9, 10], "9": [10, 11], "0": [11, 12]}}],
  },
  "Querétaro": {
    state: "Querétaro", reviewedOn: "2026-09-30", coverage: "Calendario ordinario de uso particular y pesado, 2026.",
    conditions: [
      "Solo vehículos de uso particular o pesado sujetos al calendario ordinario. El servicio público tiene periodos distintos.",
      "No aplicar a holograma 00 vigente, exención, alta reciente, cambio de placas u otro plazo especial. Captura esos casos según su documentación y SEDESU.",
    ],
    sources: [{title: "SEDESU: calendario y requisitos", url: "https://queretaro.gob.mx/es/web/sedesu/calendario"}],
    calendars: [{id: "2026-1", label: "Primer semestre de 2026", year: 2026, months: firstSemester}, {id: "2026-2", label: "Segundo semestre de 2026", year: 2026, months: secondSemester}],
  },
};

export function stateRegulation(value?: string | null): StateRegulation | null {
  const state = canonicalRegistrationState(value);
  return state ? STATE_REGULATIONS[state] || null : null;
}

export function stateVerificationPeriod(state: string, plate: string, calendarId: string): {start: string; end: string; ending: string} | null {
  const rule = stateRegulation(state);
  const calendar = rule?.calendars.find(item => item.id === calendarId);
  const ending = numericPlateEnding(plate);
  if (!calendar || ending === null) return null;
  const months = calendar.months[ending];
  if (!months) return null;
  const [startMonth, endMonth] = months;
  const lastDay = new Date(Date.UTC(calendar.year, endMonth, 0)).getUTCDate();
  return {start: `${calendar.year}-${String(startMonth).padStart(2, "0")}-01`, end: `${calendar.year}-${String(endMonth).padStart(2, "0")}-${lastDay}`, ending};
}
