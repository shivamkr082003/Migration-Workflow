import { z } from "zod";

/** Value types the engine understands. Dates are carried as `YYYY-MM-DD` strings. */
export const FieldType = z.enum(["string", "integer", "decimal", "boolean", "date", "enum"]);
export type FieldType = z.infer<typeof FieldType>;

export const SourceField = z.object({
  name: z.string().min(1),
  type: FieldType,
  description: z.string().default(""),
});
export type SourceField = z.infer<typeof SourceField>;

export const SourceSchema = z.object({
  entity: z.string().min(1),
  description: z.string().default(""),
  primaryKey: z.string().min(1),
  fields: z.array(SourceField).min(1),
});
export type SourceSchema = z.infer<typeof SourceSchema>;

export const TargetField = z.object({
  name: z.string().min(1),
  type: FieldType,
  required: z.boolean(),
  description: z.string().default(""),
  pattern: z.string().optional(),
  format: z.enum(["email"]).optional(),
  enum: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().positive().optional(),
});
export type TargetField = z.infer<typeof TargetField>;

export const TargetSchema = z
  .object({
    entity: z.string().min(1),
    description: z.string().default(""),
    primaryKey: z.string().min(1),
    fields: z.array(TargetField).min(1),
  })
  .superRefine((schema, ctx) => {
    if (!schema.fields.some((f) => f.name === schema.primaryKey)) {
      ctx.addIssue({ code: "custom", message: `primaryKey "${schema.primaryKey}" is not a declared field` });
    }
    for (const f of schema.fields) {
      if (f.type === "enum" && !f.enum?.length) {
        ctx.addIssue({ code: "custom", message: `enum field "${f.name}" must list its values` });
      }
    }
  });
export type TargetSchema = z.infer<typeof TargetSchema>;

/** Hard cap on how many source records one migration may process. Documented in the README. */
export const MAX_SAMPLE_SIZE = 500;

export type Scalar = string | number | boolean | null;
export type SourceRecord = Record<string, Scalar>;

export function parseSourceRecords(schema: SourceSchema, raw: unknown): SourceRecord[] {
  const shape = Object.fromEntries(
    schema.fields.map((f) => [f.name, z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()]),
  );
  const records = z.array(z.object(shape).strict()).parse(raw) as SourceRecord[];
  if (records.length > MAX_SAMPLE_SIZE) {
    throw new Error(`Sample has ${records.length} records; the maximum supported is ${MAX_SAMPLE_SIZE}.`);
  }
  return records.map((r) => Object.fromEntries(schema.fields.map((f) => [f.name, r[f.name] ?? null])));
}
