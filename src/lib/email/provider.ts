import 'server-only';
import type {EmailProvider} from './types';
import {ToolError} from '@/lib/errors';

export function getEmailProvider():EmailProvider{
  // Provider selection is intentionally isolated. A concrete adapter can be
  // added without changing RFQ/Quote workflows or historical records.
  throw new ToolError('TRANSIENT','No email provider adapter configured');
}
