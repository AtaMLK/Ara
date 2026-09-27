import 'server-only';

import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ToolError } from '@/lib/errors';

export type ParsedDocument = {
  extractedText: string;
  extractedData: Record<string, unknown>;
  qualityFlags: string[];
};

function csvOrSheetText(bytes: Uint8Array): ParsedDocument {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    return { name, rows };
  });
  const extractedText = sheets.map((sheet) =>
    [
      `SHEET: ${sheet.name}`,
      ...sheet.rows.map((row) => row.map((cell) => String(cell ?? '')).join(' | ')),
    ].join('\n'),
  ).join('\n\n');

  return {
    extractedText: extractedText.slice(0, 120000),
    extractedData: { sheets },
    qualityFlags: [],
  };
}

export async function downloadInquiryFile(storagePath: string): Promise<Uint8Array> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from('inquiry-files').download(storagePath);
  if (error || !data) throw new ToolError('NOT_FOUND', 'Inquiry file could not be downloaded');
  return new Uint8Array(await data.arrayBuffer());
}

export async function parseInquiryFile(
  bytes: Uint8Array,
  mimeType: string,
  originalName: string,
): Promise<ParsedDocument> {
  if (mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf')) {
    const result = await pdfParse(Buffer.from(bytes));
    return {
      extractedText: result.text.slice(0, 120000),
      extractedData: { pages: result.numpages },
      qualityFlags: result.text.trim() ? [] : ['EMPTY_TEXT_POSSIBLE_SCANNED_PDF'],
    };
  }

  if (
    mimeType.includes('spreadsheet') ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv' ||
    /\.(xlsx?|csv)$/i.test(originalName)
  ) {
    return csvOrSheetText(bytes);
  }

  if (mimeType.startsWith('image/')) {
    return {
      extractedText: '',
      extractedData: {},
      qualityFlags: ['OCR_REQUIRED'],
    };
  }

  throw new ToolError('VALIDATION', `Unsupported document type: ${mimeType}`);
}
