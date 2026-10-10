export const DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "DD-MM-YYYY",
  "MM-DD-YYYY",
  "MMM D YYYY",
  "D MMM YYYY",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

type Parts = { y: number; m: number; d: number };

const PARSERS: Record<DateFormat, (s: string) => Parts | null> = {
  "YYYY-MM-DD": (s) => numeric(s, /^(\d{4})-(\d{1,2})-(\d{1,2})$/, [1, 2, 3]),
  "YYYY/MM/DD": (s) => numeric(s, /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, [1, 2, 3]),
  "DD/MM/YYYY": (s) => numeric(s, /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, [3, 2, 1]),
  "MM/DD/YYYY": (s) => numeric(s, /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, [3, 1, 2]),
  "DD-MM-YYYY": (s) => numeric(s, /^(\d{1,2})-(\d{1,2})-(\d{4})$/, [3, 2, 1]),
  "MM-DD-YYYY": (s) => numeric(s, /^(\d{1,2})-(\d{1,2})-(\d{4})$/, [3, 1, 2]),
  "MMM D YYYY": (s) => {
    const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
    return m ? named(m[3]!, m[1]!, m[2]!) : null;
  },
  "D MMM YYYY": (s) => {
    const m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$/.exec(s);
    return m ? named(m[3]!, m[2]!, m[1]!) : null;
  },
};

function numeric(s: string, re: RegExp, [yi, mi, di]: [number, number, number]): Parts | null {
  const m = re.exec(s);
  if (!m) return null;
  return { y: Number(m[yi]), m: Number(m[mi]), d: Number(m[di]) };
}

function named(y: string, mon: string, d: string): Parts | null {
  const idx = MONTHS.indexOf(mon.toLowerCase());
  return idx < 0 ? null : { y: Number(y), m: idx + 1, d: Number(d) };
}

function isRealDate({ y, m, d }: Parts): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const iso = ({ y, m, d }: Parts) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type DateParseResult =
  | { kind: "ok"; value: string; format: DateFormat }
  | { kind: "ambiguous"; candidates: { format: DateFormat; value: string }[] }
  | { kind: "invalid_calendar_date"; format: DateFormat }
  | { kind: "no_match" };

/**
 * Tries every configured format. Returns `ambiguous` when two formats yield different
 * real dates (e.g. 04/03/2021 under DD/MM and MM/DD) so the caller can refuse to guess.
 */
export function parseDate(input: string, formats: readonly DateFormat[]): DateParseResult {
  const s = input.trim();
  const matches: { format: DateFormat; value: string }[] = [];
  let invalidFormat: DateFormat | null = null;
  for (const format of formats) {
    const parts = PARSERS[format](s);
    if (!parts) continue;
    if (!isRealDate(parts)) {
      invalidFormat ??= format;
      continue;
    }
    const value = iso(parts);
    if (!matches.some((x) => x.value === value)) matches.push({ format, value });
  }
  if (matches.length === 1) return { kind: "ok", ...matches[0]! };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  if (invalidFormat) return { kind: "invalid_calendar_date", format: invalidFormat };
  return { kind: "no_match" };
}
