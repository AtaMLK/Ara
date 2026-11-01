export function supplierNameIssue(name: string): string | null {
  const value = name.trim();
  if (value.length < 2) return 'Enter the supplier company name.';
  if (value.length > 160 || value.split(/\s+/).length > 14) return 'A search result or paragraph cannot be used as a company name.';
  if (/(^|\s)(we are|this is|the (single|dual|quadruple)|product categories)(\s|$)/i.test(value)) return 'Use the company name rather than a sentence fragment.';
  if (/^[a-z]{1,4}[- ]?\d{3,}[a-z0-9-]*$/i.test(value)) return 'A product code cannot be used as a company name.';
  if (/^(repeater power|transmitter power|single channel repeater power|dual channel repeater power)$/i.test(value)) return 'A product category cannot be used as a company name.';
  if (/(dual.output accelerometer|top exit|loop.powered digital|analog input module)/i.test(value)) return 'Use the supplier company name rather than a product description.';
  return null;
}
