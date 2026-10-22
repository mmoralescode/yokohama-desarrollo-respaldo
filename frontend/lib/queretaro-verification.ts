import {numericPlateEnding} from "./vehicle-administration";

export const QUERETARO_CALENDAR_SOURCE = "https://queretaro.gob.mx/es/web/sedesu/calendario";

/** Ordinary private/heavy-vehicle calendar only. Never infer exemptions or renewals.
 * Keep the reviewed year explicit: a new program must be checked before extending it.
 */
export function queretaroVerificationPeriod(plate: string, year: number, semester: 1 | 2): {start: string; end: string; ending: string} | null {
  const ending = numericPlateEnding(plate);
  if (year !== 2026 || (semester !== 1 && semester !== 2) || ending === null) return null;
  const firstMonth: Record<string, number> = {"5": 1, "6": 1, "7": 2, "8": 2, "3": 3, "4": 3, "1": 4, "2": 4, "9": 5, "0": 5};
  const month = firstMonth[ending] + (semester === 2 ? 6 : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {start: `${year}-${String(month).padStart(2, "0")}-01`, end: `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`, ending};
}
