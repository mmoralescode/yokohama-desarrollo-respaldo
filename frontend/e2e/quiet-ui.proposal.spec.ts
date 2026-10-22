import {expect, test, type Page, type APIRequestContext} from "@playwright/test";
import {localDate} from "../lib/dates";

const storageKey = "yokohama-propuesta-administrativa-v1";
const dayLabel = (day: string) => new Intl.DateTimeFormat("es-MX", {timeZone: "UTC", day: "2-digit", month: "short", year: "numeric"}).format(new Date(`${day}T12:00:00Z`));

async function seedCalendar(page: Page, request: APIRequestContext) {
  const response = await request.get("/proposal/fleet.json");
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  expect(snapshot.vehicles.every((vehicle: {is_synthetic: boolean}) => vehicle.is_synthetic)).toBeTruthy();
  const [unit, completedUnit] = snapshot.vehicles;
  const service = snapshot.catalog.servicios[0].id;
  const workspace = {...snapshot, revision: 1, calendar: [], evidence: [], incidents: [], administration_changes: [],
    appointments: [{id: "quiet-ui-date-change", vehicle_id: unit.id, service_ids: [service], scheduled_date: "2026-10-19", original_date: "2026-10-12", captured_at: "2026-10-04T16:00:00Z", notes: "Trabajo de prueba pendiente.",
      changes: [{previous_date: "2026-10-12", scheduled_date: "2026-10-19", changed_at: "2026-10-04T16:00:00Z", notes: "Reprogramación ficticia de prueba."}]}],
    completed: [{id: "quiet-ui-completed", vehicle_id: completedUnit.id, plate: completedUnit.plate, planned_date: "2026-10-07", performed_on: "2026-10-07", captured_at: "2026-10-09T16:00:00Z", service_ids: [service], service_names: ["Servicio ficticio terminado"], fault_ids: [], status: "completed", provisional: false, total_duration_hours: null, explanation: "Captura administrativa de prueba.", notes: "Comprobante ficticio recibido posteriormente."}],
  };
  await page.addInitScript(({key, state}) => localStorage.setItem(key, JSON.stringify(state)), {key: storageKey, state: workspace});
  return {unit, completedUnit};
}

test("calendario sobrio conserva fechas únicas e historial desplegable", async ({page, request}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  const {unit, completedUnit} = await seedCalendar(page, request);
  await page.goto("/calendario?mes=2026-10");
  await expect(page.getByRole("heading", {name: "Calendario", exact: true})).toBeVisible();
  await expect(page.locator(".calendar-summary")).toHaveCount(0);
  await expect(page.getByText("Captura a tu ritmo", {exact: true})).toHaveCount(0);
  await expect(page.locator(".page-description,.page-heading .eyebrow")).toHaveCount(0);

  const scheduled = page.locator(".agenda-entry").filter({has: page.getByRole("link", {name: unit.plate, exact: true})});
  await expect(scheduled).toBeVisible();
  await expect(page.locator("#dia-2026-10-19").getByRole("heading", {name: dayLabel("2026-10-19"), exact: true})).toHaveCount(1);
  expect(await scheduled.innerText()).not.toContain(dayLabel("2026-10-19"));
  expect(await scheduled.innerText()).not.toContain(dayLabel("2026-10-12"));
  await expect(scheduled.getByText(/Reprogramación ficticia de prueba/)).not.toBeVisible();
  await scheduled.locator(".calendar-date-history summary").click();
  await expect(scheduled.locator(".calendar-date-history")).toContainText(`${dayLabel("2026-10-12")} → ${dayLabel("2026-10-19")}`);
  await expect(scheduled.getByText(/Reprogramación ficticia de prueba/)).toBeVisible();

  const completed = page.locator(".agenda-completed").filter({has: page.getByRole("link", {name: completedUnit.plate, exact: true})});
  await expect(completed).toBeVisible();
  expect(await completed.innerText()).not.toContain(dayLabel("2026-10-07"));
  await expect(completed.getByText(/Capturado:/)).not.toBeVisible();
  await completed.locator(".service-details summary").click();
  await expect(completed.getByText("Comprobante ficticio recibido posteriormente.", {exact: true})).toBeVisible();
  await expect(completed.getByText(/Capturado:/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: info.outputPath("calendario-sobrio-mobile.png"), fullPage: true});
});

test("alertas no muestra bandeja simulada y mantiene las advertencias críticas visibles", async ({page, request}, info) => {
  const response = await request.get("/proposal/fleet.json");
  const snapshot = await response.json();
  for (const plan of Object.values(snapshot.plans) as {alerts: unknown[]}[]) plan.alerts = [];
  const vehicleId = snapshot.vehicles[0].id;
  snapshot.plans[String(vehicleId)].alerts = [{key: "quiet-critical", vehicle_id: vehicleId, plate: snapshot.vehicles[0].plate, service_id: null, fault_id: 1, severity: "critico", message: "Reporte crítico ficticio para revisión.", deadline: "2026-10-19", days_remaining: null, threshold_days: 0, status: "open", kind: "fault"}];
  await page.addInitScript(({key, state}) => localStorage.setItem(key, JSON.stringify({...state, revision: 1, appointments: [], completed: [], evidence: [], incidents: [], administration_changes: []})), {key: storageKey, state: snapshot});
  const notificationRequests: string[] = [];
  page.on("request", request => {if (/\/notifications(?:[/?]|$)/.test(request.url())) notificationRequests.push(request.url());});
  await page.goto("/alertas");
  await expect(page.getByRole("heading", {name: "Alertas", exact: true})).toBeVisible();
  await expect(page.getByText("Reporte crítico ficticio para revisión.", {exact: true})).toBeVisible();
  await expect(page.getByText("Detén la operación y coordina asistencia segura.", {exact: true})).toBeVisible();
  await expect(page.getByText(/Bandeja de salida simulada|Simulado · no enviado|CANALES DE NOTIFICACIÓN/)).toHaveCount(0);
  await expect(page.locator(".page-description,.page-heading .eyebrow")).toHaveCount(0);
  expect(notificationRequests).toEqual([]);
  await page.screenshot({path: info.outputPath("alertas-sobrias.png"), fullPage: true});
});

test("cuenta de propuesta muestra un perfil veraz sin simular contraseña ni asignaciones", async ({page}, info) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/cuenta");
  await expect(page.getByRole("heading", {name: "Mi cuenta", exact: true})).toBeVisible();
  await expect(page.locator(".account-profile-fields")).toContainText("Administrador de propuesta");
  await expect(page.locator(".account-profile-fields")).toContainText("admin.yoko@gmail.com");
  await expect(page.getByRole("heading", {name: "Unidades asignadas", exact: true})).toBeVisible();
  await expect(page.getByText("No aplica en propuesta", {exact: true})).toBeVisible();
  await expect(page.locator(".account-assigned-units a")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Cambiar contraseña", exact: true})).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("heading", {name: "Usuarios", exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "Administrar usuarios", exact: true})).toHaveAttribute("href", "/usuarios");
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: info.outputPath("cuenta-propuesta-mobile.png"), fullPage: true});
});

test("usuarios en propuesta explica el acceso pendiente sin simular altas ni guardar contraseñas", async ({page}) => {
  const accountRequests: string[] = [];
  page.on("request", request => {if (/\/api\/backend\/(users|auth)(?:[/?]|$)/.test(request.url())) accountRequests.push(request.url());});
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/cuenta");
  await page.getByRole("link", {name: "Administrar usuarios", exact: true}).click();
  await expect(page).toHaveURL(/\/usuarios$/);
  await expect(page.getByRole("heading", {name: "Usuarios", exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Agregar usuario", exact: true})).toBeVisible();
  await expect(page.getByText("El alta de cuentas requiere conectar el servidor privado de la empresa.", {exact: true})).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Crear usuario", exact: true})).toHaveCount(0);
  await page.goto("/acceso");
  await expect(page.getByRole("heading", {name: "Iniciar sesión", exact: true})).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(accountRequests).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("menú desplegable tiene Dashboard y omite Normativa y Resumen", async ({page}) => {
  await page.goto("/cuenta");
  await expect(page.getByRole("navigation", {name: "Navegación principal"})).toHaveCount(0);
  const toggle = page.getByRole("button", {name: /YOKOHAMA.*Operación/});
  await toggle.click();
  const navigation = page.getByRole("navigation", {name: "Navegación principal"});
  await expect(navigation.getByRole("link", {name: "Dashboard", exact: true})).toBeVisible();
  await expect(navigation.getByRole("link", {name: "Calendario", exact: true})).toBeVisible();
  await expect(navigation.getByRole("link", {name: "Usuarios", exact: true})).toBeVisible();
  await expect(navigation.getByRole("link", {name: "Conductores", exact: true})).toHaveCount(0);
  await expect(navigation.getByRole("link", {name: "Normativa", exact: true})).toHaveCount(0);
  await expect(navigation.getByRole("link", {name: "Resumen", exact: true})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(navigation).toHaveCount(0);
  await expect(toggle).toBeFocused();
});

test("servicio conserva su foto inicial y permite adjuntar factura después sin duplicarlo", async ({page}, info) => {
  const name = "Trabajo ficticio con factura de prueba";
  const performed = localDate();
  const photo = Buffer.from(await page.evaluate(() => {const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 100; const context = canvas.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, 160, 100); context.fillStyle = "#111"; context.fillText("FACTURA FICTICIA", 12, 50); return canvas.toDataURL("image/png").split(",")[1];}), "base64");
  await page.goto(`/calendario?mes=${performed.slice(0, 7)}&registro=1&unidad=1`);
  await expect(page.getByLabel("Unidad del servicio")).toHaveValue("1");
  await page.getByLabel("Fecha real del servicio").fill(performed);
  await page.locator('input[name="manual_description"]').fill(name);
  await page.getByLabel("Fotos del trabajo, factura o comprobante (máximo 3)").setInputFiles({name: "trabajo-inicial.png", mimeType: "image/png", buffer: photo});
  await expect(page.getByAltText(/^Vista previa: trabajo-inicial\.(?:jpg|png)$/)).toBeVisible();
  await page.getByRole("button", {name: "Guardar servicio realizado", exact: true}).click();
  await expect(page.getByText("Guardado", {exact: true})).toBeVisible();
  const entry = page.locator(".agenda-completed").filter({hasText: name});
  await expect(entry).toHaveCount(1);
  await entry.locator(".service-details>summary").click();
  await entry.getByRole("button", {name: "Fotos / factura", exact: true}).click();
  const record = entry.locator(".calendar-service-record").filter({has: page.getByRole("heading", {name, exact: true})});
  await expect(record.getByRole("button", {name: "Ver foto 1", exact: true})).toBeVisible();
  const before = await page.evaluate(({key, name}) => {const state = JSON.parse(localStorage.getItem(key)!); const record = state.details["1"].history.find((row: {service_name?: string}) => row.service_name === name); return {id: record.id, historyCount: state.details["1"].history.length, photos: state.evidence.filter((photo: {service_id?: number}) => photo.service_id === record.id).length};}, {key: storageKey, name});
  expect(before.photos).toBe(1);
  await record.getByRole("button", {name: "Agregar fotos", exact: true}).click();
  await record.getByLabel("Fotos de evidencia (máximo 3 por carga)").setInputFiles({name: "factura-tardia.png", mimeType: "image/png", buffer: photo});
  await expect(record.getByAltText(/^Vista previa: factura-tardia\.(?:jpg|png)$/)).toBeVisible();
  await record.getByRole("button", {name: "Guardar fotos", exact: true}).click();
  await expect(record.getByRole("button", {name: "Ver foto 2", exact: true})).toBeVisible();
  await record.getByRole("button", {name: "Ver foto 2", exact: true}).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.getByRole("button", {name: "Cerrar foto", exact: true}).click();
  await page.goto(`/calendario?mes=${performed.slice(0, 7)}`);
  await entry.locator(".service-details>summary").click();
  await entry.getByRole("button", {name: "Fotos / factura", exact: true}).click();
  await expect(record.getByRole("button", {name: "Ver foto 2", exact: true})).toBeVisible();
  const after = await page.evaluate(({key, name}) => {const state = JSON.parse(localStorage.getItem(key)!); const rows = state.details["1"].history.filter((row: {service_name?: string}) => row.service_name === name); return {id: rows[0].id, count: rows.length, historyCount: state.details["1"].history.length, photos: state.evidence.filter((photo: {service_id?: number}) => photo.service_id === rows[0].id).length};}, {key: storageKey, name});
  expect(after).toEqual({id: before.id, count: 1, historyCount: before.historyCount, photos: 2});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: info.outputPath("servicio-factura-tardia-mobile.png"), fullPage: true});
  await page.goto("/vehiculos/1");
  await expect(page.getByRole("heading", {name: "Servicios realizados", exact: true})).toHaveCount(0);
  await expect(page.locator(".calendar-service-record")).toHaveCount(0);
});
