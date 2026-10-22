import {expect, test, type Page} from "@playwright/test";
import type {CompanyUser} from "../lib/auth-context";

const owner: CompanyUser = {id: 1, name: "Administración ficticia", email: "admin.yoko@gmail.com", role: "admin", active: true, vehicle_ids: []};
const existing: CompanyUser = {id: 2, name: "Conductor existente", email: "existente@example.invalid", role: "user", active: true, vehicle_ids: [10]};
const password = "password-onboarding-only-2026";
const initialVehicle = {id: 10, plate: "E2E-10-A", make: "Toyota", model: "Corolla", model_year: 2024, current_km: 8000, drivers: [existing.name]};

async function mockApi(page: Page, signedIn = true) {
  let loggedIn = signedIn;
  let people = [owner, structuredClone(existing)];
  let vehicles = [structuredClone(initialVehicle)];
  const writes: {path: string; method: string; body: Record<string, unknown>}[] = [];
  await page.route("**/api/backend/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/backend/", "");
    const method = request.method();
    const send = (body: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(body)});
    if (method !== "GET") writes.push({path, method, body: request.postDataJSON() as Record<string, unknown>});
    if (path === "auth/status") return send({configured: true, required: true});
    if (path === "auth/me") return loggedIn ? send(owner) : send({detail: "Inicia sesión."}, 401);
    if (path === "auth/login") {loggedIn = true; return send(owner);}
    if (path === "auth/logout") {loggedIn = false; return send({ok: true});}
    if (path === "users" && method === "GET") return send(people);
    if (path === "vehicles" && method === "GET") return send(vehicles);
    if (path === "variants") return send({variantes: []});
    if (path === "users" && method === "POST") {
      const body = request.postDataJSON();
      const created: CompanyUser = {id: 3, name: body.name, email: body.email, role: "user", active: true, vehicle_ids: body.vehicle_ids};
      people = [...people, created];
      return send(created, 201);
    }
    if (path === "users/2" && method === "PATCH") {
      const body = request.postDataJSON();
      const updated = {...people.find(user => user.id === 2)!, name: body.name, email: body.email, active: body.active, vehicle_ids: body.vehicle_ids};
      people = people.map(user => user.id === 2 ? updated : user);
      return send(updated);
    }
    if (path === "vehicles" && method === "POST") {
      const body = request.postDataJSON();
      const vehicle = {...initialVehicle, ...body, id: 11, drivers: [people.find(user => user.id === body.assigned_user_id)!.name]};
      vehicles = [...vehicles, vehicle];
      people = people.map(user => user.id === body.assigned_user_id ? {...user, vehicle_ids: [...user.vehicle_ids, vehicle.id]} : user);
      return send(vehicle, 201);
    }
    throw new Error(`Unexpected synthetic test request: ${method} ${path}`);
  });
  return writes;
}

test.beforeEach(async ({baseURL}) => {
  test.skip(baseURL !== "http://127.0.0.1:3013", "Solo servidor temporal y respuestas ficticias.");
});

test("login y acceso sin sesión no muestran Operación; autenticado conserva menú y salir", async ({page}) => {
  await mockApi(page, false);
  await page.goto("/acceso");
  await expect(page.getByRole("heading", {name: "Bienvenido a Yokohama"})).toBeVisible();
  const contact = page.locator(".account-hint").filter({hasText: "Si necesitas una cuenta o recuperar el acceso"});
  await expect(contact).toHaveText("Si necesitas una cuenta o recuperar el acceso, comunícate con: martinmoralesbasurto1@gmail.com ruben.cicata@gmail.com.", {useInnerText: true});
  for (const email of ["martinmoralesbasurto1@gmail.com", "ruben.cicata@gmail.com"]) {
    const link = contact.getByRole("link", {name: email, exact: true});
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `mailto:${email}`);
  }
  await expect(page.locator("header .brand")).toHaveText("YOKOHAMA");
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "Entra a tu cuenta"})).toBeVisible();
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
  await page.goto("/acceso");
  await page.getByLabel("Correo electrónico").fill(owner.email);
  await page.getByLabel("Contraseña", {exact: true}).fill(password);
  await page.getByRole("button", {name: "Iniciar sesión", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Mi flotilla", exact: true})).toBeVisible();
  await page.getByRole("button", {name: /Operación/}).click();
  await expect(page.getByRole("navigation").getByRole("link", {name: "Usuarios", exact: true})).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Salir", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Entra a tu cuenta"})).toBeVisible();
  await expect(page.getByRole("button", {name: /Operación/})).toHaveCount(0);
});

test("confirmación evita altas incorrectas y permite registrar unidad vinculada sin repetir cuenta", async ({page}) => {
  const writes = await mockApi(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/usuarios");
  await expect(page.getByRole("heading", {name: "Equipo registrado", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Cargar unidad", exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "Agregar usuario", exact: true}).click();
  await page.getByLabel("Nombre completo").fill("Conductor nuevo");
  await page.getByLabel("Correo de acceso").fill("nuevo@example.invalid");
  await page.getByLabel("Contraseña inicial").fill(password);
  await page.getByLabel("Confirmar contraseña", {exact: true}).fill("different-password-for-test");
  await page.getByRole("button", {name: "Crear usuario", exact: true}).click();
  await expect(page.locator(".account-form").getByRole("alert")).toContainText("Las contraseñas no coinciden");
  expect(writes.filter(write => write.path === "users")).toHaveLength(0);
  await page.getByLabel("Confirmar contraseña", {exact: true}).fill(password);
  await page.getByRole("checkbox", {name: /E2E-10-A/}).check();
  await page.getByRole("button", {name: "Crear usuario", exact: true}).click();
  await expect(page.getByRole("button", {name: "Cargar unidad", exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Crear usuario", exact: true})).toHaveCount(0);
  const userWrite = writes.find(write => write.path === "users")!;
  expect(userWrite.body).not.toHaveProperty("passwordConfirmation");
  await page.getByRole("button", {name: "Cargar unidad", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Registrar unidad", exact: true})).toBeVisible();
  await expect(page.getByText("Conductor:", {exact: false})).toContainText("Conductor nuevo");
  await page.getByLabel("Número de serie").fill("1HGCM82633A004352");
  await page.getByLabel("Placas", {exact: true}).fill("E2E-11-B");
  await page.getByLabel("Marca", {exact: true}).fill("Nissan");
  await page.getByLabel("Modelo", {exact: true}).fill("Versa");
  await page.getByLabel("Año modelo").fill("2024");
  await page.getByLabel("Versión", {exact: true}).fill("Base");
  await page.getByLabel("Carrocería").fill("sedán");
  await page.getByLabel("Motor", {exact: true}).fill("1.6 L");
  await page.getByLabel("Transmisión").fill("manual");
  await page.getByLabel("Tracción").fill("FWD");
  await page.getByLabel("Kilometraje actual (km)").fill("12000");
  await page.getByLabel("Fecha de puesta en servicio").fill("2024-01-01");
  await page.getByRole("button", {name: "Registrar y asignar unidad", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Registrar unidad", exact: true})).toHaveCount(0);
  const newRow = page.locator(".account-row").filter({has: page.getByText("nuevo@example.invalid", {exact: true})});
  await expect(newRow.getByText("2 unidades", {exact: true})).toBeVisible();
  await newRow.getByText("Mostrar más", {exact: true}).click();
  await expect(newRow.getByRole("link", {name: "E2E-11-B", exact: true})).toBeVisible();
  await expect(newRow.getByRole("link", {name: "E2E-10-A", exact: true})).toBeVisible();
  expect(writes.filter(write => write.path === "users" && write.method === "POST")).toHaveLength(1);
  expect(writes.filter(write => write.path === "vehicles" && write.method === "POST")).toHaveLength(1);
  expect(writes.find(write => write.path === "vehicles")!.body.assigned_user_id).toBe(3);
  expect(writes.filter(write => write.path.startsWith("users/") && write.method === "PATCH")).toHaveLength(0);
  await page.getByRole("region", {name: "Unidad del usuario creado"}).getByRole("button", {name: "Cerrar", exact: true}).click();
  await expect(page.getByRole("button", {name: "Cargar unidad", exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("editar cuenta exige confirmar solo si cambia contraseña y no muestra Cargar unidad", async ({page}) => {
  const writes = await mockApi(page);
  await page.goto("/usuarios");
  await page.getByRole("button", {name: `Editar cuenta de ${existing.name}`}).click();
  await expect(page.getByLabel("Nueva contraseña (opcional)")).toHaveValue("");
  await expect(page.getByLabel("Confirmar nueva contraseña")).not.toHaveAttribute("required");
  await page.getByLabel("Nueva contraseña (opcional)").fill(password);
  await expect(page.getByLabel("Confirmar nueva contraseña")).toHaveAttribute("required", "");
  await page.getByLabel("Confirmar nueva contraseña").fill("different-edit-password-test");
  await page.getByRole("button", {name: "Guardar cambios", exact: true}).click();
  await expect(page.locator(".account-form").getByRole("alert")).toContainText("Las contraseñas no coinciden");
  expect(writes).toHaveLength(0);
  await page.getByLabel("Nueva contraseña (opcional)").fill("");
  await page.getByLabel("Confirmar nueva contraseña").fill("");
  await page.getByRole("button", {name: "Guardar cambios", exact: true}).click();
  await expect(page.getByText(/Cambios guardados/)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].body).not.toHaveProperty("password");
  await expect(page.getByRole("button", {name: "Cargar unidad", exact: true})).toHaveCount(0);
});
