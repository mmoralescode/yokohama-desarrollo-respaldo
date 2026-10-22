import {expect, test} from "@playwright/test";
import {canonicalRegistrationState, MEXICAN_STATES, STATE_REGULATIONS, stateRegulation, stateVerificationPeriod} from "../lib/vehicle-jurisdictions";
import {queretaroVerificationPeriod} from "../lib/queretaro-verification";
import {OFFICIAL_STATE_SOURCES, officialStateReference} from "../lib/official-state-sources";

test("directorio completo de 32 entidades con enlaces oficiales, no fechas fiscales automáticas", () => {
  expect(Object.keys(OFFICIAL_STATE_SOURCES).sort()).toEqual([...MEXICAN_STATES].sort());
  for (const state of MEXICAN_STATES) {
    const reference = officialStateReference(state)!;
    expect(reference.sources.length).toBeGreaterThan(0);
    expect(reference.reviewedOn).toBe("2026-09-30");
    expect(reference.note.length).toBeGreaterThan(40);
    for (const source of reference.sources) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(".gob.mx")).toBeTruthy();
      expect(source.kind).toMatch(/^(official_portal|program)$/);
    }
  }
  expect(officialStateReference("constructor")).toBeNull();
});

test("32 entidades únicas, alias históricos consultables y valores desconocidos seguros", () => {
  expect(MEXICAN_STATES).toHaveLength(32);
  expect(new Set(MEXICAN_STATES).size).toBe(32);
  expect(canonicalRegistrationState("  qUeReTaRo  ")).toBe("Querétaro");
  expect(canonicalRegistrationState("CDMX")).toBe("Ciudad de México");
  expect(canonicalRegistrationState("Michoacán de Ocampo")).toBe("Michoacán");
  for (const value of ["", "Otro estado", "__proto__", "constructor", undefined, null]) expect(canonicalRegistrationState(value)).toBeNull();
});

test("ningún estado pendiente hereda el calendario de otra entidad", () => {
  for (const state of MEXICAN_STATES) {
    if (!STATE_REGULATIONS[state]) {
      expect(stateRegulation(state)).toBeNull();
      expect(stateVerificationPeriod(state, "QRO-482-B", "2026-2")).toBeNull();
    }
  }
  expect(stateVerificationPeriod("", "QRO-482-B", "2026-2")).toBeNull();
  expect(stateVerificationPeriod("Sonora", "QRO-482-B", "2026-anual")).toBeNull();
});

test("Querétaro conserva exactamente las fechas ya revisadas", () => {
  for (const ending of "0123456789") for (const semester of [1, 2] as const) {
    expect(stateVerificationPeriod("Querétaro", `ABC-12${ending}-B`, `2026-${semester}`)).toEqual(queretaroVerificationPeriod(`ABC-12${ending}-B`, 2026, semester));
  }
});

test("Jalisco tiene calendario anual propio, no semestral ni compartido por terminación", () => {
  const months = {"1": ["01", "02", "28"], "2": ["02", "03", "31"], "3": ["03", "04", "30"], "4": ["04", "05", "31"], "5": ["05", "06", "30"], "6": ["07", "08", "31"], "7": ["08", "09", "30"], "8": ["09", "10", "31"], "9": ["10", "11", "30"], "0": ["11", "12", "31"]};
  for (const [ending, [startMonth, endMonth, day]] of Object.entries(months)) {
    expect(stateVerificationPeriod("Jalisco", `ABC-12${ending}-B`, "2026-anual")).toEqual({start: `2026-${startMonth}-01`, end: `2026-${endMonth}-${day}`, ending});
  }
  expect(stateVerificationPeriod("Jalisco", "ABC-123-B", "2026-2")).toBeNull();
  expect(stateVerificationPeriod("Querétaro", "ABC-123-B", "2026-anual")).toBeNull();
});

test("solo aparecen periodos revisados y las fuentes son explícitas", () => {
  expect(stateVerificationPeriod("Estado de México", "ABC-122-B", "2026-2")).toBeNull();
  expect(stateVerificationPeriod("Estado de México", "ABC-122-B", "2026-1")).toEqual({start: "2026-04-01", end: "2026-05-31", ending: "2"});
  for (const state of Object.keys(STATE_REGULATIONS)) {
    const rule = stateRegulation(state)!;
    expect(rule.sources.length).toBeGreaterThan(0);
    expect(rule.reviewedOn).toBe("2026-09-30");
    expect(rule.coverage).toContain("2026");
    expect(stateVerificationPeriod(state, "ABC-123-B", "2027-1")).toBeNull();
    for (const calendar of rule.calendars) expect(stateVerificationPeriod(state, "SIN-DIGITOS", calendar.id)).toBeNull();
  }
});
