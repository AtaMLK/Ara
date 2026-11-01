import { z } from 'zod';

export const optionalIsoDate = z.preprocess(
  value => value === '' ? undefined : value,
  z.iso.date().optional(),
);

export function localRedirectUrl(next: string | null, origin: string): URL {
  const fallback = new URL('/', origin);
  if (!next?.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  const destination = new URL(next, origin);
  return destination.origin === fallback.origin ? destination : fallback;
}
