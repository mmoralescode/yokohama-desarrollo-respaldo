import {expect, test} from "@playwright/test";
import {administrationPayload, matchesVehicle, numericPlateEnding, plateEnding} from "../lib/vehicle-administration";

test("terminación usa cuatro caracteres; búsqueda normaliza placa y apodo", () => {
  expect(plateEnding("YKH-109-A")).toBe("09-A");
  expect(plateEnding(" abc-0 ")).toBe("BC-0");
  expect(plateEnding("ESPECIAL")).toBe("CIAL");
  expect(plateEnding("ABC")).toBe("ABC");
  expect(plateEnding("  ")).toBeNull();
  expect(numericPlateEnding("YKH-109-A")).toBe("9");
  expect(numericPlateEnding("ESPECIAL")).toBeNull();
  const vehicle = {plate: "NXR-482-B", nickname: "El Águila", vin: "9HGCM82633A004352", model_year: 2024};
  expect(matchesVehicle(vehicle, "2")).toBeTruthy();
  expect(matchesVehicle(vehicle, "82-b")).toBeTruthy();
  expect(matchesVehicle(vehicle, "82B")).toBeTruthy();
  expect(matchesVehicle(vehicle, "482b")).toBeTruthy();
  expect(matchesVehicle(vehicle, "el aguila")).toBeTruthy();
  expect(matchesVehicle(vehicle, "sin coincidencia")).toBeFalsy();
});
test("formulario borra con null y exige ambas fechas en orden", () => {
  const form = new FormData(); form.set("nickname", "  La blanca  ");
  expect(administrationPayload(form)).toMatchObject({nickname: "La blanca", verification_period_start: null, verification_period_end: null, circulation_card_expires_on: null, document_alert_days: 30});
  form.set("verification_period_start", "2026-10-01");
  expect(() => administrationPayload(form)).toThrow("ambas");
  form.set("verification_period_end", "2026-09-30");
  expect(() => administrationPayload(form)).toThrow("posterior");
});
