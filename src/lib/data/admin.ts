import 'server-only';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type DashboardData = {
  needsAttention: number;
  openInquiries: number;
  pendingRfqs: number;
  quotesAwaitingApproval: number;
  recentActivity: Array<{
    id: string;
    eventType: string;
    actorType: string;
    createdAt: string;
    inquiryId: string;
  }>;
};

export async function requireAdminPage() {
  try {
    return await requireAdmin();
  } catch {
    redirect('/login');
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const { supabase } = await requireAdminPage();

  const [
    inquiries,
    rfqs,
    quotes,
    tasks,
    alerts,
    activity,
  ] = await Promise.all([
    supabase.from('inquiries').select('id', { count: 'exact', head: true })
      .in('status', ['processing', 'open', 'clarification_required', 'researching', 'rfq', 'quoting']),
    supabase.from('rfqs').select('id', { count: 'exact', head: true })
      .in('status', ['draft', 'pending_approval']),
    supabase.from('customer_quotes').select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval'),
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
    supabase.from('ai_alerts').select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
    supabase.from('timeline_events')
      .select('id,event_type,actor_type,created_at,inquiry_id')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  if (activity.error) throw activity.error;

  return {
    needsAttention: (tasks.count ?? 0) + (alerts.count ?? 0) + (rfqs.count ?? 0) + (quotes.count ?? 0),
    openInquiries: inquiries.count ?? 0,
    pendingRfqs: rfqs.count ?? 0,
    quotesAwaitingApproval: quotes.count ?? 0,
    recentActivity: (activity.data ?? []).map((item) => ({
      id: item.id,
      eventType: item.event_type,
      actorType: item.actor_type,
      createdAt: item.created_at,
      inquiryId: item.inquiry_id,
    })),
  };
}

export async function listInquiries(search?: string, status?: string) {
  const { supabase } = await requireAdminPage();
  let query = supabase
    .from('inquiries')
    .select('id,reference,title,status,priority,current_version,created_at,updated_at,deleted_at,customers(name,company_name)')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) {
    const q = search.trim().replace(/,/g, ' ');
    query = query.or(`reference.ilike.%${q}%,title.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listSuppliers(search?: string, status?: string) {
  await requireAdminPage();
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from('suppliers')
    .select('id,legal_name,primary_country,primary_email_id,primary_phone_id,primary_address_id,status,supplier_type,verification_status,updated_at,deleted_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) query = query.ilike('legal_name', `%${search.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const emailIds = rows.map((row) => row.primary_email_id).filter(Boolean);
  const phoneIds = rows.map((row) => row.primary_phone_id).filter(Boolean);
  const addressIds = rows.map((row) => row.primary_address_id).filter(Boolean);

  const [{ data: emails }, { data: phones }, { data: addresses }] = await Promise.all([
    emailIds.length ? supabase.from('supplier_emails').select('id,email').in('id', emailIds) : Promise.resolve({ data: [] as Array<{ id: string; email: string }> }),
    phoneIds.length ? supabase.from('supplier_phones').select('id,phone').in('id', phoneIds) : Promise.resolve({ data: [] as Array<{ id: string; phone: string }> }),
    addressIds.length ? supabase.from('supplier_addresses').select('id,address').in('id', addressIds) : Promise.resolve({ data: [] as Array<{ id: string; address: string }> }),
  ]);

  const emailMap = new Map((emails ?? []).map((item) => [item.id, item.email]));
  const phoneMap = new Map((phones ?? []).map((item) => [item.id, item.phone]));
  const addressMap = new Map((addresses ?? []).map((item) => [item.id, item.address]));

  return rows.map((row) => ({
    ...row,
    primary_email: row.primary_email_id ? { email: emailMap.get(row.primary_email_id) ?? null } : null,
    primary_phone: row.primary_phone_id ? { phone: phoneMap.get(row.primary_phone_id) ?? null } : null,
    primary_address: row.primary_address_id ? { address: addressMap.get(row.primary_address_id) ?? null } : null,
  }));
}

export async function listRfqs(search?: string, status?: string) {
  const { user } = await requireAdminPage();
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from('rfqs')
    .select('id,rfq_code,status,subject,body,recipient_email,created_at,sent_at,inquiry_id,supplier_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) query = query.ilike('subject', `%${search.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const inquiryIds = rows.map((row) => row.inquiry_id).filter(Boolean);
  const supplierIds = rows.map((row) => row.supplier_id).filter(Boolean);

  const [{ data: inquiries }, { data: suppliers }, { data: notifications }, { data: replies }] = await Promise.all([
    inquiryIds.length
      ? supabase.from('inquiries').select('id,reference,title,original_customer_text').in('id', inquiryIds)
      : Promise.resolve({ data: [] as Array<{ id: string; reference: string; title: string }> }),
    supplierIds.length
      ? supabase.from('suppliers').select('id,legal_name').in('id', supplierIds)
      : Promise.resolve({ data: [] as Array<{ id: string; legal_name: string }> }),
    rows.length
      ? supabase.from('notifications').select('id,record_id,title,message,priority,read_at,created_at').eq('user_id', user.id).eq('record_type', 'rfq').in('record_id', rows.map((row) => row.id)).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    rows.length
      ? supabase.from('communications').select('id,rfq_id,subject,body,received_at,created_at,metadata').eq('direction', 'incoming').eq('channel', 'email').in('rfq_id', rows.map((row) => row.id)).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  const inquiryMap = new Map((inquiries ?? []).map((item) => [item.id, item]));
  const supplierMap = new Map((suppliers ?? []).map((item) => [item.id, item]));
  const notificationMap = new Map<string, (typeof notifications)[number]>();
  for (const notification of notifications ?? []) {
    if (!notificationMap.has(notification.record_id)) notificationMap.set(notification.record_id, notification);
  }
  const replyMap = new Map<string, (typeof replies)[number]>();
  for (const reply of replies ?? []) {
    if (!replyMap.has(reply.rfq_id)) replyMap.set(reply.rfq_id, reply);
  }

  const { data: conversationRows } = rows.length
    ? await supabase.from('communications')
        .select('id,rfq_id,supplier_id,direction,subject,body,received_at,sent_at,created_at,metadata')
        .eq('channel', 'email')
        .in('rfq_id', rows.map((row) => row.id))
        .order('created_at', { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  const conversationMap = new Map<string, Array<Record<string, unknown>>>();
  for (const message of conversationRows ?? []) {
    if (!message.rfq_id) continue;
    const list = conversationMap.get(message.rfq_id) ?? [];
    list.push(message);
    conversationMap.set(message.rfq_id, list);
  }

  return rows.map((row) => ({
    ...row,
    inquiries: row.inquiry_id ? inquiryMap.get(row.inquiry_id) ?? null : null,
    suppliers: row.supplier_id ? supplierMap.get(row.supplier_id) ?? null : null,
    supplierNotification: notificationMap.get(row.id) ?? null,
    supplierReply: replyMap.get(row.id) ?? null,
    conversation: conversationMap.get(row.id) ?? [],
  }));
}

export async function listSupplierRfqs(supplierId: string) {
  await requireAdminPage();
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('rfqs')
    .select('id,rfq_code,status,subject,body,recipient_email,created_at,sent_at')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}

export async function listSupplierRfqsBySupplierIds(supplierIds: string[]) {
  await requireAdminPage();
  const supabase = createSupabaseAdminClient();
  if (!supplierIds.length) return new Map<string, Array<Record<string, unknown>>>();

  const { data, error } = await supabase
    .from('rfqs')
    .select('id,rfq_code,status,subject,body,recipient_email,created_at,sent_at,supplier_id,inquiry_id')
    .in('supplier_id', supplierIds)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;

  const rfqIds = (data ?? []).map((row) => row.id);
  const { data: communications } = rfqIds.length
    ? await supabase.from('communications')
        .select('id,rfq_id,supplier_id,direction,subject,body,received_at,sent_at,created_at,metadata')
        .eq('channel', 'email')
        .in('rfq_id', rfqIds)
        .order('created_at', { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  const communicationMap = new Map<string, Array<Record<string, unknown>>>();
  for (const message of communications ?? []) {
    if (!message.rfq_id) continue;
    const list = communicationMap.get(message.rfq_id) ?? [];
    list.push(message);
    communicationMap.set(message.rfq_id, list);
  }

  const map = new Map<string, Array<Record<string, unknown>>>();
  for (const row of data ?? []) {
    const list = map.get(row.supplier_id) ?? [];
    list.push({ ...row, conversation: (communicationMap.get(row.id) ?? []).filter((message) => message.supplier_id === row.supplier_id) });
    map.set(row.supplier_id, list);
  }
  return map;
}

export async function listCustomerQuotes(search?: string, status?: string) {
  const { supabase } = await requireAdminPage();
  let query = supabase
    .from('customer_quotes')
    .select('id,reference,status,currency,valid_until,created_at,updated_at,customers(name,company_name)')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) query = query.ilike('reference', `%${search.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getCustomerQuote(id: string) {
  const { supabase } = await requireAdminPage();
  const { data: quote, error } = await supabase
    .from('customer_quotes')
    .select('id,inquiry_id,reference,revision_number,status,currency,valid_until,subject,body,created_at,updated_at,customers(name,company_name),parent_quote_id')
    .eq('id', id)
    .single();

  if (error || !quote) throw new Error('Customer quote not found');

  const { data: items, error: itemError } = await supabase
    .from('customer_quote_items')
    .select('id,product_id,supplier_quote_id,quantity,unit_price,total,supplier_cost,supplier_currency,price_status,pricing_rule_id,exchange_rate_id,price_calculation,supplier_products(product_name,model_part_number)')
    .eq('customer_quote_id', id)
    .order('created_at', { ascending: true });

  if (itemError) throw itemError;

  const rows = items ?? [];
  const { data: revisionRequest } = await supabase
    .from('quote_revision_requests')
    .select('id,quote_id,reason,free_text,status,requested_by,created_at')
    .eq('quote_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ...quote,
    items: rows,
    confirmedItemCount: rows.filter((item) => item.price_status === 'admin_confirmed').length,
    revisionRequest,
  };
}

export async function listQuoteRevisionRequests() {
  const { supabase } = await requireAdminPage();

  const { data, error } = await supabase
    .from('quote_revision_requests')
    .select(`
      id,
      quote_id,
      reason,
      free_text,
      status,
      requested_by,
      created_at,
      customer_quotes(
        id,
        reference,
        revision_number,
        status,
        customers(name,company_name)
      )
    `)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}

export async function listNotifications() {
  const { supabase, user } = await requireAdminPage();
  const { data, error } = await supabase
    .from('notifications')
    .select('id,category,priority,title,message,record_type,record_id,action_url,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;
  return data ?? [];
}
