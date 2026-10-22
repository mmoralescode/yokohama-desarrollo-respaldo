import {expect, test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {localDate} from "../lib/dates";

test.use({baseURL: process.env.YOKOHAMA_PROPOSAL_TEST_URL || "http://127.0.0.1:3004", channel: "chromium"});

test("ambas gráficas identifican los conductores asignados y las unidades sin conductor", async ({page}) => {
  const snapshot = JSON.parse(readFileSync(join(__dirname, "../public/proposal/fleet.json"), "utf8"));
  const names = snapshot.details["1"].vehicle.drivers as string[];
  expect(names.length).toBeGreaterThan(1);
  snapshot.details["2"].vehicle.drivers = [];
  snapshot.vehicles.find((vehicle: {id: number}) => vehicle.id === 2).drivers = [];
  await page.addInitScript(fleet => {
    window.localStorage.setItem("yokohama-propuesta-administrativa-v1", JSON.stringify({...fleet, revision: 1, appointments: [], completed: [], evidence: []}));
  }, snapshot);
  await page.goto("/dashboard");
  await expect(page.getByText("Propuesta con datos ficticios.", {exact: true})).toBeVisible();
  const search = page.getByLabel("Buscar unidad por placa o apodo");
  await search.fill("YKH-101-A");
  for (const chart of ["kilometers", "faults"]) {
    await expect(page.getByTestId(`dashboard-${chart}-unit-1`).locator(".unit-chart-drivers")).toHaveText(`Conductores: ${names.join(", ")}`);
  }
  await search.fill("YKH-102-A");
  for (const chart of ["kilometers", "faults"]) {
    await expect(page.getByTestId(`dashboard-${chart}-unit-2`).locator(".unit-chart-drivers")).toHaveText("Sin conductor asignado");
  }
});

test("dashboard muestra kilometraje y fallas por unidad, sin acciones duplicadas y sin API privada", async ({page}, info) => {
  const privateRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {if (new URL(request.url()).pathname.startsWith("/api/")) privateRequests.push(request.url());});
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard");
  await expect(page.getByText("Propuesta con datos ficticios.", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Dashboard", exact: true})).toBeVisible();
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("20");
  const kilometers = page.getByTestId("dashboard-kilometers-chart"), faults = page.getByTestId("dashboard-faults-chart");
  await expect(kilometers.locator(".unit-chart-list > li")).toHaveCount(8);
  await expect(faults.locator(".unit-chart-list > li")).toHaveCount(8);
  for (const action of ["Agregar unidad", "Registrar servicio", "Reportar falla", "Reportar incidencia"]) {
    await expect(page.locator(".dashboard").getByRole("link", {name: action, exact: true})).toHaveCount(0);
    await expect(page.locator(".dashboard").getByRole("button", {name: action, exact: true})).toHaveCount(0);
  }
  await expect(page.locator(".dashboard form")).toHaveCount(0);
  await page.getByRole("button", {name: "Mostrar más unidades en kilometraje"}).click();
  await expect(kilometers.locator(".unit-chart-list > li")).toHaveCount(16);
  await page.getByRole("button", {name: "Mostrar más unidades en kilometraje"}).click();
  await expect(kilometers.locator(".unit-chart-list > li")).toHaveCount(20);
  await page.getByRole("button", {name: "Mostrar menos unidades en kilometraje"}).click();
  await expect(kilometers.locator(".unit-chart-list > li")).toHaveCount(8);
  await page.getByLabel("Buscar unidad por placa o apodo").fill("YKH-101-A");
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("1");
  await expect(kilometers.locator(".unit-chart-list > li")).toHaveCount(1);
  await expect(faults.locator(".unit-chart-list > li")).toHaveCount(1);
  await page.getByLabel("Buscar unidad por placa o apodo").fill("101A");
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("1");
  await page.getByLabel("Buscar unidad por placa o apodo").fill("no-existe");
  await expect(page.getByRole("heading", {name: "Sin coincidencias"})).toBeVisible();
  await page.getByLabel("Buscar unidad por placa o apodo").fill("");
  await page.evaluate(() => {window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur();});
  await page.screenshot({path: info.outputPath("dashboard-public-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => {window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur();});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({path: info.outputPath("dashboard-public-mobile.png"), fullPage: true});
  expect(errors).toEqual([]);
  expect(privateRequests).toEqual([]);
});

test("el kilometraje se actualiza desde su sección y no suma lecturas repetidas", async ({page}) => {
  await page.goto("/kilometraje?unidad=1");
  await expect(page.getByText("Propuesta con datos ficticios.", {exact: true})).toBeVisible();
  const entry = page.getByLabel("Kilometraje (km)", {exact: true});
  await expect(entry).toBeVisible();
  const nextKilometers = Number((Number(await entry.getAttribute("placeholder")) + 10).toFixed(2));
  await entry.fill(String(nextKilometers));
  await page.getByRole("button", {name: "Guardar kilometraje", exact: true}).click();
  await expect(page.getByText(/Kilometraje guardado/)).toBeVisible();
  await page.goto("/dashboard");
  await page.getByLabel("Buscar unidad por placa o apodo").fill("YKH-101-A");
  await expect(page.getByTestId("dashboard-kilometers-unit-1").locator("strong")).toHaveText(`${new Intl.NumberFormat("es-MX", {maximumFractionDigits: 20}).format(nextKilometers)} km`);
  await page.reload();
  await page.getByLabel("Buscar unidad por placa o apodo").fill("YKH-101-A");
  await expect(page.getByTestId("dashboard-kilometers-unit-1").locator("strong")).toHaveText(`${new Intl.NumberFormat("es-MX", {maximumFractionDigits: 20}).format(nextKilometers)} km`);
});

test("una falla capturada desde Fallas actualiza su gráfica y se conserva al recargar", async ({page}) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Propuesta con datos ficticios.", {exact: true})).toBeVisible();
  const total = page.getByTestId("dashboard-faults-count").locator("strong");
  await expect(total).toBeVisible();
  const before = Number((await total.innerText()).replace(/\D/g, ""));
  await page.getByLabel("Buscar unidad por placa o apodo").fill("YKH-101-A");
  await expect(page.getByTestId("dashboard-fleet-count").locator("strong")).toHaveText("1");
  const beforeUnitOpen = Number((await page.getByTestId("dashboard-open-faults-count").locator("strong").innerText()).replace(/\D/g, ""));
  await page.goto("/fallas?unidad=1");
  await page.getByLabel("Fecha en que detectaste la falla").fill(localDate());
  const report = "Falla ficticia para verificar el dashboard sin duplicar formularios";
  await page.getByLabel("¿Qué problema observaste?").fill(report);
  await page.getByRole("button", {name: "Guardar reporte de falla", exact: true}).click();
  await expect(page.getByText(report, {exact: true})).toBeVisible();
  await page.goto("/dashboard");
  await expect(total).toHaveText(new Intl.NumberFormat("es-MX").format(before + 1));
  await page.getByLabel("Buscar unidad por placa o apodo").fill("YKH-101-A");
  await expect(page.getByTestId("dashboard-faults-unit-1")).toContainText(`${beforeUnitOpen + 1} abiertas`);
  await page.reload();
  await expect(total).toHaveText(new Intl.NumberFormat("es-MX").format(before + 1));
  await expect(page.locator(".dashboard [role=alert]")).toHaveCount(0);
});
