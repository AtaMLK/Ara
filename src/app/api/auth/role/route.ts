import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ destination: '/login', reason: 'not_authenticated' }, { status: 401 });

  // Use the service-role client only after the user has been authenticated.
  // This avoids RLS preventing the role router from resolving the user's own profile.
  const admin = createSupabaseAdminClient();

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role,status')
    .eq('user_id', user.id)
    .single();

  if (profileError || !profile || profile.status !== 'active') {
    return NextResponse.json(
      { destination: '/login', reason: 'profile_not_active' },
      { status: 403 },
    );
  }

  if (profile.role === 'admin') {
    return NextResponse.json({ destination: '/' });
  }

  if (profile.role === 'customer') {
    const { data: customer, error: customerError } = await admin
      .from('customers')
      .select('id,status')
      .eq('user_id', user.id)
      .single();

    if (!customerError && customer?.status === 'active') {
      return NextResponse.json({ destination: '/customer' });
    }

    return NextResponse.json(
      { destination: '/login', reason: 'customer_not_active' },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { destination: '/login', reason: 'unsupported_role' },
    { status: 403 },
  );
}
