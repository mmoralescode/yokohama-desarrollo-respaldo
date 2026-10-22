import {expect, test, type Page} from "@playwright/test";
import type {Evidence, Incident, Plan, Reading, VehicleDetail, VehicleSummary} from "../lib/types";
import {localDate} from "../lib/dates";

test.use({baseURL: process.env.YOKOHAMA_ADMIN_TEST_URL || "http://127.0.0.1:3006", channel: "chromium"});
const today = localDate();
const past = "2026-09-10";
const photoId = "35d58f5d-c098-4110-b1df-1b197e84bf22";
const incidentId = "ea929edd-ab79-4437-a81c-7cbd55cbafcd";
const unit: VehicleSummary = {id: 1, vin: "1HGCM82633A004352", plate: "NXR-482-B", make: "Toyota", model: "Corolla", model_year: 2024, variant_id: null, version: "LE", body_style: "Sedán", engine: "1.8L", transmission: "CVT", drive: "FWD", current_km: 28000, in_service_date: "2024-01-01", usage_regime: "normal", is_synthetic: true, drivers: ["Ana López"], nickname: "La blanca", document_alert_days: 30, traffic_light: "gray", next_visit_date: null, open_alerts: 0, usage_km_per_day: 0};
const plan: Plan = {vehicle_id: 1, generated_on: today, catalog_version: "unassigned", mode: "test", usage: {km_per_day: 0, low_km_per_day: 0, high_km_per_day: 0, confidence: "baja", valid_intervals: 0, rejected_readings: 0, explanation: "Datos para prueba."}, services: [], visits: [], alerts: [], traffic_light: "gray", warnings: []};

async function fixture(page: Page, options: {user?: boolean; failPhoto?: boolean} = {}) {
  const state = {vehicle: structuredClone(unit), writes: [] as {path: string; body: any}[], readings: [{id: 1, vehicle_id: 1, date: "2026-09-01", recorded_at: "2026-09-01T18:00:00Z", odometer_km: 28000, source: "manual"}] as Reading[], evidence: [] as Evidence[], incidents: [] as Incident[], errors: [] as string[]};
  let failPhoto = options.failPhoto;
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/backend/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace("/api/backend/", "");
    let result: unknown;
    if (request.method() !== "GET") {
      const body = request.postDataJSON(); state.writes.push({path, body});
      if (path === "vehicles/1/administration") result = Object.assign(state.vehicle, body);
      else if (path === "vehicles/1/readings") {const row = {id: 2, vehicle_id: 1, date: body.recorded_at.slice(0, 10), ...body}; state.readings.push(row); result = row;}
      else if (path === "vehicles/1/odometer-evidence") {
        if (failPhoto) {failPhoto = false; await route.fulfill({status: 503, json: {detail: "Intenta cargar la foto otra vez."}}); return;}
        const reading = state.readings.find(row => row.id === body.reading_id)!;
        const photo: Evidence = {id: photoId, vehicle_id: 1, reading_id: reading.id, observed_on: reading.date, odometer_km: reading.odometer_km, filename: body.photo.filename, mime_type: "image/jpeg", captured_at: new Date().toISOString(), notes: body.notes, data_url: body.photo.data_url};
        state.evidence.push(photo); result = photo;
      } else if (path === "vehicles/1/incidents") {
        const photos = body.photos.map((photo: {filename: string; data_url: string}) => ({id: photoId, vehicle_id: 1, ...photo, mime_type: "image/jpeg", captured_at: new Date().toISOString()})); state.evidence.push(...photos);
        const incident = {id: incidentId, vehicle_id: 1, plate: unit.plate, nickname: unit.nickname, ...body, status: "abierta", captured_at: new Date().toISOString(), photos}; state.incidents.push(incident); result = incident;
      } else if (path === `incidents/${incidentId}`) result = Object.assign(state.incidents[0], body);
      else {await route.fulfill({status: 403, json: {detail: "Operación no permitida en prueba."}}); return;}
    } else if (path === "auth/status") result = {configured: !!options.user, required: !!options.user};
    else if (path === "auth/me") result = {id: 2, name: "Ana López", email: "ana@example.test", role: "user", active: true, vehicle_ids: [1]};
    else if (path === "vehicles") result = [state.vehicle, ...(options.user ? [] : [{...unit, id: 2, plate: "NXR-123-B", nickname: "La azul"}])];
    else if (path === "vehicles/1") result = {vehicle: state.vehicle, readings: state.readings, history: [], faults: [], downtime: []} satisfies VehicleDetail;
    else if (path === "vehicles/1/plan") result = plan;
    else if (path === "vehicles/1/odometer-evidence") result = state.evidence.filter(row => row.reading_id);
    else if (path === `evidence/${photoId}`) result = state.evidence.find(row => row.id === photoId);
    else if (path === "incidents" || path === "vehicles/1/incidents") result = state.incidents;
    else if (path === "variants") result = {variantes: []};
    else if (path === "metrics") result = {total_services: 0, classified_services: 0, preventive_services: 0, services_before_failure_percent: null, prediction_samples: 0, mean_absolute_error_days: null, mean_signed_error_days: null, unpredicted_failures: 0, classified_failures: 0, total_failures: 0, downtime_days: 0, open_downtimes: 0, as_of: today, timezone: "America/Mexico_City"};
    else if (path === "document-alerts" || path === "alerts" || path === "notifications" || path === "calendar") result = [];
    if (result === undefined) {await route.fulfill({status: 404, json: {detail: `Ruta sin fixture: ${path}`}}); return;}
    await route.fulfill({status: request.method() === "GET" ? 200 : 201, json: result});
  });
  return state;
}
async function upload(page: Page, label: RegExp) {
  const content = await page.evaluate(() => {const canvas = document.createElement("canvas"); canvas.width = 240; canvas.height = 120; const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, 240, 120); context.fillStyle = "black"; context.font = "24px sans-serif"; context.fillText("28100 km", 20, 60); return canvas.toDataURL("image/png").split(",")[1];});
  await page.getByLabel(label).setInputFiles({name: "odometro.png", mimeType: "image/png", buffer: Buffer.from(content, "base64")});
  await expect(page.getByAltText(/Vista previa/)).toBeVisible();
}

test("búsqueda por último dígito y apodo; documentación editable y borrado explícito", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("searchbox", {name: /^Buscar por placa/}).fill("2");
  await expect(page.locator(".plate-link")).toHaveText(["NXR-482-B"]);
  await page.getByRole("searchbox", {name: /^Buscar por placa/}).fill("azul");
  await expect(page.locator(".plate-link")).toHaveText(["NXR-123-B"]);
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Apodo de la unidad (opcional)").fill("Reparto norte");
  await page.getByLabel("Estado de emplacamiento (opcional)").selectOption("Estado de México");
  await page.getByLabel("Inicio del periodo de verificación").fill("2026-09-01");
  await page.getByLabel("Fin del periodo de verificación").fill("2026-10-31");
  await page.getByLabel("Vencimiento de tarjeta de circulación").fill("2026-10-15");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect.poll(() => state.vehicle.nickname).toBe("Reparto norte");
  await expect(page.locator("#documentos")).toContainText("Estado de México");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByLabel("Inicio del periodo de verificación").fill("");
  await page.getByLabel("Fin del periodo de verificación").fill("");
  await page.getByLabel("Vencimiento de tarjeta de circulación").fill("");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect.poll(() => state.writes.at(-1)?.body.verification_period_end).toBe(null);
  expect(state.errors).toEqual([]);
});

test("foto fallida se reintenta sin duplicar lectura y puede consultarse", async ({page}) => {
  const state = await fixture(page, {failPhoto: true});
  await page.goto("/vehiculos/1");
  await page.getByLabel("Fecha y hora de lectura (CDMX)").fill(`${past}T12:00`);
  await page.getByLabel("Odómetro (km)", {exact: true}).fill("28100");
  await upload(page, /^Foto del kilometraje \(opcional\)/);
  await page.getByRole("button", {name: "Guardar lectura", exact: true}).click();
  await expect(page.locator(".mutation-form").getByRole("alert")).toContainText("La lectura ya quedó guardada");
  await page.getByRole("button", {name: "Reintentar guardar foto"}).click();
  await expect(page.getByText("Lectura y fotografía guardadas.", {exact: true})).toBeVisible();
  expect(state.writes.filter(write => write.path.endsWith("/readings"))).toHaveLength(1);
  expect(state.writes.filter(write => write.path.endsWith("/odometer-evidence"))).toHaveLength(2);
  await page.getByRole("button", {name: "Ver foto", exact: true}).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("incidencia retroactiva con foto, seguimiento y pantalla móvil", async ({page}, info) => {
  const state = await fixture(page);
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/incidencias");
  await page.getByRole("button", {name: "Reportar incidencia", exact: true}).click();
  await page.getByLabel(/^Unidad/).selectOption("1");
  await page.getByLabel("Fecha en que ocurrió").fill(past);
  await page.getByLabel("Tipo de incidencia").selectOption("documentacion");
  await page.getByLabel("¿Qué ocurrió?").fill("Se recibió el comprobante de verificación días después.");
  await upload(page, /^Fotos de la incidencia/);
  await page.getByRole("button", {name: "Guardar incidencia", exact: true}).click();
  await expect(page.locator(".incident-card")).toContainText("Se recibió el comprobante");
  expect(state.incidents[0].occurred_on).toBe(past);
  await page.getByRole("button", {name: "Actualizar seguimiento"}).click();
  await page.locator(".incident-card").getByLabel(/^Estado/).selectOption("resuelta");
  await page.getByLabel("Acciones realizadas / resolución").fill("Documento revisado y vigencia actualizada.");
  await page.getByRole("button", {name: "Guardar seguimiento"}).click();
  await expect(page.locator(".incident-tag")).toHaveText("Resuelta");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("incidencias-mobile.png"), fullPage: true});
  expect(state.errors).toEqual([]);
});

test("usuario asignado puede capturar lecturas e incidencias, no editar administración", async ({page}) => {
  const state = await fixture(page, {user: true});
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Mis unidades asignadas"})).toBeVisible();
  await expect(page.getByRole("button", {name: "Agregar unidad", exact: true})).toHaveCount(0);
  await page.goto("/vehiculos/1");
  await expect(page.getByRole("button", {name: "Guardar lectura", exact: true})).toBeVisible();
  for (const name of ["Editar documentación", "Editar conductores", "Registrar periodo", "Registrar resolución"]) await expect(page.getByRole("button", {name, exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "Reportar incidencia", exact: true}).click();
  await page.getByLabel("¿Qué ocurrió?").fill("La unidad tiene un rayón en la puerta lateral.");
  await page.getByRole("button", {name: "Guardar incidencia", exact: true}).click();
  await expect(page.locator(".incident-card")).toContainText("rayón");
  await expect(page.getByRole("button", {name: "Actualizar seguimiento"})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("altas nuevas ofrecen las 32 entidades sin asumir un estado ni calcular fechas", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/");
  await page.getByRole("button", {name: "Agregar unidad", exact: true}).click();
  const registration = page.getByLabel("Estado de emplacamiento (opcional)");
  await expect(registration).toHaveValue("");
  await expect(registration.locator("option")).toHaveCount(33);
  await registration.selectOption("Querétaro");
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("");
  await expect(page.getByLabel("Vencimiento de tarjeta de circulación")).toHaveValue("");
  await page.getByLabel("Placas", {exact: true}).fill("NXR-482-B");
  await page.getByText("Ayuda de verificación para Querétaro", {exact: true}).click();
  await page.getByLabel("Periodo del calendario").selectOption("2026-2");
  await expect(page.getByRole("button", {name: "Usar periodo sugerido", exact: true})).toBeDisabled();
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("ayuda Querétaro requiere confirmación y guardado explícito sin rellenar estados antiguos", async ({page}) => {
  const state = await fixture(page);
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  const registration = page.getByLabel("Estado de emplacamiento (opcional)");
  await expect(registration).toHaveValue("");
  await expect(page.getByText("Ayuda de verificación para Querétaro", {exact: true})).toHaveCount(0);
  await registration.selectOption("Querétaro");
  await page.getByText("Ayuda de verificación para Querétaro", {exact: true}).click();
  const help = page.locator("details").filter({hasText: "Ayuda de verificación para Querétaro"});
  await expect(help).toContainText("00");
  await expect(help).toContainText(/exenci[oó]n/i);
  await expect(help).toContainText(/público/i);
  await page.getByLabel("Periodo del calendario").selectOption("2026-2");
  const apply = page.getByRole("button", {name: "Usar periodo sugerido", exact: true});
  await expect(apply).toBeDisabled();
  await page.getByLabel("Confirmo que aplica el calendario ordinario", {exact: true}).check();
  await expect(apply).toBeEnabled();
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("");
  await apply.click();
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("2026-10-01");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2026-11-30");
  await expect(page.getByLabel("Vencimiento de tarjeta de circulación")).toHaveValue("");
  expect(state.writes).toEqual([]);
  expect(state.vehicle.verification_period_end).toBeUndefined();
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect.poll(() => state.writes.filter(write => write.path === "vehicles/1/administration").length).toBe(1);
  expect(state.writes[0].body).toMatchObject({registration_state: "Querétaro", verification_period_start: "2026-10-01", verification_period_end: "2026-11-30", circulation_card_expires_on: null});
  expect(state.errors).toEqual([]);
});

test("fechas manuales se conservan al cambiar estado o semestre y solo se reemplazan expresamente", async ({page}, info) => {
  const state = await fixture(page);
  Object.assign(state.vehicle, {registration_state: "Querétaro", verification_period_start: "2026-01-12", verification_period_end: "2026-02-12", circulation_card_expires_on: "2027-02-01"});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  const registration = page.getByLabel("Estado de emplacamiento (opcional)");
  const start = page.getByLabel("Inicio del periodo de verificación");
  const end = page.getByLabel("Fin del periodo de verificación");
  await page.getByText("Ayuda de verificación para Querétaro", {exact: true}).click();
  await page.getByLabel("Periodo del calendario").selectOption("2026-1");
  await expect(start).toHaveValue("2026-01-12");
  await expect(end).toHaveValue("2026-02-12");
  await page.getByLabel("Periodo del calendario").selectOption("2026-2");
  const replace = page.getByRole("button", {name: "Reemplazar con periodo sugerido", exact: true});
  await expect(replace).toBeDisabled();
  await page.getByLabel("Confirmo que aplica el calendario ordinario", {exact: true}).check();
  await expect(start).toHaveValue("2026-01-12");
  await expect(end).toHaveValue("2026-02-12");
  await replace.click();
  await expect(start).toHaveValue("2026-10-01");
  await expect(end).toHaveValue("2026-11-30");
  await expect(page.getByLabel("Vencimiento de tarjeta de circulación")).toHaveValue("2027-02-01");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.screenshot({path: info.outputPath("queretaro-mobile.png"), fullPage: true});
  await registration.selectOption("Estado de México");
  await expect(page.getByText("Ayuda de verificación para Querétaro", {exact: true})).toHaveCount(0);
  await expect(start).toHaveValue("2026-10-01");
  await expect(end).toHaveValue("2026-11-30");
  await registration.selectOption("Querétaro");
  await expect(page.getByText("Ayuda de verificación para Querétaro", {exact: true})).toBeVisible();
  await expect(start).toHaveValue("2026-10-01");
  await expect(end).toHaveValue("2026-11-30");
  await registration.selectOption("");
  await expect(page.getByText("Ayuda de verificación para Querétaro", {exact: true})).toHaveCount(0);
  await expect(start).toHaveValue("2026-10-01");
  await expect(end).toHaveValue("2026-11-30");
  expect(state.vehicle.verification_period_end).toBe("2026-02-12");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("Jalisco usa periodo anual; cambiar entidad reinicia confirmación sin cambiar fechas", async ({page}, info) => {
  const state = await fixture(page);
  Object.assign(state.vehicle, {registration_state: "Querétaro", verification_period_start: "2026-10-01", verification_period_end: "2026-11-30", circulation_card_expires_on: "2027-02-01"});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  const registration = page.getByLabel("Estado de emplacamiento (opcional)");
  await page.getByText("Ayuda de verificación para Querétaro", {exact: true}).click();
  await page.getByLabel("Periodo del calendario").selectOption("2026-2");
  await page.getByLabel("Confirmo que aplica el calendario ordinario", {exact: true}).check();
  await registration.selectOption("Jalisco");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2026-11-30");
  await page.getByText("Ayuda de verificación para Jalisco", {exact: true}).click();
  await expect(page.locator(".verification-help")).toContainText("No es un calendario semestral");
  await expect(page.getByLabel("Confirmo que aplica el calendario ordinario", {exact: true})).not.toBeChecked();
  await expect(page.getByLabel("Periodo del calendario").locator("option")).toHaveCount(2);
  await page.getByLabel("Periodo del calendario").selectOption("2026-anual");
  await expect(page.getByRole("button", {name: "Reemplazar con periodo sugerido"})).toBeDisabled();
  await page.getByLabel("Confirmo que aplica el calendario ordinario", {exact: true}).check();
  await page.getByRole("button", {name: "Reemplazar con periodo sugerido"}).click();
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("2026-02-01");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2026-03-31");
  await expect(page.getByLabel("Vencimiento de tarjeta de circulación")).toHaveValue("2027-02-01");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await page.locator(".verification-help").screenshot({path: info.outputPath("multiestado-mobile.png")});
  expect(state.writes).toEqual([]);
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect.poll(() => state.vehicle.registration_state).toBe("Jalisco");
  expect(state.vehicle.verification_period_end).toBe("2026-03-31");
  expect(state.errors).toEqual([]);
});

test("entidades pendientes y periodos no revisados nunca muestran sugerencias prestadas", async ({page}) => {
  const state = await fixture(page);
  Object.assign(state.vehicle, {registration_state: "Sonora", verification_period_start: "2026-08-10", verification_period_end: "2026-09-10"});
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  await page.getByText("Ayuda de verificación para Sonora", {exact: true}).click();
  await expect(page.locator(".verification-help")).toContainText("Normativa pendiente de revisión");
  await expect(page.locator(".verification-help")).toContainText("no significa que esté exento");
  await expect(page.getByLabel("Periodo del calendario")).toHaveCount(0);
  await expect(page.getByRole("button", {name: /periodo sugerido/})).toHaveCount(0);
  await page.getByLabel("Estado de emplacamiento (opcional)").selectOption("Estado de México");
  await page.getByText("Ayuda de verificación para Estado de México", {exact: true}).click();
  await expect(page.locator(".verification-help")).toContainText("Segundo semestre de 2026 pendiente de revisión");
  await expect(page.getByLabel("Periodo del calendario").locator('option[value="2026-2"]')).toHaveCount(0);
  await expect(page.getByLabel("Inicio del periodo de verificación")).toHaveValue("2026-08-10");
  await expect(page.getByLabel("Fin del periodo de verificación")).toHaveValue("2026-09-10");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("un estado histórico fuera del catálogo se conserva al editar otro dato", async ({page}) => {
  const state = await fixture(page);
  state.vehicle.registration_state = "Estado registrado previamente";
  await page.goto("/vehiculos/1");
  await page.getByRole("button", {name: "Editar documentación"}).click();
  const registration = page.getByLabel("Estado de emplacamiento (opcional)");
  await expect(registration).toHaveValue("Estado registrado previamente");
  await expect(registration.locator("option")).toHaveCount(34);
  await page.getByLabel("Apodo de la unidad (opcional)").fill("Unidad de reparto");
  await page.getByRole("button", {name: "Guardar documentación"}).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body.registration_state).toBe("Estado registrado previamente");
  expect(state.errors).toEqual([]);
});
