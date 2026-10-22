/** Decimal keyboard entry: no exponent, sign, grouping or implicit empty zero. */
export const MANUAL_DECIMAL_PATTERN = "[0-9]+([.,][0-9]+)?";

export function parseManualNumber(value: FormDataEntryValue | null, label?: string, optional?: false): number;
export function parseManualNumber(value: FormDataEntryValue | null, label: string, optional: true): number | null;
export function parseManualNumber(value: FormDataEntryValue | null, label = "kilometraje", optional = false): number | null {
  if (value != null && typeof value !== "string") throw new Error(`Escribe un ${label} válido.`);
  const raw = (value || "").trim();
  if (!raw) {
    if (optional) return null;
    throw new Error(`Captura el ${label}.`);
  }
  if (!/^[0-9]+(?:[.,][0-9]+)?$/.test(raw)) throw new Error(`Escribe un ${label} válido, sin separadores de miles.`);
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Escribe un ${label} válido.`);
  return parsed;
}
