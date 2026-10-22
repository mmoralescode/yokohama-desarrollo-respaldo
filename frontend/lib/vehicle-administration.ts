import {normalizeSearch} from "./drivers";
import {localDate} from "./dates";
import type {Vehicle} from "./types";

/** Fleet identification uses the final four characters printed on the plate. */
export function plateEnding(plate: string): string | null {
  return plate.trim().toUpperCase().slice(-4) || null;
}
/** Retained only for the archived verification-calendar calculations. */
export function numericPlateEnding(plate: string): string | null {
  return plate.match(/\d(?=\D*$)/)?.[0] ?? null;
}
export function matchesVehicle(vehicle: Partial<Vehicle>, search: string): boolean {
  const query = normalizeSearch(search).trim();
  if (!query) return true;
  const identity = [vehicle.plate, vehicle.nickname, vehicle.make, vehicle.model, vehicle.version, vehicle.vin, vehicle.model_year].filter(Boolean).join(" ");
  const compact = (value: string) => normalizeSearch(value).replace(/[^a-z0-9]/g, "");
  const compactQuery = compact(query);
  return normalizeSearch(identity).includes(query) || Boolean(compactQuery && compact(vehicle.plate || "").includes(compactQuery));
}
export const administrationFields = ["nickname", "registration_state", "verification_period_start", "verification_period_end", "circulation_card_expires_on", "plates_expires_on", "vehicle_tax_due_on", "vehicle_tax_paid_on", "administrative_notes"] as const;
export const administrationLabels: Record<string, string> = {nickname: "Apodo", registration_state: "Entidad", verification_period_start: "Inicio de verificación", verification_period_end: "Fin de verificación", circulation_card_expires_on: "Tarjeta de circulación", plates_expires_on: "Vigencia de placas", vehicle_tax_due_on: "Plazo de pago vehicular", vehicle_tax_paid_on: "Fecha real de pago", administrative_notes: "Notas y referencia", document_alert_days: "Días de anticipación"};
export function administrationPayload(data: FormData, options: {creation?: boolean; allowSingleVerificationDate?: boolean} = {}) {
  const values = Object.fromEntries(administrationFields.map(key => [key, String(data.get(key) || "").trim() || null]));
  const start = values.verification_period_start, end = values.verification_period_end;
  const singleDeadline = !start && !!end && (options.creation || options.allowSingleVerificationDate);
  if (Boolean(start) !== Boolean(end) && !singleDeadline) throw new Error("Captura inicio y fin del periodo de verificación, o deja ambas fechas vacías.");
  if (start && end && start > end) throw new Error("El fin de la verificación debe ser igual o posterior al inicio.");
  if (values.vehicle_tax_paid_on && !values.vehicle_tax_due_on) throw new Error("Captura el plazo del periodo al que corresponde el pago.");
  if (values.vehicle_tax_paid_on && values.vehicle_tax_paid_on > localDate()) throw new Error("La fecha real del pago no puede estar en el futuro.");
  if ((values.administrative_notes?.length || 0) > 1500) throw new Error("Las notas admiten hasta 1500 caracteres.");
  return {...values, document_alert_days: Number(data.get("document_alert_days") || 30)};
}
