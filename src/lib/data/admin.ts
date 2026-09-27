import 'server-only';

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/ai/guards';

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
    .select('id,reference,title,status,priority,created_at,updated_at,customers(name,company_name)')
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
  const { supabase } = await requireAdminPage();
  let query = supabase
    .from('suppliers')
    .select('id,legal_name,primary_country,status,supplier_type,verification_status,updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) {
    query = query.ilike('legal_name', `%${search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function listRfqs(search?: string, status?: string) {
  const { supabase } = await requireAdminPage();
  let query = supabase
    .from('rfqs')
    .select('id,status,subject,recipient_email,created_at,sent_at,inquiries(reference,title),suppliers(legal_name)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status && status !== 'all') query = query.eq('status', status);
  if (search?.trim()) query = query.ilike('subject', `%${search.trim()}%`);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
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
