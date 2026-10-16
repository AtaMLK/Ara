type ModelResult = {
  source_url: string | null;
  source_name?: string | null;
  finding?: string | null;
  structured_data?: Record<string, unknown> | null;
};

/** Re-scope explicit model evidence, never a supplier's entire catalog by assumption. */
export function exactModelResults<T extends ModelResult>(results: T[], models: string[], requirementId: string): T[] {
  const patterns = models.filter(model => model.trim().length >= 3).map(model => {
    const escaped = model.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  });
  if (!patterns.length) return [];
  return results.filter(result => {
    const text = [result.source_url, result.finding, result.structured_data?.title].join(' ');
    return patterns.every(pattern => pattern.test(text));
  }).map(result => ({
    ...result,
    structured_data: { ...result.structured_data, arat_requirement_id: requirementId },
  }));
}
