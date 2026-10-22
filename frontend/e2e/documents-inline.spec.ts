import {expect, test, type Page} from "@playwright/test";
import type {Plan, VehicleDetail, VehicleSummary} from "../lib/types";

// Only the isolated public-proposal server and this browser's synthetic data.
const storageKey = "yokohama-propuesta-administrativa-v1";
const unitId = "15";
const note = "Referencia ficticia conservada: expediente documental 15.";
type Snapshot = {vehicles: VehicleSummary[]; details: Record<string, VehicleDetail>; plans: Record<string, Plan>; [key: string]: unknown};

async function readSaved(page: Page) {
  return page.evaluate(({key, id}) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    return {vehicle: state.details[id].vehicle, readings: state.details[id].readings,
      history: state.details[id].history, plan: state.plans[id], changes: state.administration_changes};
  }, {key: storageKey, id: unitId});
}

async function openFixture(page: Page) {
  const response = await page.request.get("/proposal/fleet.json");
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as Snapshot;
  expect(snapshot.vehicles.every(vehicle => vehicle.is_synthetic)).toBe(true);
  const values = {nickname: "Entrega documental", registration_state: "Sonora", verification_period_start: "2030-01-01",
    verification_period_end: "2030-06-30", circulation_card_expires_on: "2030-12-31", plates_expires_on: "2031-12-31",
    vehicle_tax_due_on: "2026-03-31", vehicle_tax_paid_on: "2026-03-20", document_alert_days: 45, administrative_notes: note};
  Object.assign(snapshot.details[unitId].vehicle, values);
  snapshot.vehicles = snapshot.vehicles.map(vehicle => vehicle.id === Number(unitId) ? {...vehicle, ...values} : vehicle);
  const initial = {...snapshot, revision: 1, appointments: [], completed: [], evidence: [], incidents: [], administration_changes: []};
  await page.addInitScript(({key, state}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
  }, {key: storageKey, state: initial});
  await page.goto(`/vehiculos/${unitId}`);
  await expect(page.getByRole("heading", {name: "Documentación y vencimientos", exact: true})).toBeVisible();
  await expect(page.getByLabel("Apodo de la unidad (opcional)")).toBeVisible();
  await expect(page.getByRole("button", {name: "Editar documentación", exact: true})).toHaveCount(0);
  return readSaved(page);
}

test.beforeEach(async ({baseURL}) => {
  test.skip(baseURL !== "http://127.0.0.1:3007", "Solo servidor temporal de propuesta y datos ficticios.");
});

test("tarjetas editables desde la apertura guardan y preservan registros en móvil", async ({page}, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const before = await openFixture(page);
  for (const label of ["Inicio del periodo de verificación", "Fin del periodo de verificación",
    "Vencimiento de tarjeta de circulación", "Vencimiento o renovación de placas", "Fecha límite de refrendo / tenencia",
    "Fecha real del pago vehicular"]) {
    await expect(page.getByLabel(label, {exact: true})).toBeVisible();
    await expect(page.getByLabel(label, {exact: true})).toBeEditable();
  }
  await expect(page.locator(".document-edit-card")).toHaveCount(4);
  await page.getByLabel("Apodo de la unidad (opcional)").fill("Entrega central");
  await page.getByLabel("Inicio del periodo de verificación").fill("2030-02-01");
  await page.getByLabel("Fin del periodo de verificación").fill("2030-07-31");
  await page.getByLabel("Vencimiento de tarjeta de circulación").fill("2031-01-31");
  await page.getByLabel("Vencimiento o renovación de placas").fill("2032-01-31");
  // These controls stay collapsed; saving the cards must preserve their values.
  await expect(page.getByLabel("Avisar con anticipación (días)")).toHaveValue("45");
  await expect(page.getByLabel("Notas y referencia documental")).toHaveValue(note);
  await page.getByRole("button", {name: "Guardar documentación", exact: true}).click();
  await expect(page.getByText("Documentación actualizada; los avisos usan las nuevas fechas.", {exact: true})).toBeVisible();
  const after = await readSaved(page);
  expect(after.vehicle.nickname).toBe("Entrega central");
  expect(after.vehicle.document_alert_days).toBe(45);
  expect(after.vehicle.administrative_notes).toBe(note);
  expect(after.readings).toEqual(before.readings);
  expect(after.history).toEqual(before.history);
  expect(after.plan).toEqual(before.plan);
  expect(after.changes).toHaveLength(1);
  expect(after.changes[0].vehicle_id).toBe(Number(unitId));
  await page.reload();
  await expect(page.getByLabel("Apodo de la unidad (opcional)")).toHaveValue("Entrega central");
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("2030-02-01");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2030-07-31");
  await expect(page.getByLabel("Vencimiento de tarjeta de circulación")).toHaveValue("2031-01-31");
  await expect(page.getByLabel("Vencimiento o renovación de placas")).toHaveValue("2032-01-31");
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.getByLabel("Fecha límite de refrendo / tenencia")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: info.outputPath("documents-inline-mobile.png"), fullPage: true});
  expect(errors).toEqual([]);
});

test("periodo de verificación incompleto o invertido no guarda cambios parciales", async ({page}) => {
  const before = await openFixture(page);
  await page.getByLabel("Apodo de la unidad (opcional)").fill("No debe guardarse");
  await page.getByLabel("Inicio del periodo de verificación").fill("");
  await page.getByRole("button", {name: "Guardar documentación", exact: true}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("Captura inicio y fin");
  expect(await readSaved(page)).toEqual(before);
  await page.getByLabel("Inicio del periodo de verificación").fill("2031-01-01");
  await page.getByRole("button", {name: "Guardar documentación", exact: true}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("igual o posterior");
  expect(await readSaved(page)).toEqual(before);
  await page.reload();
  await expect(page.getByLabel("Apodo de la unidad (opcional)")).toHaveValue("Entrega documental");
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("2030-01-01");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2030-06-30");
});

test("nuevo periodo de pago requiere limpiar el anterior y conserva su auditoría", async ({page}) => {
  const before = await openFixture(page);
  await page.getByLabel("Fecha límite de refrendo / tenencia").fill("2030-03-31");
  await page.getByRole("button", {name: "Guardar documentación", exact: true}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("borra explícitamente");
  expect(await readSaved(page)).toEqual(before);
  await page.getByRole("button", {name: "Preparar nuevo periodo de pago", exact: true}).click();
  await expect(page.getByLabel("Fecha real del pago vehicular")).toHaveValue("");
  await page.getByLabel("Fecha límite de refrendo / tenencia").fill("2030-03-31");
  await page.getByRole("button", {name: "Guardar documentación", exact: true}).click();
  await expect(page.getByText("Documentación actualizada; los avisos usan las nuevas fechas.", {exact: true})).toBeVisible();
  const saved = await readSaved(page);
  expect(saved.vehicle.vehicle_tax_due_on).toBe("2030-03-31");
  expect(saved.vehicle.vehicle_tax_paid_on).toBeNull();
  expect(saved.vehicle.document_alert_days).toBe(45);
  expect(saved.vehicle.administrative_notes).toBe(note);
  expect(saved.readings).toEqual(before.readings);
  expect(saved.history).toEqual(before.history);
  expect(saved.changes).toHaveLength(1);
  expect(saved.changes[0].previous_values.vehicle_tax_paid_on).toBe("2026-03-20");
  expect(saved.changes[0].new_values.vehicle_tax_paid_on).toBeNull();
  await page.getByRole("button", {name: "Ver historial administrativo", exact: true}).click();
  await expect(page.locator(".administration-history")).toContainText("2026-03-20");
  await page.reload();
  await expect(page.getByLabel("Fecha límite de refrendo / tenencia")).toHaveValue("2030-03-31");
  await expect(page.getByLabel("Fecha real del pago vehicular")).toHaveValue("");
});
