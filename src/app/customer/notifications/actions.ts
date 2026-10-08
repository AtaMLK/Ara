'use server';

import { revalidatePath } from 'next/cache';
import { requireCustomerAccess } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function markCustomerNotificationReadAction(notificationId: string) {
  const { customer } = await requireCustomerAccess();
  const supabase = createSupabaseAdminClient();
  const { data: notification } = await supabase
    .from('notifications')
    .select('id,user_id')
    .eq('id', notificationId)
    .eq('user_id', customer.user_id)
    .maybeSingle();

  if (!notification) return { ok: false };

  await supabase.from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', customer.user_id);

  revalidatePath('/customer');
  revalidatePath('/customer/notifications');
  return { ok: true };
}
