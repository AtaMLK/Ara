import type { ReactNode } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import CustomerNotificationCenter, { type CustomerNotificationDetail, type CustomerNotificationItem } from './notifications/notification-center';

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let unreadCount = 0;
  let notificationItems: CustomerNotificationItem[] = [];
  let notificationDetails: Record<string, CustomerNotificationDetail> = {};

  if (user) {
    const { data: notifications } = await supabase
      .from('notifications')
      .select('id,title,message,category,priority,record_type,record_id,action_url,read_at,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    notificationItems = (notifications ?? []) as CustomerNotificationItem[];
    unreadCount = notificationItems.filter((item) => !item.read_at).length;

    const clarificationIds = notificationItems.filter((item) => item.record_type === 'clarification' && item.record_id).map((item) => item.record_id!);
    const quoteIds = notificationItems.filter((item) => item.record_type === 'customer_quote' && item.record_id).map((item) => item.record_id!);

    const [{ data: clarifications }, { data: quotes }] = await Promise.all([
      clarificationIds.length
        ? supabase.from('clarifications').select('id,question,status').in('id', clarificationIds)
        : Promise.resolve({ data: [] as Array<{ id: string; question: string; status: string }> }),
      quoteIds.length
        ? supabase.from('customer_quotes').select('id,reference,revision_number,status,currency,valid_until,subject,body').in('id', quoteIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);

    const { data: quoteItems } = quoteIds.length
      ? await supabase.from('customer_quote_items').select('id,customer_quote_id,quantity,unit_price,total,supplier_products(product_name,model_part_number)').in('customer_quote_id', quoteIds).order('created_at', { ascending: true })
      : { data: [] as Array<Record<string, unknown>> };

    for (const item of notificationItems) {
      if (item.record_type === 'clarification' && item.record_id) {
        const clarification = (clarifications ?? []).find((row) => row.id === item.record_id);
        notificationDetails[item.id] = { clarification: clarification ?? null };
      }

      if (item.record_type === 'customer_quote' && item.record_id) {
        const quote = (quotes ?? []).find((row) => row.id === item.record_id);
        if (!quote) continue;
        notificationDetails[item.id] = {
          quote: {
            id: quote.id as string,
            reference: quote.reference as string,
            revision_number: Number(quote.revision_number),
            status: quote.status as string,
            currency: quote.currency as string,
            valid_until: quote.valid_until as string | null,
            subject: quote.subject as string | null,
            body: quote.body as string | null,
            items: (quoteItems ?? []).filter((row) => row.customer_quote_id === quote.id).map((row) => {
              const product = Array.isArray(row.supplier_products) ? row.supplier_products[0] : row.supplier_products;
              return {
                id: row.id as string,
                quantity: Number(row.quantity),
                unit_price: Number(row.unit_price),
                total: Number(row.total),
                product_name: product?.product_name ?? null,
                model_part_number: product?.model_part_number ?? null,
              };
            }),
          },
        };
      }
    }
  }

  return (
    <div className="customer-app">
      <header className="customer-nav">
        <Link className="customer-brand" href="/customer" aria-label="ARAT Customer Portal">
          <span className="customer-brand-mark">A</span>
          <span>
            <strong>ARAT</strong>
            <small>Customer Portal</small>
          </span>
        </Link>
        <div className="customer-nav-actions">
          <div className="customer-notification-wrap">
            <CustomerNotificationCenter items={notificationItems} details={notificationDetails} />
            {unreadCount > 0 && <span className="nav-notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </div>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
