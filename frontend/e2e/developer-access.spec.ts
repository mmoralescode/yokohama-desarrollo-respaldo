import {expect, test, type Page} from "@playwright/test";
import {DEVELOPER_EMAIL, isCompanyAdministrator, OWNER_EMAIL, type CompanyUser} from "../lib/auth-context";

const owner: CompanyUser = {id: 1, name: "Administración ficticia", email: OWNER_EMAIL, role: "admin", active: true, vehicle_ids: []};
const developer: CompanyUser = {id: 2, name: "Desarrollador ficticio", email: DEVELOPER_EMAIL, role: "admin", active: true, vehicle_ids: []};
const driver: CompanyUser = {id: 3, name: "Conductor ficticio", email: "conductor@example.invalid", role: "user", active: true, vehicle_ids: [10]};
const vehicle = {id: 10, plate: "QA-10-A", make: "Toyota", model: "Corolla", model_year: 2024, current_km: 8000, drivers: [driver.name]};

async function mockApi(page: Page, account: CompanyUser) {
  let users = [owner, developer, driver];
  const reads: string[] = [];
  const writes: {path: string; method: string; body: Record<string, unknown>}[] = [];
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/backend/", "");
    const method = request.method();
    const send = (body: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
    if (method === "GET") reads.push(path);
    else writes.push({path, method, body: request.postDataJSON() as Record<string, unknown>});
    if (path === "auth/status") return send({configured: true, required: true});
    if (path === "auth/me") return send(account);
    if (path === "users" && method === "GET") return send(users);
    if (path === "vehicles" && method === "GET") return send([vehicle]);
    if (path === "fleet-statistics") return send([{...vehicle, nickname: "Prueba", open_faults: 1, total_faults: 2, critical_faults: 0}]);
    if (path === "users" && method === "POST") {
      const body = request.postDataJSON();
      const created: CompanyUser = {id: 4, name: body.name, email: body.email, role: body.role, active: true, vehicle_ids: body.vehicle_ids};
      users = [...users, created];
      return send(created, 201);
    }
    throw new Error(`Unexpected mocked request: ${method} ${path}`);
  });
  return {reads, writes};
}

test.beforeEach(async ({baseURL}) => {
  test.skip(baseURL !== "http://127.0.0.1:3014", "Solo servidor aislado y cuentas ficticias; nunca producción.");
});

test("administración requiere cuenta activa, rol y uno de los dos correos exactos", () => {
  expect(isCompanyAdministrator(owner)).toBe(true);
  expect(isCompanyAdministrator(developer)).toBe(true);
  expect(isCompanyAdministrator({...developer, email: ` ${DEVELOPER_EMAIL.toUpperCase()} `})).toBe(true);
  expect(isCompanyAdministrator({...developer, role: "user"})).toBe(false);
  expect(isCompanyAdministrator({...developer, active: false})).toBe(false);
  expect(isCompanyAdministrator({...developer, email: "otro@example.invalid"})).toBe(false);
  expect(isCompanyAdministrator({...developer, email: `x${DEVELOPER_EMAIL}`})).toBe(false);
  expect(isCompanyAdministrator({...developer, email: `${DEVELOPER_EMAIL}.otro` })).toBe(false);
  expect(isCompanyAdministrator(null)).toBe(false);
});

test("desarrollador accede a usuarios y dashboard sin convertirse en conductor", async ({page}) => {
  const {reads, writes} = await mockApi(page, developer);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", {name: "Usuarios", exact: true})).toBeVisible();
  await expect(page.locator(".account-row")).toHaveCount(1);
  await expect(page.locator(".account-row")).toContainText(driver.email);
  await expect(page.getByRole("button", {name: `Editar cuenta de ${developer.name}`})).toHaveCount(0);
  await expect(page.getByRole("button", {name: `Editar cuenta de ${owner.name}`})).toHaveCount(0);
  await expect(page.getByLabel("Cuentas administradoras")).toContainText(`${DEVELOPER_EMAIL} (desarrollador)`);
  await expect(page.getByLabel("Cuentas administradoras")).toContainText(OWNER_EMAIL);

  await page.getByRole("button", {name: "Agregar usuario", exact: true}).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByLabel("Nombre completo").fill("Nuevo conductor ficticio");
  await page.getByLabel("Correo de acceso").fill("nuevo@example.invalid");
  await page.getByLabel("Contraseña inicial").fill("synthetic-user-password-2026");
  await page.getByLabel("Confirmar contraseña", {exact: true}).fill("synthetic-user-password-2026");
  await page.getByRole("button", {name: "Crear usuario", exact: true}).click();
  await expect(page.getByRole("button", {name: "Cargar unidad", exact: true})).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toBe("users");
  expect(writes[0].body.role).toBe("user");

  await page.getByRole("button", {name: /Operación/}).click();
  const navigation = page.getByRole("navigation");
  await expect(navigation.getByRole("link", {name: "Usuarios", exact: true})).toBeVisible();
  await expect(navigation.getByRole("link", {name: "Calendario", exact: true})).toBeVisible();
  await expect(navigation.getByRole("link", {name: "Alertas", exact: true})).toBeVisible();
  await navigation.getByRole("link", {name: "Dashboard", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Dashboard", exact: true})).toBeVisible();
  await expect(page.getByTestId("dashboard-kilometers-chart")).toContainText(vehicle.plate);
  expect(reads).toContain("fleet-statistics");
  await page.goto("/cuenta");
  await expect(page.locator(".account-profile-fields")).toContainText(DEVELOPER_EMAIL);
  await expect(page.getByText("Administrador", {exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "Administrar usuarios"})).toBeVisible();
  expect(errors).toEqual([]);
});

for (const account of [
  {...developer, email: "otro@example.invalid"},
  {...developer, active: false},
  {...developer, role: "user" as const},
]) {
  test(`sin privilegios si correo=${account.email}, activo=${account.active}, rol=${account.role}`, async ({page}) => {
    const {reads, writes} = await mockApi(page, account);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", {name: "Tu espacio de conductor"})).toBeVisible();
    await expect(page.getByTestId("dashboard-kilometers-chart")).toHaveCount(0);
    await page.getByRole("button", {name: /Operación/}).click();
    await expect(page.getByRole("navigation").getByRole("link", {name: "Usuarios", exact: true})).toHaveCount(0);
    await expect(page.getByRole("navigation").getByRole("link", {name: "Dashboard", exact: true})).toHaveCount(0);
    await page.goto("/usuarios");
    await expect(page.getByRole("heading", {name: "Tu espacio de conductor"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Agregar usuario", exact: true})).toHaveCount(0);
    expect(reads).not.toContain("users");
    expect(reads).not.toContain("fleet-statistics");
    expect(writes).toEqual([]);
  });
}
