import {expect, test, type Page} from "@playwright/test";
import type {CompanyUser} from "../lib/auth-context";
import type {VehicleSummary} from "../lib/types";

// All API calls are fulfilled here. Never create QA units in a live database.
const baseURL = process.env.YOKOHAMA_REGISTRATION_TEST_URL || "http://127.0.0.1:3013";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)) throw new Error("Esta prueba requiere un frontend local con API simulada.");
test.use({baseURL, serviceWorkers: "block"});

const exampleVehicle: VehicleSummary = {
  id: 901, vin: "JTDBR32E112345678", plate: "TST-901-A", make: "Toyota", model: "Corolla", model_year: 2024,
  variant_id: null, version: "XLE", body_style: "Sedán", engine: "2.0 L", transmission: "Automática", drive: "FWD",
  current_km: 15000, in_service_date: "2026-09-01", usage_regime: "normal", is_synthetic: true, severity_multiplier: 1,
  drivers: [], traffic_light: "gray", next_visit_date: null, open_alerts: 0, usage_km_per_day: null,
};
const admin: CompanyUser = {id: 900, name: "Administración ficticia", email: "admin.yoko@gmail.com", role: "admin", active: true, vehicle_ids: []};

async function mockedWorkspace(page: Page, user: CompanyUser = admin) {
  const posts: Record<string, unknown>[] = [];
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice("/api/backend/".length);
    if (request.method() === "POST" && path === "vehicles") {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push(body);
      return route.fulfill({json: {...exampleVehicle, ...body}});
    }
    if (request.method() !== "GET") return route.fulfill({status: 404, json: {detail: "Ruta de prueba no definida."}});
    if (path === "auth/status") return route.fulfill({json: {configured: true, required: true}});
    if (path === "auth/me") return route.fulfill({json: user});
    if (path === "vehicles") return route.fulfill({json: [exampleVehicle, ...posts.map((body, index) => ({...exampleVehicle, ...body, id: 902 + index}))]});
    if (path === "variants") return route.fulfill({json: {variantes: [{id: "mazda-fixture-2024", anio_modelo: 2024, carroceria: "Sedán", version: "i Touring", motor: "2.0 L", transmisiones: ["Automática"], traccion: "FWD"}]}});
    return route.fulfill({status: 404, json: {detail: "Ruta de prueba no definida."}});
  });
  return posts;
}

test("alta de flotilla tiene una fecha de verificación y mantiene defaults sin opciones técnicas", async ({page}) => {
  const posts = await mockedWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", {name: "Agregar unidad", exact: true}).click();
  const form = page.locator(".add-vehicle form");
  await expect(form.getByLabel("Periodo de verificación (fecha límite)", {exact: true})).toHaveCount(1);
  await expect(form.getByLabel("Inicio del periodo de verificación", {exact: true})).toHaveCount(0);
  await expect(form.getByLabel("Fin del periodo de verificación", {exact: true})).toHaveCount(0);
  await expect(form.getByText("Configuración avanzada", {exact: true})).toHaveCount(0);
  await expect(form.getByLabel("Régimen de uso", {exact: true})).toHaveCount(0);
  await expect(form.locator('[name="severity_multiplier"],[name="usage_regime"]')).toHaveCount(0);
  await form.getByLabel("Número de serie", {exact: true}).fill("JTDBR32E112345679");
  await form.getByLabel("Placas", {exact: true}).fill("tst-902-a");
  for (const [field, value] of Object.entries({make: "Toyota", model: "Corolla", model_year: "2024", version: "XLE", body_style: "Sedán", engine: "2.0 L", transmission: "Automática", drive: "FWD"})) await form.locator(`[name="${field}"]`).fill(value);
  await form.getByLabel("Kilometraje actual (km)", {exact: true}).fill("15200.5");
  await form.getByLabel("Fecha de puesta en servicio", {exact: true}).fill("2026-09-01");
  await form.getByLabel("Periodo de verificación (fecha límite)", {exact: true}).fill("2027-05-31");
  await form.getByLabel("Unidad de demostración", {exact: true}).check();
  await form.getByRole("button", {name: "Agregar a flotilla", exact: true}).click();
  await expect(form.getByText("Unidad registrada.", {exact: true})).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({plate: "TST-902-A", usage_regime: "normal", severity_multiplier: 1, current_km: 15200.5, verification_period_start: null, verification_period_end: "2027-05-31", is_synthetic: true});
  expect(posts[0]).not.toHaveProperty("assigned_user_id");
  await expect(page.getByRole("link", {name: "TST-902-A", exact: true})).toBeVisible();
});

test("plantilla Mazda conserva catálogo, modelos y autocompletado en el alta compartida", async ({page}) => {
  await mockedWorkspace(page);
  await page.goto("/?alta=1");
  const form = page.locator(".add-vehicle form");
  await form.getByRole("combobox", {name: "Plantilla de vehículo", exact: true}).selectOption("mazda3");
  await form.getByRole("combobox", {name: /^Modelo Mazda3 del catálogo/}).selectOption("mazda-fixture-2024");
  for (const [field, value] of Object.entries({make: "Mazda", model: "Mazda3", model_year: "2024", version: "i Touring", body_style: "Sedán", engine: "2.0 L", transmission: "Automática", drive: "FWD"})) await expect(form.locator(`[name="${field}"]`)).toHaveValue(value);
  await form.getByRole("combobox", {name: "Plantilla de vehículo", exact: true}).selectOption("manual");
  await expect(form.getByRole("combobox", {name: /^Modelo Mazda3 del catálogo/})).toHaveCount(0);
  await expect(form.getByLabel("Marca", {exact: true})).toHaveValue("Mazda");
});

test("conductor no puede abrir el alta de unidades ni las herramientas de administrador", async ({page}) => {
  await mockedWorkspace(page, {id: 902, name: "Conductor ficticio", email: "conductor@example.invalid", role: "user", active: true, vehicle_ids: [901]});
  await page.goto("/?alta=1");
  await expect(page.getByRole("heading", {level: 1, name: "Mis unidades", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Agregar unidad", exact: true})).toHaveCount(0);
  await expect(page.locator(".add-vehicle")).toHaveCount(0);
  await expect(page.getByRole("button", {name: "Recalcular planes", exact: true})).toHaveCount(0);
});
