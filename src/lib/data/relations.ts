/** Normalize a to-one embedded relation from typed or untyped Supabase clients. */
export function oneRelated<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
