import type { Scalar, SourceRecord } from "./schema.js";

export interface FieldProfile {
  field: string;
  total: number;
  blank: number;
  distinct: number;
  minLength: number | null;
  maxLength: number | null;
  /** Most frequent values, most common first (ties broken alphabetically for determinism). */
  topValues: { value: string; count: number }[];
  /** Value "shapes": digits → 9, letters → a, e.g. `99/99/9999` or `+99 99999 99999`. */
  patterns: { pattern: string; count: number; example: string }[];
}

const shape = (s: string) => s.replace(/\p{L}+/gu, "a").replace(/\d/g, "9");

/** Entries sorted by count desc, then key asc, so output never depends on insertion order. */
function ranked<T extends { count: number }>(map: Map<string, T>, limit: number): [string, T][] {
  return [...map.entries()].sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0)).slice(0, limit);
}

export function profileField(records: SourceRecord[], field: string, limit = 25): FieldProfile {
  const values = new Map<string, { count: number }>();
  const patterns = new Map<string, { count: number; example: string }>();
  let blank = 0;
  let minLength: number | null = null;
  let maxLength: number | null = null;

  for (const r of records) {
    const raw: Scalar = r[field] ?? null;
    if (raw === null || String(raw).trim() === "") {
      blank++;
      continue;
    }
    const s = String(raw);
    values.set(s, { count: (values.get(s)?.count ?? 0) + 1 });
    const p = shape(s);
    const prev = patterns.get(p);
    patterns.set(p, { count: (prev?.count ?? 0) + 1, example: prev?.example ?? s });
    minLength = Math.min(minLength ?? s.length, s.length);
    maxLength = Math.max(maxLength ?? s.length, s.length);
  }

  return {
    field,
    total: records.length,
    blank,
    distinct: values.size,
    minLength,
    maxLength,
    topValues: ranked(values, limit).map(([value, v]) => ({ value, count: v.count })),
    patterns: ranked(patterns, 12).map(([pattern, v]) => ({ pattern, ...v })),
  };
}
