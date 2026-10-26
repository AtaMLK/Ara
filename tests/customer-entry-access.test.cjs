const test = require('node:test');
const assert = require('node:assert/strict');
const createLoader = require('./helpers/load-ts.cjs');

function fixture({ user = { id: 'customer-user' }, role = 'customer', status = 'active', customerStatus = 'active' } = {}) {
  const db = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: table => {
      const query = {
        select: () => query, eq: () => query,
        single: async () => ({ data: table === 'profiles' ? { role, status } : customerStatus ? { id: 'customer', status: customerStatus } : null }),
      };
      return query;
    },
  };
  return createLoader({
    '@/lib/supabase/server': { createSupabaseServerClient: async () => db },
    'next/navigation': {
      redirect: path => { throw Error('redirect:' + path); },
      notFound: () => { throw Error('not-found'); },
    },
  })('@/lib/ai/guards').requireNewCustomerInquiryPageAccess;
}

test('new inquiry page requires login and retains its return destination', async () => {
  await assert.rejects(fixture({ user: null })(), /redirect:\/login\?next=%2Fcustomer%2Finquiries%2Fnew/);
});
test('new inquiry page admits only active customers with active customer records', async () => {
  assert.equal((await fixture()()).customer.id, 'customer');
  for (const options of [{ status: 'inactive' }, { role: 'supplier' }, { customerStatus: 'inactive' }, { customerStatus: null }]) {
    await assert.rejects(fixture(options)(), /not-found/);
  }
});
test('new inquiry page routes active Admin to the internal workflow', async () => {
  await assert.rejects(fixture({ role: 'admin' })(), /redirect:\/inquiries/);
});
