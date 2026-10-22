import {expect, test, type Page} from "@playwright/test";
import {localDate} from "../lib/dates";

test.use({baseURL: process.env.YOKOHAMA_PROPOSAL_TEST_URL || "http://127.0.0.1:3004", channel: "chromium"});
const key = "yokohama-propuesta-administrativa-v1";
async function examplePhoto(page: Page, name: RegExp) {
  const encoded = await page.evaluate(() => {const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 100; const context = canvas.getContext("2d")!; context.fillStyle = "#eee"; context.fillRect(0, 0, 200, 100); context.fillStyle = "black"; context.fillText("EVIDENCIA FICTICIA", 20, 50); return canvas.toDataURL("image/png").split(",")[1];});
  await page.getByLabel(name).setInputFiles({name: "ejemplo.png", mimeType: "image/png", buffer: Buffer.from(encoded, "base64")});
  await expect(page.getByAltText(/Vista previa/)).toBeVisible();
}

test("documentación y alertas de propuesta persisten sin cambiar servicios y lecturas", async ({page}) => {
  await page.goto("/vehiculos/1");
  await expect(page.getByText("Prueba la propuesta.")).toBeVisible();
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Apodo de la unidad (opcional)").fill("Reparto oriente");
  await page.getByLabel("Inicio del periodo de verificación").fill("2026-01-01");
  await page.getByLabel("Fin del periodo de verificación").fill(localDate());
  await page.getByLabel("Vencimiento de tarjeta de circulación").fill(localDate());
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect(page.locator("#documentos")).toContainText("Reparto oriente");
  const before = await page.evaluate(storageKey => {const state = JSON.parse(localStorage.getItem(storageKey)!); return {history: state.details["1"].history, readings: state.details["1"].readings};}, key);
  // Simulate a browser workspace from the previous version, preserving records.
  await page.evaluate(storageKey => {const state = JSON.parse(localStorage.getItem(storageKey)!); delete state.evidence; delete state.incidents; localStorage.setItem(storageKey, JSON.stringify(state));}, key);
  await page.reload();
  await expect(page.getByRole("heading", {level: 1})).toContainText("Reparto oriente");
  await page.getByRole("link", {name: "Alertas", exact: true}).click();
  await expect(page.getByText(/Periodo de verificación: vence hoy/)).toBeVisible();
  await expect(page.getByText(/Tarjeta de circulación: vence hoy/)).toBeVisible();
  const after = await page.evaluate(storageKey => {const state = JSON.parse(localStorage.getItem(storageKey)!); return {history: state.details["1"].history, readings: state.details["1"].readings};}, key);
  expect(after).toEqual(before);
});

test("incidencia con foto y fecha real se conserva al recargar en propuesta", async ({page}) => {
  await page.goto("/incidencias");
  await expect(page.getByText("Prueba la propuesta.")).toBeVisible();
  await page.getByRole("button", {name: "Reportar incidencia", exact: true}).click();
  await page.getByLabel(/^Unidad/).selectOption("1");
  await page.getByLabel("Fecha en que ocurrió").fill("2026-09-10");
  await page.getByLabel("¿Qué ocurrió?").fill("Incidencia ficticia para comprobar una captura tardía.");
  await examplePhoto(page, /^Fotos de la incidencia/);
  await page.getByRole("button", {name: "Guardar incidencia", exact: true}).click();
  await expect(page.locator(".incident-card")).toContainText("captura tardía");
  await page.reload();
  await page.getByRole("button", {name: "Ver foto 1"}).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  const saved = await page.evaluate(storageKey => {const state = JSON.parse(localStorage.getItem(storageKey)!); return {incident: state.incidents[0], photos: state.evidence.length};}, key);
  expect(saved.incident.occurred_on).toBe("2026-09-10"); expect(saved.photos).toBe(1);
});

test("sin espacio no anuncia éxito ni deja una incidencia guardada parcialmente", async ({page}) => {
  await page.goto("/incidencias");
  await page.getByRole("button", {name: "Reportar incidencia", exact: true}).click();
  await page.getByLabel(/^Unidad/).selectOption("1");
  await page.getByLabel("¿Qué ocurrió?").fill("Ejemplo que no debe guardarse si no hay espacio.");
  await examplePhoto(page, /^Fotos de la incidencia/);
  await page.evaluate(storageKey => {const original = Storage.prototype.setItem; Storage.prototype.setItem = function(name, value) {if (name === storageKey) throw new DOMException("Quota exceeded", "QuotaExceededError"); return original.call(this, name, value);};}, key);
  await page.getByRole("button", {name: "Guardar incidencia", exact: true}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("no se guardó parcialmente");
  await expect(page.locator(".incident-card")).toHaveCount(0);
  await expect(page.getByText("Incidencia y fotos guardadas.", {exact: true})).toHaveCount(0);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBeNull();
});

test("normativa de 32 entidades y pago retroactivo conservan historial sin reutilizar pagos", async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/normativa");
  const states = page.getByLabel("Consultar entidad");
  await expect(states.locator("option")).toHaveCount(33);
  await states.selectOption("Sonora");
  await expect(page.getByRole("link", {name: "Hacienda · Padrón vehicular y revalidación"})).toBeVisible();
  await expect(page.getByText("Normativa pendiente de revisión para esta entidad.", {exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("normativa-mobile.png"), fullPage: true});
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Vencimiento o renovación de placas").fill(localDate());
  await page.getByLabel("Fecha límite de refrendo / tenencia").fill("2026-03-31");
  await page.getByLabel("Notas y referencia documental").fill("Ejercicio 2026, consulta fiscal ficticia para pruebas.");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect(page.getByText("Documentación actualizada; los avisos usan las nuevas fechas.")).toBeVisible();
  await page.getByRole("link", {name: "Alertas", exact: true}).click();
  await expect(page.getByText(/Refrendo \/ tenencia: venció/)).toBeVisible();
  await expect(page.getByText(/Vigencia de placas: vence hoy/)).toBeVisible();
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Fecha real del pago vehicular").fill("2026-03-20");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect(page.locator("#documentos")).toContainText("Pago capturado:");
  await page.getByRole("link", {name: "Alertas", exact: true}).click();
  await expect(page.getByText(/Refrendo \/ tenencia: venció/)).toHaveCount(0);
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Fecha límite de refrendo / tenencia").fill("2027-03-31");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("borra explícitamente");
  await page.getByRole("button", {name: "Preparar nuevo periodo de pago"}).click();
  await page.getByLabel("Fecha límite de refrendo / tenencia").fill("2027-03-31");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect(page.getByText("Documentación actualizada; los avisos usan las nuevas fechas.")).toBeVisible();
  await page.getByRole("button", {name: "Ver historial administrativo"}).click();
  await expect(page.locator(".administration-history")).toContainText("2026-03-20");
  const changes = await page.evaluate(storageKey => {const data = JSON.parse(localStorage.getItem(storageKey)!); return {changes: data.administration_changes, vehicle: data.details["1"].vehicle};}, key);
  expect(changes.changes).toHaveLength(3);
  expect(changes.vehicle.vehicle_tax_paid_on).toBeNull();
  expect(changes.vehicle.vehicle_tax_due_on).toBe("2027-03-31");
  await page.reload();
  await expect(page.locator("#documentos")).not.toContainText("Pago capturado:");
});
