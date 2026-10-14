/** Match a reported contact fact against the evidence supplied to the agent. */
export function isPublishedContact(value: string | undefined, evidence: string[]) {
  if (!value?.trim()) return false;
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  return evidence.some((text) => normalize(text).includes(normalize(value)));
}

export function extractPublishedEmails(text: string): string[] {
  return [...new Set((text.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
    .map((email) => email.toLowerCase()))];
}

export function sameWebsiteHost(url: string, hostname: string) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.hostname.toLowerCase().replace(/^www\./, '') === hostname.toLowerCase().replace(/^www\./, '');
  } catch { return false; }
}
