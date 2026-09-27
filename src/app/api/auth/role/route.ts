import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ destination: '/login' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role,status')
    .eq('user_id', user.id)
    .single();

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ destination: '/login' }, { status: 403 });
  }

  if (profile.role === 'admin') {
    return NextResponse.json({ destination: '/' });
  }

  if (profile.role === 'customer') {
    const { data: customer } = await supabase
      .from('customers')
      .select('id,status')
      .eq('user_id', user.id)
      .single();

    if (customer?.status === 'active') {
      return NextResponse.json({ destination: '/customer' });
    }
  }

  return NextResponse.json({ destination: '/login' }, { status: 403 });
}
