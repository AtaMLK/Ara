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

async function runVisionOcr(bytes: Uint8Array, mimeType: string, fileName: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_OCR_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-5.6';
  if (!apiKey) throw new ToolError('TRANSIENT', 'OPENAI_API_KEY is not configured');

  const base64 = Buffer.from(bytes).toString('base64');
  const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(fileName);

  const content = isPdf
    ? [
        { type: 'input_text', text: 'Transcribe this procurement document exactly. Preserve part numbers, quantities, dimensions, units, tables, labels, and line breaks where useful. Do not guess unreadable values. Return JSON only with extractedText and qualityFlags.' },
        { type: 'input_file', filename: fileName, file_data: `data:application/pdf;base64,${base64}` },
      ]
    : [
        { type: 'input_text', text: 'Read this procurement image exactly. Preserve part numbers, quantities, dimensions, units, labels and visible table values. Do not guess unreadable values. Return JSON only with extractedText and qualityFlags.' },
        { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'high' },
      ];

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content }],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ToolError(response.status >= 500 ? 'TRANSIENT' : 'AI_PROCESSING', `OCR provider error: ${text.slice(0, 500)}`);
  }

  const json = await response.json();
  const outputText = typeof json.output_text === 'string'
    ? json.output_text
    : json.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
        .map((item: { text?: string }) => item.text ?? '')
        .join('');

  if (!outputText) throw new ToolError('AI_PROCESSING', 'OCR provider returned no text');

  let parsed: { extractedText?: unknown; qualityFlags?: unknown };
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new ToolError('AI_PROCESSING', 'OCR provider returned invalid JSON');
  }

  const extractedText = typeof parsed.extractedText === 'string' ? parsed.extractedText : '';
  const qualityFlags = Array.isArray(parsed.qualityFlags)
    ? parsed.qualityFlags.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    extractedText: extractedText.slice(0, 120000),
    qualityFlags,
  };
}

export async function parseInquiryFile(
  bytes: Uint8Array,
  mimeType: string,
  originalName: string,
): Promise<ParsedDocument> {
  if (mimeType === 'application/pdf' || originalName.toLowerCase().endsWith('.pdf')) {
    const result = await pdfParse(Buffer.from(bytes));
    if (result.text.trim()) {
      return {
        extractedText: result.text.slice(0, 120000),
        extractedData: { pages: result.numpages },
        qualityFlags: [],
      };
    }

    const ocr = await runVisionOcr(bytes, 'application/pdf', originalName);
    return {
      extractedText: ocr.extractedText,
      extractedData: { pages: result.numpages, ocr: true },
      qualityFlags: ['OCR_USED', ...ocr.qualityFlags],
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
    const ocr = await runVisionOcr(bytes, mimeType, originalName);
    return {
      extractedText: ocr.extractedText,
      extractedData: { ocr: true },
      qualityFlags: ['OCR_USED', ...ocr.qualityFlags],
    };
  }

  throw new ToolError('VALIDATION', `Unsupported document type: ${mimeType}`);
}
