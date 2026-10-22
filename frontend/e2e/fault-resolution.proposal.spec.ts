import {expect, test, type APIRequestContext, type Page} from "@playwright/test";
import type {VehicleDetail, VehicleSummary} from "../lib/types";

const storageKey = "yokohama-propuesta-administrativa-v1";

async function seedFault(page: Page, request: APIRequestContext) {
  const response = await request.get("/proposal/fleet.json");
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json() as {vehicles: VehicleSummary[]; details: Record<string, VehicleDetail>};
  const detail = Object.values(snapshot.details).find(detail => detail.faults.some(fault => fault.status !== "resolved"))!;
  expect(detail.vehicle.is_synthetic).toBe(true);
  const fault = detail.faults.find(fault => fault.status !== "resolved")!;
  const open = Object.values(snapshot.details).reduce((total, detail) => total + detail.faults.filter(fault => fault.status !== "resolved").length, 0);
  const total = Object.values(snapshot.details).reduce((total, detail) => total + detail.faults.length, 0);
  await page.addInitScript(({key, state}) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({...state, revision: 1, appointments: [], completed: [], evidence: [], incidents: [], administration_changes: []}));
  }, {key: storageKey, state: snapshot});
  const photo = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 180; canvas.height = 100;
    const context = canvas.getContext("2d")!; context.fillStyle = "#fff"; context.fillRect(0, 0, 180, 100);
    context.fillStyle = "#111"; context.fillText("REPARACION FICTICIA", 8, 50);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  return {vehicle: detail.vehicle, fault, open, total, photo};
}

test("Registrar solución abre campos y foto, cierra el mismo reporte y actualiza el dashboard", async ({page, request}, info) => {
  const fixture = await seedFault(page, request);
  const privateRequests: string[] = [], errors: string[] = [];
  page.on("request", request => {if (new URL(request.url()).pathname.startsWith("/api/")) privateRequests.push(request.url());});
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`/fallas?unidad=${fixture.vehicle.id}`);
  const report = page.locator(".service-row").filter({hasText: `Reporte #${fixture.fault.id} ·`});
  await expect(report).toHaveCount(1);
  const toggle = report.getByRole("button", {name: "Registrar solución", exact: true});
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(report.getByLabel("Describe la solución aplicada", {exact: true})).toHaveCount(0);
  await toggle.click();
  await expect(report.getByRole("button", {name: "Cancelar solución", exact: true})).toHaveAttribute("aria-expanded", "true");
  const panel = report.getByRole("region", {name: `Registrar solución del reporte #${fixture.fault.id}`, exact: true});
  const description = panel.getByLabel("Describe la solución aplicada", {exact: true});
  await expect(description).toBeVisible();
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute("required", "");
  await expect(description).toHaveAttribute("minlength", "8");
  await expect(panel.getByLabel("Fotos de la solución (máximo 3)", {exact: true})).toBeVisible();
  const solution = "Solución ficticia: se reparó el componente y se validó en el taller.";
  await description.fill(solution);
  await panel.getByLabel("Fotos de la solución (máximo 3)", {exact: true}).setInputFiles({name: "solucion-prueba.png", mimeType: "image/png", buffer: fixture.photo});
  await expect(panel.getByAltText(/^Vista previa: solucion-prueba\.(?:jpg|png)$/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {window.scrollTo(0, 0); (document.activeElement as HTMLElement | null)?.blur();});
  await page.screenshot({path: info.outputPath("registrar-solucion-mobile.png"), fullPage: true});
  await panel.getByRole("button", {name: "Guardar solución y cerrar reporte", exact: true}).click();
  await expect(page.getByLabel("Filtrar fallas")).toHaveValue("all");
  await expect(report.locator(".status-resolved")).toHaveText("Resuelta");
  await expect(report.getByText(solution, {exact: false})).toBeVisible();
  await expect(report.getByRole("button", {name: "Ver foto 1", exact: true})).toBeVisible();
  await expect(report.getByRole("button", {name: "Registrar solución", exact: true})).toHaveCount(0);
  await report.getByRole("button", {name: "Ver foto 1", exact: true}).click();
  await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
  await page.getByRole("button", {name: "Cerrar foto", exact: true}).click();
  const saved = await page.evaluate(({key, vehicleId, faultId}) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    const faults = state.details[String(vehicleId)].faults as {id: number; status: string; resolution_notes: string}[];
    return {record: faults.find(fault => fault.id === faultId), sameIdCount: faults.filter(fault => fault.id === faultId).length,
      photoCount: state.evidence.filter((photo: {fault_id?: number}) => photo.fault_id === faultId).length};
  }, {key: storageKey, vehicleId: fixture.vehicle.id, faultId: fixture.fault.id});
  expect(saved.record).toMatchObject({id: fixture.fault.id, status: "resolved", resolution_notes: solution});
  expect(saved.sameIdCount).toBe(1); expect(saved.photoCount).toBe(1);
  await page.reload();
  await page.getByLabel("Filtrar fallas").selectOption("all");
  await expect(report.locator(".status-resolved")).toHaveText("Resuelta");
  await expect(report).toContainText(solution);
  await expect(report.getByRole("button", {name: "Ver foto 1", exact: true})).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByTestId("dashboard-open-faults-count").locator("strong")).toHaveText(String(fixture.open - 1));
  await expect(page.getByTestId("dashboard-faults-count").locator("strong")).toHaveText(String(fixture.total));
  await page.getByLabel("Buscar unidad por placa o apodo").fill(fixture.vehicle.plate);
  await expect(page.getByTestId(`dashboard-faults-unit-${fixture.vehicle.id}`)).toContainText("0 abiertas · 1 resuelta");
  expect(errors).toEqual([]); expect(privateRequests).toEqual([]);
});

test("una solución inválida conserva el panel, el texto y la foto sin cerrar ni alterar el reporte", async ({page, request}) => {
  const fixture = await seedFault(page, request);
  await page.goto(`/fallas?unidad=${fixture.vehicle.id}`);
  const report = page.locator(".service-row").filter({hasText: `Reporte #${fixture.fault.id} ·`});
  await report.getByRole("button", {name: "Registrar solución", exact: true}).click();
  const panel = report.getByRole("region", {name: `Registrar solución del reporte #${fixture.fault.id}`, exact: true});
  await panel.getByLabel("Describe la solución aplicada", {exact: true}).fill("        ");
  await panel.getByLabel("Fotos de la solución (máximo 3)", {exact: true}).setInputFiles({name: "solucion-pendiente.png", mimeType: "image/png", buffer: fixture.photo});
  await expect(panel.getByAltText(/^Vista previa: solucion-pendiente\.(?:jpg|png)$/)).toBeVisible();
  await panel.getByRole("button", {name: "Guardar solución y cerrar reporte", exact: true}).click();
  await expect(panel.getByRole("alert")).toContainText("Describe la resolución con entre 8 y 2000 caracteres.");
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Describe la solución aplicada", {exact: true})).toHaveValue("        ");
  await expect(panel.getByAltText(/^Vista previa: solucion-pendiente\.(?:jpg|png)$/)).toBeVisible();
  await expect(report.locator(".status-open")).toHaveText("Abierta");
  await expect(page.getByLabel("Filtrar fallas")).toHaveValue("open");
  const saved = await page.evaluate(({key, vehicleId, faultId}) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    const record = state.details[String(vehicleId)].faults.find((fault: {id: number}) => fault.id === faultId);
    return {status: record.status, notes: record.resolution_notes, photos: state.evidence.filter((photo: {fault_id?: number}) => photo.fault_id === faultId).length};
  }, {key: storageKey, vehicleId: fixture.vehicle.id, faultId: fixture.fault.id});
  expect(saved).toEqual({status: "open", notes: fixture.fault.resolution_notes, photos: 0});
});
