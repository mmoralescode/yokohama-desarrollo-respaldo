import {expect, test, type Page} from "@playwright/test";
import type {CompanyUser} from "../lib/auth-context";
import type {Evidence, Plan, VehicleDetail, VehicleSummary, Visit} from "../lib/types";

const admin: CompanyUser = {id: 801, name: "Administración de prueba", email: "admin.yoko@gmail.com", role: "admin", active: true, vehicle_ids: []};
const driver: CompanyUser = {id: 803, name: "Ana López", email: "ana@example.invalid", role: "user", active: true, vehicle_ids: [901]};
const colleagues: CompanyUser[] = [driver, {id: 804, name: "Daniel Torres", email: "daniel@example.invalid", role: "user", active: true, vehicle_ids: [902, 903]}, {id: 805, name: "Sofía Méndez", email: "sofia@example.invalid", role: "user", active: true, vehicle_ids: [904]}];
const plates = ["ULB-201-A", "NTV-406-B", "SRA-817-C", "YHL-392-D", "UPM-521-E", "NBD-604-F", "SLR-735-G", "YPT-816-H", "ULR-952-J", "NTC-173-K"];
const names = ["Reparto centro", "Operación norte", "Atención a clientes", "Supervisión", "Ruta sur", "Logística", "Servicios", "Administración", "Ruta regional", "Apoyo operativo"];
const units: VehicleSummary[] = plates.map((plate, index) => ({
  id: 901 + index, vin: `1HGCM82633A00${4352 + index}`, plate, nickname: names[index],
  make: ["Toyota", "Mazda", "Nissan"][index % 3], model: ["Corolla", "Mazda3", "Versa"][index % 3],
  model_year: 2024 - index % 3, variant_id: null, version: "Automático", body_style: "Sedán", engine: "2.0 L", transmission: "AT", drive: "FWD",
  usage_regime: "normal", current_km: 16400 + index * 6721, in_service_date: "2024-01-12", is_synthetic: true,
  traffic_light: (["green", "amber", "red", "gray"] as const)[index % 4], next_visit_date: "2026-10-28", open_alerts: index % 3,
  usage_km_per_day: 42 + index * 3, registration_state: index % 2 ? "Querétaro" : "Ciudad de México",
  verification_period_start: "2026-07-01", verification_period_end: "2026-12-31", circulation_card_expires_on: "2027-03-14",
  plates_expires_on: "2027-12-31", vehicle_tax_due_on: "2026-12-31", vehicle_tax_paid_on: "2026-03-20",
  drivers: colleagues.filter(person => person.vehicle_ids.includes(901 + index)).map(person => person.name),
}));
const plan: Plan = {vehicle_id: 901, generated_on: "2026-10-21", catalog_version: "synthetic", mode: "synthetic",
  usage: {km_per_day: 42, low_km_per_day: 20, high_km_per_day: 60, confidence: "baja", valid_intervals: 0, rejected_readings: 0, explanation: "Datos sintéticos de prueba."},
  services: [], visits: [], alerts: [], traffic_light: "green", warnings: []};
const documentPhoto: Evidence = {id: "synthetic-document", vehicle_id: 901, filename: "verificacion-ficticia.png", mime_type: "image/png", captured_at: "2026-10-19T10:30:00Z", document_type: "verification", notes: "Comprobante de prueba; no contiene información real.", data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="};
const visits: Visit[] = [
  {id: "qa-visit-1", vehicle_id: 901, plate: plates[0], version: "Toyota Corolla 2024", planned_date: "2026-10-23", service_ids: ["oil"], service_names: ["Cambio de aceite y filtro"], status: "scheduled", total_duration_hours: 1.5, explanation: "Datos ficticios.", provisional: false, appointment_id: "qa-appointment"},
  {id: "qa-visit-2", vehicle_id: 902, plate: plates[1], version: "Mazda Mazda3 2023", planned_date: "2026-10-28", service_ids: ["brakes", "tires"], service_names: ["Inspección de frenos", "Rotación de llantas"], status: "proposed", total_duration_hours: 2, explanation: "Datos ficticios.", provisional: true},
  {id: "qa-visit-3", vehicle_id: 903, plate: plates[2], version: "Nissan Versa 2022", planned_date: "2026-10-16", performed_on: "2026-10-16", service_ids: ["oil"], service_names: ["Cambio de aceite y filtro"], status: "completed", total_duration_hours: 1.5, explanation: "Datos ficticios.", provisional: false},
];

async function mockWorkspace(page: Page, user: CompanyUser | null = admin) {
  const unexpected: string[] = [], writes: string[] = [], errors: string[] = [], reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      unexpected.push(`External request blocked: ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/backend/")) return route.continue();
    const path = url.pathname.slice("/api/backend/".length), method = request.method();
    const send = (body: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
    if (method !== "GET") {writes.push(`${method} ${path}`); return send({detail: "Las pruebas visuales no permiten escrituras."}, 405);}
    reads.push(path);
    if (path === "auth/status") return send({configured: true, required: true});
    if (path === "auth/me") return user ? send(user) : send({detail: "Inicia sesión."}, 401);
    if (path === "vehicles") return send(user?.role === "admin" ? units : units.filter(unit => user?.vehicle_ids.includes(unit.id)));
    if (path === "users") return send([admin, ...colleagues]);
    if (path === "variants") return send({variantes: []});
    if (path === "catalog") return send({servicios: [{id: "oil", servicio: "Cambio de aceite y filtro"}, {id: "brakes", servicio: "Inspección de frenos"}, {id: "tires", servicio: "Rotación de llantas"}]});
    if (path === "fleet-statistics") return send(units.map((unit, index) => ({id: unit.id, plate: unit.plate, nickname: unit.nickname, current_km: unit.current_km, drivers: unit.drivers, total_faults: index % 5, open_faults: index % 3 === 0 ? 1 : 0, critical_faults: index === 3 ? 1 : 0})).map(unit => ({...unit, total_faults: Math.max(unit.total_faults, unit.open_faults)})));
    if (path === "calendar") return send(visits);
    const detailPath = path.match(/^vehicles\/(90[1-9]|910)$/);
    if (detailPath) {
      const selected = units.find(unit => unit.id === Number(detailPath[1]))!;
      const detail: VehicleDetail = {vehicle: selected, readings: [], history: [], faults: [], downtime: []};
      return send(detail);
    }
    if (/^vehicles\/(90[1-9]|910)\/plan$/.test(path)) return send({...plan, vehicle_id: Number(path.split("/")[1])});
    if (/^vehicles\/(90[1-9]|910)\/documents$/.test(path)) return send(Number(path.split("/")[1]) === 901 ? [documentPhoto] : []);
    if (/^vehicles\/(90[1-9]|910)\/administration-history$/.test(path)) return send([]);
    if (/^evidence\/synthetic-document$/.test(path)) return send(documentPhoto);
    unexpected.push(`${method} ${path}`);
    return send({detail: "API de prueba no definida."}, 404);
  });
  return {unexpected, writes, errors, reads};
}

function expectReadOnly(api: Awaited<ReturnType<typeof mockWorkspace>>) {
  expect(api.unexpected).toEqual([]); expect(api.writes).toEqual([]); expect(api.errors).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function expectProfessionalContrast(page: Page) {
  await expect(page.locator(".fleet-panel .cell-sub").first()).toBeVisible();
  const samples = await page.evaluate(() => {
    function luminance(color: string) {
      const channels = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(value => {
        const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }
    function ratio(foreground: string, background: string) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + .05) / (values[1] + .05);
    }
    const panel = getComputedStyle(document.querySelector(".fleet-panel")!).backgroundColor;
    const primary = getComputedStyle(document.querySelector(".heading-actions .button.primary")!);
    const header = getComputedStyle(document.querySelector(".simple-topbar")!);
    return {
      heading: ratio(getComputedStyle(document.querySelector(".fleet-panel h2")!).color, panel),
      muted: ratio(getComputedStyle(document.querySelector(".cell-sub")!).color, panel),
      action: ratio(primary.color, primary.backgroundColor),
      brand: ratio(getComputedStyle(document.querySelector("header .brand")!).color, header.backgroundColor),
    };
  });
  for (const [name, ratio] of Object.entries(samples)) expect(ratio, `${name} contrast`).toBeGreaterThanOrEqual(4.5);
}
async function screenshot(page: Page, name: string, fullPage = true) {
  await page.evaluate(() => {window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur();});
  await page.screenshot({path: test.info().outputPath(`${name}.png`), fullPage, animations: "disabled"});
}
async function navigateSection(page: Page, label: string) {
  await page.getByRole("button", {name: /Operación/}).click();
  await page.getByRole("navigation", {name: "Navegación principal", exact: true}).getByRole("link", {name: label, exact: true}).click();
  await expect(page.locator("header.simple-topbar")).toHaveCSS("background-color", "rgb(29, 44, 56)");
}

test.beforeEach(({baseURL}) => {
  if (baseURL !== "http://127.0.0.1:3016") throw new Error("Solo frontend temporal con API sintética.");
});

test("acceso elegante conserva contactos, campos y foco; adaptable a 320 y 390 px", async ({page}) => {
  const api = await mockWorkspace(page, null);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto("/acceso");
  await expect(page.getByRole("heading", {name: "Bienvenido a Yokohama", exact: true})).toBeVisible();
  await expect(page.locator(".professional-shell")).toHaveCount(1);
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Buscar apartados", exact: true})).toHaveCount(0);
  for (const email of ["martinmoralesbasurto1@gmail.com", "ruben.cicata@gmail.com"]) await expect(page.getByRole("link", {name: email, exact: true})).toHaveAttribute("href", `mailto:${email}`);
  const email = page.getByLabel("Correo electrónico", {exact: true});
  await email.focus();
  await expect(email).toBeFocused();
  expect(await email.evaluate(element => {const style = getComputedStyle(element); return style.outlineStyle !== "none" || style.boxShadow !== "none";})).toBe(true);
  await expect(page.getByLabel("Contraseña", {exact: true})).toHaveAttribute("type", "password");
  await screenshot(page, "login-desktop");
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height: 844}); await noOverflow(page);
    await expect(page.getByRole("button", {name: "Iniciar sesión", exact: true})).toBeVisible();
    await screenshot(page, `login-mobile-${width}`);
  }
  expectReadOnly(api);
});

test("flotilla y registro conservan controles con menú sobrio sin lupa y vista móvil", async ({page}) => {
  const api = await mockWorkspace(page);
  await page.setViewportSize({width: 1440, height: 900}); await page.goto("/");
  await expect(page.getByRole("heading", {name: "Mi flotilla", exact: true})).toBeVisible();
  await expect(page.locator("tbody > tr")).toHaveCount(8);
  await expect(page.getByRole("button", {name: "Agregar unidad", exact: true})).toBeVisible();
  await expectProfessionalContrast(page);
  for (const field of await page.locator(".search-field").all()) {
    const offset = await field.evaluate(element => {
      const icon = element.querySelector("svg")!.getBoundingClientRect(), input = element.querySelector("input")!.getBoundingClientRect();
      return Math.abs(icon.y + icon.height / 2 - input.y - input.height / 2);
    });
    expect(offset, "Unit-search icon is vertically centered").toBeLessThanOrEqual(1);
  }
  await screenshot(page, "fleet-desktop");
  await page.getByRole("button", {name: /Operación/}).click();
  const navigation = page.getByRole("navigation", {name: "Navegación principal", exact: true});
  await expect(navigation.getByRole("link")).toHaveCount(9);
  await expect(navigation.getByRole("link", {name: "Dashboard", exact: true})).toBeVisible();
  const dashboardLink = navigation.getByRole("link", {name: "Dashboard", exact: true});
  await dashboardLink.focus();
  await expect(dashboardLink).toBeFocused();
  const focusContrast = await dashboardLink.evaluate(element => {
    function luminance(color: string) {
      const channels = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map(value => {
        const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    }
    const style = getComputedStyle(element);
    const background = getComputedStyle(element.closest(".operation-dropdown")!).backgroundColor;
    const values = [luminance(style.outlineColor), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  expect(focusContrast, "Keyboard focus on white navigation dropdown").toBeGreaterThanOrEqual(3);
  await screenshot(page, "navigation-desktop", false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", {name: /Operación/})).toBeFocused();
  await page.getByRole("button", {name: "Agregar unidad", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Registrar unidad", exact: true})).toBeVisible();
  await expect(page.getByLabel("Kilometraje actual (km)", {exact: true})).toHaveAttribute("type", "text");
  await screenshot(page, "vehicle-registration-desktop", false);
  await page.getByRole("button", {name: "Cerrar registro", exact: true}).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height: 844}); await noOverflow(page);
    await expect(page.locator("header .account-name")).toBeVisible();
    await expect(page.getByRole("button", {name: "Salir", exact: true})).toBeVisible();
    await screenshot(page, `fleet-mobile-${width}`);
  }
  expectReadOnly(api);
});

test("dashboard mantiene estadísticas, conductores, gráficas y filtros en escritorio y móvil", async ({page}) => {
  const api = await mockWorkspace(page);
  await page.setViewportSize({width: 1440, height: 900}); await page.goto("/dashboard");
  await expect(page.getByRole("heading", {name: "Dashboard", exact: true})).toBeVisible();
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("10");
  await expect(page.getByTestId("dashboard-kilometers-chart").locator(".unit-chart-list > li")).toHaveCount(8);
  await expect(page.getByTestId("dashboard-faults-chart").locator(".unit-chart-list > li")).toHaveCount(8);
  await screenshot(page, "dashboard-desktop");
  await page.getByLabel("Buscar unidad por placa o apodo").fill(plates[0]);
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("1");
  await expect(page.getByTestId("dashboard-kilometers-unit-901").locator(".unit-chart-drivers")).toContainText(driver.name);
  await page.getByLabel("Buscar unidad por placa o apodo").fill("");
  for (const width of [320, 390]) {
    await page.setViewportSize({width, height: 844}); await noOverflow(page);
    await screenshot(page, `dashboard-mobile-${width}`);
  }
  // Client-side navigation keeps page styles loaded; the shared skin must remain consistent.
  await navigateSection(page, "Mi flotilla");
  await expect(page.getByRole("heading", {name: "Mi flotilla", exact: true})).toBeVisible();
  await expectProfessionalContrast(page);
  expectReadOnly(api);
});

test("documentación inmediata, fotos, equipo y calendario mantienen formularios y fechas", async ({page}) => {
  const api = await mockWorkspace(page);
  await page.setViewportSize({width: 1440, height: 900}); await page.goto("/vehiculos/901");
  await expect(page.getByRole("heading", {name: "Documentación y vencimientos", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Guardar documentación", exact: true})).toBeVisible();
  await expect(page.getByLabel("Fotos del documento (máximo 3 por carga)")).toBeVisible();
  await expect(page.getByRole("button", {name: "Ver documento", exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Ver documento", exact: true}).click();
  await expect(page.getByRole("dialog", {name: "Fotografía adjunta", exact: true}).getByRole("img", {name: "Evidencia: verificacion-ficticia.png", exact: true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", {name: "Fotografía adjunta", exact: true})).toHaveCount(0);
  await screenshot(page, "vehicle-documentation-desktop");
  await page.setViewportSize({width: 320, height: 844}); await noOverflow(page);
  await screenshot(page, "vehicle-documentation-mobile-320");
  await page.setViewportSize({width: 1440, height: 900}); await navigateSection(page, "Usuarios");
  await expect(page.getByRole("heading", {name: "Equipo registrado", exact: true})).toBeVisible();
  await expect(page.locator(".account-row")).toHaveCount(3);
  await screenshot(page, "users-desktop");
  await navigateSection(page, "Calendario");
  await page.getByLabel("Mes de visitas", {exact: true}).fill("2026-10");
  await expect(page.getByRole("heading", {name: "Calendario", exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "octubre de 2026", exact: true})).toBeVisible();
  await expect(page.getByLabel("Mes de visitas", {exact: true})).toHaveCSS("width", "190px");
  await expect(page.locator(".agenda-entry")).toHaveCount(3);
  await screenshot(page, "calendar-desktop");
  await page.getByRole("button", {name: "Registrar servicio realizado", exact: true}).click();
  await expect(page.locator("#calendar-entry-form")).toBeVisible();
  await screenshot(page, "calendar-entry-desktop", false);
  await page.setViewportSize({width: 320, height: 844}); await noOverflow(page);
  await expect(page.getByLabel("Mes de visitas", {exact: true})).toHaveCSS("width", "170px");
  expectReadOnly(api);
});

test("conductor ve solo su unidad y evidencia; no recibe estadísticas administrativas", async ({page}) => {
  const api = await mockWorkspace(page, driver);
  await page.setViewportSize({width: 390, height: 844}); await page.goto("/");
  await expect(page.getByRole("heading", {name: "Mis unidades", exact: true})).toBeVisible();
  await expect(page.locator("tbody > tr")).toHaveCount(1);
  await expect(page.getByRole("link", {name: plates[1], exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: /Operación/}).click();
  const navigation = page.getByRole("navigation", {name: "Navegación principal", exact: true});
  await expect(navigation.getByRole("link")).toHaveCount(5);
  for (const name of ["Dashboard", "Usuarios", "Calendario", "Alertas"]) await expect(navigation.getByRole("link", {name, exact: true})).toHaveCount(0);
  await page.keyboard.press("Escape"); await noOverflow(page);
  await screenshot(page, "driver-fleet-mobile-390");
  await page.getByRole("link", {name: plates[0], exact: true}).click();
  await expect(page.getByRole("heading", {name: "Documentación y vencimientos", exact: true})).toBeVisible();
  await expect(page.getByLabel("Fotos del documento (máximo 3 por carga)")).toBeVisible();
  await expect(page.getByRole("button", {name: "Guardar documentación", exact: true})).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Ver documento", exact: true})).toBeVisible();
  await screenshot(page, "driver-documentation-mobile-390");
  for (const width of [320, 390]) {await page.setViewportSize({width, height: 844}); await noOverflow(page);}
  expect(api.reads.some(path => path === "fleet-statistics" || path === "users" || path.endsWith("/plan"))).toBe(false);
  expectReadOnly(api);
});
