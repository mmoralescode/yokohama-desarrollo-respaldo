import {expect, test} from "@playwright/test";
import {queretaroVerificationPeriod} from "../lib/queretaro-verification";

const periods = [
  {endings: ["5", "6"], first: ["2026-01-01", "2026-02-28"], second: ["2026-07-01", "2026-08-31"]},
  {endings: ["7", "8"], first: ["2026-02-01", "2026-03-31"], second: ["2026-08-01", "2026-09-30"]},
  {endings: ["3", "4"], first: ["2026-03-01", "2026-04-30"], second: ["2026-09-01", "2026-10-31"]},
  {endings: ["1", "2"], first: ["2026-04-01", "2026-05-31"], second: ["2026-10-01", "2026-11-30"]},
  {endings: ["9", "0"], first: ["2026-05-01", "2026-06-30"], second: ["2026-11-01", "2026-12-31"]},
] as const;

for (const period of periods) {
  for (const ending of period.endings) {
    test(`Querétaro 2026: terminación ${ending} conserva ambos periodos del calendario`, () => {
      const plate = `QRO-48${ending}-B`;
      expect(queretaroVerificationPeriod(plate, 2026, 1)).toEqual({start: period.first[0], end: period.first[1], ending});
      expect(queretaroVerificationPeriod(plate, 2026, 2)).toEqual({start: period.second[0], end: period.second[1], ending});
    });
  }
}

test("usa el último dígito aunque la placa termine con letras", () => {
  const expected = {start: "2026-10-01", end: "2026-11-30", ending: "2"};
  for (const plate of ["NXR-482-B", "  nxr482b  ", "ABC-12-ZZZ", "2"]) {
    expect(queretaroVerificationPeriod(plate, 2026, 2)).toEqual(expected);
  }
});

test("no inventa periodos para placas sin números ni para años no revisados", () => {
  for (const plate of ["", "   ", "ESPECIAL", "QRO-ABC"]) {
    expect(queretaroVerificationPeriod(plate, 2026, 1)).toBeNull();
    expect(queretaroVerificationPeriod(plate, 2026, 2)).toBeNull();
  }
  for (const year of [2025, 2027, 0, Number.NaN]) {
    expect(queretaroVerificationPeriod("NXR-482-B", year, 1)).toBeNull();
    expect(queretaroVerificationPeriod("NXR-482-B", year, 2)).toBeNull();
  }
});
