import {expect, test} from "@playwright/test";
import {parseManualNumber} from "../lib/manual-capture";

test("captura decimal admite teclado con punto o coma y conserva cero explícito", () => {
  expect(parseManualNumber("9950")).toBe(9950);
  expect(parseManualNumber("9950.5")).toBe(9950.5);
  expect(parseManualNumber("9950,5")).toBe(9950.5);
  expect(parseManualNumber(" 9950 ")).toBe(9950);
  expect(parseManualNumber("0")).toBe(0);
});

test("vacío nunca se transforma en kilometraje cero", () => {
  for (const value of [null, "", "   "]) expect(() => parseManualNumber(value)).toThrow("Captura el kilometraje");
  expect(parseManualNumber("", "costo", true)).toBeNull();
  expect(parseManualNumber(null, "costo", true)).toBeNull();
  expect(parseManualNumber("0", "costo", true)).toBe(0);
});

test("rechaza negativos, exponentes, datos no finitos y formatos parciales", () => {
  for (const value of ["-1", "+12", "1e3", "NaN", "Infinity", "12abc", "1,000.5", "1 000", "1.2.3", "1,2,3", ".5", "12.", "9".repeat(500)]) {
    expect(() => parseManualNumber(value)).toThrow();
  }
});
