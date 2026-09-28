import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  // Prefer the authenticated session from the request cookies, but accept an
  // explicit Bearer token from the login flow to avoid cookie/session races.
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;

  const { data: userData, error: userError } = accessToken
    ? await supabase.auth.getUser(accessToken)
    : await supabase.auth.getUser();

  if (userError || !userData.user) {
    return NextResponse.json(
      {
        destination: '/login',
        reason: 'not_authenticated',
        detail: userError?.message ?? 'No authenticated user',
      },
      { status: 401 },
    );
  }

  const user = userData.user;
  const admin = createSupabaseAdminClient();

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role,status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[auth/role] profile lookup failed', {
      userId: user.id,
      code: profileError.code,
      message: profileError.message,
      details: profileError.details,
      hint: profileError.hint,
    });

    return NextResponse.json(
      {
        destination: '/login',
        reason: 'profile_lookup_failed',
        detail: profileError.message,
      },
      { status: 500 },
    );
  }

  if (!profile) {
    return NextResponse.json(
      { destination: '/login', reason: 'profile_not_found' },
      { status: 403 },
    );
  }

  if (profile.status !== 'active') {
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
      .maybeSingle();

    if (customerError) {
      console.error('[auth/role] customer lookup failed', {
        userId: user.id,
        code: customerError.code,
        message: customerError.message,
        details: customerError.details,
        hint: customerError.hint,
      });

      return NextResponse.json(
        {
          destination: '/login',
          reason: 'customer_lookup_failed',
          detail: customerError.message,
        },
        { status: 500 },
      );
    }

    if (!customer) {
      return NextResponse.json(
        { destination: '/login', reason: 'customer_not_found' },
        { status: 403 },
      );
    }

    if (customer.status === 'active') {
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
