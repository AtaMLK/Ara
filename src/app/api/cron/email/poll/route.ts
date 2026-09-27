import { NextRequest, NextResponse } from 'next/server';
import { ToolError } from '@/lib/errors';
import { pollImapInbox } from '@/lib/email/imap-inbound';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await pollImapInbox());
  } catch (error) {
    if (error instanceof ToolError) {
      const status = error.code === 'VALIDATION' ? 400 : error.code === 'AUTHORIZATION' ? 401 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('IMAP polling failed', error);
    return NextResponse.json({ error: 'IMAP polling failed' }, { status: 500 });
  }
}
