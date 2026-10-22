import {expect, test, type Page} from "@playwright/test";
import type {CompanyUser} from "../lib/auth-context";
import type {Plan, VehicleDetail, VehicleSummary} from "../lib/types";

const admin: CompanyUser = {id: 801, name: "Administración ficticia", email: "admin.yoko@gmail.com", role: "admin", active: true, vehicle_ids: []};
const developer: CompanyUser = {...admin, id: 802, name: "Desarrollador ficticio", email: "martinmoralesbasurto1@gmail.com"};
const driver: CompanyUser = {id: 803, name: "Conductor ficticio", email: "conductor@example.invalid", role: "user", active: true, vehicle_ids: [901]};
const vehicle: VehicleSummary = {id: 901, vin: "1HGCM82633A004352", plate: "TST-901-A", nickname: "Entrega centro", make: "Toyota", model: "Corolla", model_year: 2024, variant_id: null, version: "Base", body_style: "Sedán", engine: "1.8", transmission: "AT", drive: "FWD", usage_regime: "normal", current_km: 9000, in_service_date: "2024-01-01", is_synthetic: true, traffic_light: "gray", next_visit_date: null, open_alerts: 0, usage_km_per_day: null, registration_state: "Querétaro"};
const otherVehicle: VehicleSummary = {...vehicle, id: 902, plate: "TST-902-B", nickname: "Reserva norte"};
const units = [vehicle, otherVehicle];
const plan: Plan = {vehicle_id: 901, generated_on: "2026-10-08", catalog_version: "synthetic", mode: "synthetic", usage: {km_per_day: 1, low_km_per_day: 0, high_km_per_day: 2, confidence: "baja", valid_intervals: 0, rejected_readings: 0, explanation: "Datos ficticios."}, services: [], visits: [], alerts: [], traffic_light: "gray", warnings: []};

async function mockWorkspace(page: Page, user: CompanyUser | null = admin) {
  const unexpected: string[] = [];
  const writes: string[] = [];
  const errors: string[] = [];
  const reads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      unexpected.push(`External request blocked: ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/backend/")) return route.continue();
    const path = url.pathname.slice("/api/backend/".length);
    const method = request.method();
    if (method !== "GET") writes.push(`${method} ${path}`);
    else reads.push(path);
    const send = (body: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
    if (method === "GET" && path === "auth/status") return send({configured: true, required: true});
    if (method === "GET" && path === "auth/me") return user ? send(user) : send({detail: "Inicia sesión."}, 401);
    if (method === "GET" && path === "vehicles") return send(user?.role === "admin" ? units : units.filter(unit => user?.vehicle_ids.includes(unit.id)));
    const detailPath = path.match(/^vehicles\/(901|902)$/);
    if (method === "GET" && detailPath) {
      const selected = units.find(unit => unit.id === Number(detailPath[1]))!;
      const detail: VehicleDetail = {vehicle: selected, readings: [], history: [], faults: [], downtime: []};
      return send(detail);
    }
    if (method === "GET" && /^vehicles\/(901|902)\/plan$/.test(path)) return send({...plan, vehicle_id: Number(path.split("/")[1])});
    if (method === "GET" && /^vehicles\/(901|902)\/(documents|administration-history)$/.test(path)) return send([]);
    unexpected.push(`${method} ${path}`);
    return send({detail: "API de prueba no definida."}, 404);
  });
  return {unexpected, writes, errors, reads};
}

function expectReadOnly(api: Awaited<ReturnType<typeof mockWorkspace>>) {
  expect(api.unexpected).toEqual([]);
  expect(api.writes).toEqual([]);
  expect(api.errors).toEqual([]);
}

async function expectNoSectionSearch(page: Page) {
  await expect(page.getByRole("button", {name: "Buscar apartados", exact: true})).toHaveCount(0);
  await expect(page.getByRole("dialog", {name: "Buscar apartados", exact: true})).toHaveCount(0);
  await expect(page.locator(".section-search, .section-search-dialog")).toHaveCount(0);
}

test.beforeEach(({baseURL}) => {
  if (baseURL !== "http://127.0.0.1:3015") throw new Error("Solo se permite el frontend temporal local con API simulada.");
});

test("sin lupa, los tres perfiles conservan su cuenta, menú autorizado y cabecera móvil", async ({page}) => {
  for (const user of [admin, developer, driver]) {
    await page.unrouteAll({behavior: "wait"});
    await page.setViewportSize({width: 1366, height: 768});
    const api = await mockWorkspace(page, user);
    const isAdmin = user.role === "admin";
    await page.goto("/");
    await expect(page.getByRole("heading", {name: isAdmin ? "Mi flotilla" : "Mis unidades", exact: true})).toBeVisible();
    const header = page.locator("header .account-topbar");
    await expect(header.getByRole("link", {name: user.name, exact: true})).toBeVisible();
    await expect(header.getByRole("button", {name: "Salir", exact: true})).toBeVisible();
    await expectNoSectionSearch(page);
    // The ordinary unit search is independent of the removed header search.
    if (isAdmin) await expect(page.getByRole("searchbox", {name: "Buscar por placa, terminación o apodo", exact: true})).toBeVisible();
    await page.getByRole("button", {name: /Operación/}).click();
    const navigation = page.getByRole("navigation", {name: "Navegación principal", exact: true});
    await expect(navigation.getByRole("link")).toHaveCount(isAdmin ? 9 : 5);
    await expect(navigation.getByRole("link", {name: "Usuarios", exact: true})).toHaveCount(isAdmin ? 1 : 0);
    await expect(navigation.getByRole("link", {name: "Dashboard", exact: true})).toHaveCount(isAdmin ? 1 : 0);
    await expect(navigation.getByRole("link", {name: "Normativa", exact: true})).toHaveCount(0);
    await navigation.getByRole("link", {name: "Mi cuenta", exact: true}).click();
    await expect(page).toHaveURL(/\/cuenta$/);
    await expect(page.getByRole("heading", {name: "Mi cuenta", exact: true})).toBeVisible();
    await expectNoSectionSearch(page);
    for (const width of [320, 390]) {
      await page.setViewportSize({width, height: 844});
      await expect(header.getByRole("link", {name: user.name, exact: true})).toBeVisible();
      await expect(header.getByRole("button", {name: "Salir", exact: true})).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (user.id === admin.id && width === 320) await page.screenshot({path: test.info().outputPath("no-search-header-mobile-320.png"), fullPage: true});
    }
    if (!isAdmin) {
      await page.goto("/usuarios");
      await expect(page.getByRole("heading", {name: "Tu espacio de conductor", exact: true})).toBeVisible();
      await expect(page.getByRole("button", {name: "Agregar usuario", exact: true})).toHaveCount(0);
    }
    expectReadOnly(api);
  }
});

test("documentación y fotos siguen disponibles para administrador y conductor sin lupa", async ({page}) => {
  for (const user of [admin, driver]) {
    await page.unrouteAll({behavior: "wait"});
    const api = await mockWorkspace(page, user);
    await page.goto("/vehiculos/901");
    await expect(page.getByRole("heading", {name: "Documentación y vencimientos", exact: true})).toBeVisible();
    await expect(page.getByLabel("Fotos del documento (máximo 3 por carga)")).toBeVisible();
    await expect(page.getByRole("button", {name: "Guardar fotos", exact: true})).toBeVisible();
    await expect(page.getByRole("button", {name: "Guardar documentación", exact: true})).toHaveCount(user.role === "admin" ? 1 : 0);
    await expectNoSectionSearch(page);
    if (user.role === "user") {
      await expect(page.getByRole("heading", {name: "Pronósticos de mantenimiento", exact: true})).toHaveCount(0);
      expect(api.reads.some(path => path.endsWith("/plan"))).toBe(false);
    }
    expectReadOnly(api);
  }
});

test("login y acceso sin sesión conservan contactos y no muestran Operación ni lupa", async ({page}) => {
  const api = await mockWorkspace(page, null);
  await page.goto("/acceso");
  await expect(page.getByRole("heading", {name: "Bienvenido a Yokohama", exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "martinmoralesbasurto1@gmail.com", exact: true})).toHaveAttribute("href", "mailto:martinmoralesbasurto1@gmail.com");
  await expect(page.getByRole("link", {name: "ruben.cicata@gmail.com", exact: true})).toHaveAttribute("href", "mailto:ruben.cicata@gmail.com");
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
  await expectNoSectionSearch(page);
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Entra a tu cuenta", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
  await expectNoSectionSearch(page);
  expectReadOnly(api);
});
