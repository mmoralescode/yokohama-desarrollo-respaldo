import {expect, test, type Page} from "@playwright/test";
import type {CompanyUser} from "../lib/auth-context";
import type {Evidence, VehicleSummary} from "../lib/types";
import {administrationPayload} from "../lib/vehicle-administration";

const admin: CompanyUser = {id: 1, name: "Administrador ficticio", email: "admin.yoko@gmail.com", role: "admin", active: true, vehicle_ids: []};
const driver: CompanyUser = {id: 2, name: "Conductor ficticio", email: "driver@example.invalid", role: "user", active: true, vehicle_ids: [10]};
const vehicle: VehicleSummary = {id: 10, vin: "1HGCM82633A004352", plate: "TST-010-A", make: "Toyota", model: "Corolla", model_year: 2024, variant_id: null, version: "Base", body_style: "Sedán", engine: "1.8", transmission: "AT", drive: "FWD", usage_regime: "normal", current_km: 9000, in_service_date: "2024-01-01", is_synthetic: true, traffic_light: "gray", next_visit_date: null, open_alerts: 0, usage_km_per_day: null};
const existingPhoto: Evidence = {id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", vehicle_id: 10, document_type: "circulation", filename: "tarjeta-admin.jpg", mime_type: "image/jpeg", captured_by: 1, captured_at: "2026-10-01T12:00:00Z", notes: "Documento del administrador para la unidad asignada."};

async function fixture(page: Page, user: CompanyUser) {
  const photos = [structuredClone(existingPhoto)];
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/backend/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/backend/", "");
    const send = (body: unknown, status = 200) => route.fulfill({status, json: body});
    if (path === "auth/status") return send({configured: true, required: true});
    if (path === "auth/me") return send(user);
    if (path === "vehicles") return send([vehicle]);
    if (path === "vehicles/10") return send({vehicle, readings: [], history: [], faults: [], downtime: []});
    if (path === "vehicles/10/plan") return send({vehicle_id: 10, services: [], warnings: [], traffic_light: "gray"});
    if (path === "vehicles/10/documents" && request.method() === "GET") return send(photos.map(({data_url: _private, ...metadata}) => metadata));
    if (path === "vehicles/10/documents" && request.method() === "POST") {
      const body = request.postDataJSON(); writes.push(body);
      const photo = {id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", vehicle_id: 10, document_type: body.document_type, filename: body.photos[0].filename, data_url: body.photos[0].data_url, mime_type: "image/jpeg", captured_by: user.id, captured_at: "2026-10-05T18:00:00Z", notes: body.notes};
      photos.push(photo); return send({photos: [photo]}, 201);
    }
    if (path.startsWith("evidence/")) {
      const photo = photos.find(item => item.id === path.split("/")[1]);
      return photo ? send({...photo, data_url: photo.data_url || "data:image/jpeg;base64,/9j/2Q=="}) : send({detail: "No encontrada."}, 404);
    }
    return send({detail: "Ruta de fixture no disponible."}, 404);
  });
  return writes;
}

test.beforeEach(async ({baseURL}) => {
  test.skip(baseURL !== "http://127.0.0.1:3013", "Solo frontend temporal con respuestas ficticias.");
});

test("alta usa fecha límite sin inventar inicio y conserva validación del periodo histórico", () => {
  const data = new FormData(); data.set("verification_period_end", "2027-05-31");
  expect(administrationPayload(data, {creation: true})).toMatchObject({verification_period_start: null, verification_period_end: "2027-05-31"});
  expect(() => administrationPayload(data)).toThrow("ambas");
  expect(administrationPayload(data, {allowSingleVerificationDate: true})).toMatchObject({verification_period_start: null});
  data.set("verification_period_start", "2027-06-01");
  expect(() => administrationPayload(data, {creation: true})).toThrow("posterior");
});

test("conductor carga y vuelve a consultar documentos compartidos de su unidad", async ({page}) => {
  const writes = await fixture(page, driver);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/vehiculos/10");
  await expect(page.getByRole("heading", {name: "Documentación y vencimientos", exact: true})).toBeVisible();
  await expect(page.getByLabel("Fotos del documento (máximo 3 por carga)")).toBeVisible();
  await expect(page.getByRole("button", {name: "Guardar documentación", exact: true})).toHaveCount(0);
  await expect(page.getByText(existingPhoto.notes!, {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Pronósticos de mantenimiento", exact: true})).toHaveCount(0);
  await page.getByRole("combobox", {name: "Documento", exact: true}).selectOption("verification");
  await page.getByLabel("Notas del documento (opcional)").fill("Comprobante de verificación de prueba.");
  const image = await page.evaluate(() => {const canvas = document.createElement("canvas"); canvas.width = 12; canvas.height = 12; canvas.getContext("2d")!.fillRect(0, 0, 12, 12); return canvas.toDataURL("image/png");});
  await page.getByLabel("Fotos del documento (máximo 3 por carga)").setInputFiles({name: "verificacion.png", mimeType: "image/png", buffer: Buffer.from(image.split(",")[1], "base64")});
  await expect(page.getByAltText("Vista previa: verificacion.jpg")).toBeVisible();
  await page.getByRole("button", {name: "Guardar fotos", exact: true}).click();
  await expect(page.getByText("Fotos guardadas en el expediente de esta unidad.", {exact: true})).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({document_type: "verification", notes: "Comprobante de verificación de prueba."});
  expect(writes[0]).not.toHaveProperty("incident_id");
  await page.reload();
  await expect(page.getByText("Comprobante de verificación de prueba.", {exact: true})).toBeVisible();
  const stored = page.locator(".evidence-row").filter({hasText: "verificacion.jpg"});
  await stored.getByRole("button", {name: "Ver documento", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Fotografía adjunta"})).toBeVisible();
  await expect(page.getByAltText("Evidencia: verificacion.jpg")).toBeVisible();
  await page.getByRole("button", {name: "Cerrar foto", exact: true}).click();
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("administrador tiene fotos inmediatamente y no envía carga vacía ni anida formularios", async ({page}) => {
  const writes = await fixture(page, admin);
  await page.goto("/vehiculos/10");
  await expect(page.getByLabel("Fotos del documento (máximo 3 por carga)")).toBeVisible();
  await expect(page.getByRole("button", {name: "Guardar documentación", exact: true})).toBeVisible();
  await expect(page.locator("form form")).toHaveCount(0);
  await page.getByRole("button", {name: "Guardar fotos", exact: true}).click();
  await expect(page.locator(".document-photos").getByRole("alert")).toContainText("Selecciona al menos una foto");
  expect(writes).toHaveLength(0);
  await expect(page.getByText("Configuración avanzada", {exact: true})).toHaveCount(0);
  await expect(page.getByLabel("Régimen de uso", {exact: true})).toHaveCount(0);
});
