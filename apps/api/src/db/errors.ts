import { DatabaseError } from "pg";

/** Drizzle may wrap driver errors; look through `cause` for the Postgres error code. */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if (e instanceof DatabaseError) return e.code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === "23505";
