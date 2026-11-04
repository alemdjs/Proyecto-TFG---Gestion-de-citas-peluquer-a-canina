// Horario negocio: L-S 10:00-19:00 (Europa/Madrid asumido en local del servidor).
export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 19;
export const SLOT_STEP_MIN = 30;

export function isBusinessDay(d: Date): boolean {
  // 0 = domingo cerrado
  const day = d.getDay();
  return day >= 1 && day <= 6;
}

export function dayBounds(dateStr: string): { open: Date; close: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const open = new Date(y, m - 1, d, OPEN_HOUR, 0, 0, 0);
  const close = new Date(y, m - 1, d, CLOSE_HOUR, 0, 0, 0);
  return { open, close };
}

export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
