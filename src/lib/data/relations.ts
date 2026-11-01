// Untyped PostgREST joins may be inferred as arrays. Handle either response
// shape explicitly until generated database relationship types are available.
export function oneRelated<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
