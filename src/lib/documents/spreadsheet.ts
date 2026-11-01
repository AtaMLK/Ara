import * as XLSX from 'xlsx';

const MAX_ROWS = 2000;
const MAX_COLUMNS = 128;
const MAX_CELLS = 50_000;
const MAX_CHARACTERS = 500_000;

export function parseSpreadsheet(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Spreadsheet must be between 1 byte and 10 MB');
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, sheetRows: MAX_ROWS + 1 });
  const sheets: Array<{ name: string; rows: string[][] }> = [];
  let cellsLeft = MAX_CELLS;
  let charactersLeft = MAX_CHARACTERS;
  let truncated = workbook.SheetNames.length > 20;
  for (const name of workbook.SheetNames.slice(0, 20)) {
    if (cellsLeft <= 0 || charactersLeft <= 0) { truncated = true; break; }
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) { sheets.push({ name, rows: [] }); continue; }
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const original = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
    const width = Math.min(MAX_COLUMNS, range.e.c - range.s.c + 1);
    const height = Math.min(MAX_ROWS, range.e.r - range.s.r + 1, Math.floor(cellsLeft / width));
    if (width <= 0 || height <= 0) { truncated = true; break; }
    const bounded = { s: range.s, e: { c: range.s.c + width - 1, r: range.s.r + height - 1 } };
    if (bounded.e.c < original.e.c || bounded.e.r < original.e.r) truncated = true;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', range: bounded });
    const rows = raw.map(row => row.map(cell => {
      const text = cell instanceof Date ? cell.toISOString() : String(cell ?? '');
      const value = text.slice(0, Math.min(10_000, charactersLeft));
      if (value.length < text.length) truncated = true;
      charactersLeft -= value.length;
      return value;
    }));
    cellsLeft -= width * height;
    sheets.push({ name, rows });
  }
  const text = sheets.map(sheet => [`SHEET: ${sheet.name}`, ...sheet.rows.map(row => row.join(' | '))].join('\n')).join('\n\n');
  if (text.length > 120_000) truncated = true;
  return { extractedText: text.slice(0,120_000), extractedData: { sheets }, qualityFlags: truncated ? ['SPREADSHEET_TRUNCATED'] : [] };
}
