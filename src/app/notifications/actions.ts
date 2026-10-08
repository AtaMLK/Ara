'use server';

import { requireAdmin } from '@/lib/ai/guards';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function markNotificationReadAction(notificationId: string) {
  const { user } = await requireAdmin();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id);

  if (error) throw error;
  return { ok: true };
}
