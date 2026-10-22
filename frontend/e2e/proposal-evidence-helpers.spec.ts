import {expect, test} from "@playwright/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {localDate} from "../lib/dates";
import {proposalApi} from "../lib/proposal-api";
import type {Evidence, Fault, Reading, Vehicle, VehicleDetail} from "../lib/types";

test("proposal captures preserve older data, hide bytes in metadata and roll back photo or storage failures", async () => {
  const snapshot = JSON.parse(readFileSync(join(__dirname, "../public/proposal/fleet.json"), "utf8"));
  const originalHistory = structuredClone(snapshot.details["1"].history);
  const legacyPhoto = {id: "old-browser-photo", vehicle_id: 1, reading_id: snapshot.details["1"].readings[0].id,
    filename: "original.jpg", mime_type: "image/jpeg", captured_at: new Date().toISOString(), captured_by: null,
    data_url: "data:image/jpeg;base64,/9j/2Q=="};
  // An older workspace is upgraded without replacing its records or evidence.
  let stored = JSON.stringify({...snapshot, revision: 1, appointments: [], completed: [], evidence: [legacyPhoto]});
  let rejectSave = false;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "window", {configurable: true, value: {localStorage: {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {if (rejectSave) throw new Error("quota"); stored = value;},
  }}});
  globalThis.fetch = (() => {throw new Error("A saved proposal must not contact the private API.");}) as typeof fetch;
  try {
    const gallery = await proposalApi<Evidence[]>("vehicles/1/evidence", {});
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).not.toHaveProperty("data_url");
    expect((await proposalApi<Evidence>("evidence/old-browser-photo", {})).data_url).toBe(legacyPhoto.data_url);
    const initial = await proposalApi<VehicleDetail>("vehicles/1", {});
    expect(initial.readings[0].photos?.[0].id).toBe(legacyPhoto.id);
    const unit = await proposalApi<Vehicle>("vehicles", {method: "POST", body: {
      vin: "EVD00000000000001", plate: "EVD-101", make: "Toyota", model: "Yaris", model_year: 2024,
      version: "Base", body_style: "Sedán", engine: "1.5", transmission: "AT", drive: "FWD",
      current_km: 100, in_service_date: "2024-01-01",
    }});
    const capture = await proposalApi<Reading>(`vehicles/${unit.id}/odometer-captures`, {method: "POST", body: {
      recorded_at: new Date(Date.now() - 60_000).toISOString(), odometer_km: 100, source: "manual", photos: [],
    }});
    expect(capture.photos).toEqual([]);
    expect(capture.captured_by).toBeNull();
    const savedAfterCapture = stored;
    await expect(proposalApi(`vehicles/${unit.id}/odometer-captures`, {method: "POST", body: {
      recorded_at: new Date(Date.now() - 30_000).toISOString(), odometer_km: 100,
      photos: [{filename: "bad.svg", data_url: "data:image/svg+xml;base64,YmFk"}],
    }})).rejects.toThrow("fotografía");
    expect(stored).toBe(savedAfterCapture);
    const reported = localDate(new Date(Date.now() - 86_400_000));
    const fault = await proposalApi<Fault>(`vehicles/${unit.id}/faults`, {method: "POST", body: {
      reported_on: reported, description: "Falla capturada varios días después", severity: "menor", photos: [],
    }});
    expect(fault.reported_on).toBe(reported);
    const beforeReject = stored;
    await expect(proposalApi(`vehicles/${unit.id}/evidence`, {method: "POST", body: {
      reading_id: capture.id, fault_id: fault.id, photos: [],
    }})).rejects.toThrow("un solo registro");
    expect(stored).toBe(beforeReject);
    rejectSave = true;
    await expect(proposalApi(`faults/${fault.id}/resolve`, {method: "PATCH", body: {
      resolution_notes: "Trabajo terminado en el taller", photos: [],
    }})).rejects.toThrow("no se guardó parcialmente");
    expect(stored).toBe(beforeReject);
    expect((await proposalApi<VehicleDetail>(`vehicles/${unit.id}`, {})).faults[0].status).toBe("open");
    rejectSave = false;
    expect(JSON.parse(stored).details["1"].history).toEqual(originalHistory);
    expect(JSON.parse(stored).evidence[0]).toEqual(legacyPhoto);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
