const SPANISH_MONTHS: Record<string, number> = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
  noviembre: 10, diciembre: 11,
};

/** Popular: "11/09/2026" (no time) */
export function parseDdMmYyyy(s: string): Date | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

/** BHD: "18/09/2026 03:11 pm" (12-hour) */
export function parseDdMmYyyy12h(s: string): Date | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return parseDdMmYyyy(s);
  let hour = +m[4] % 12;
  if (m[6].toLowerCase() === 'pm') hour += 12;
  return new Date(+m[3], +m[2] - 1, +m[1], hour, +m[5]);
}

/** Santa Cruz: "21/9/2026 12:32:21" (unpadded, 24-hour) */
export function parseDMyHms(s: string): Date | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return parseDdMmYyyy(s);
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
}

/** Banreservas: "18 de Septiembre 2026 - 11:52 AM" */
export function parseSpanishLongDate(s: string): Date | null {
  const m = s.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
  if (!m) return null;
  const month = SPANISH_MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  let hour = m[4] ? +m[4] % 12 : 0;
  if (m[6]?.toUpperCase() === 'PM') hour += 12;
  return new Date(+m[3], month, +m[1], hour, m[5] ? +m[5] : 0);
}
