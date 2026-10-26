// Run after build against a locally started production server. No sign-in,
// provider calls, cron authorization or business mutations are performed.
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

(async () => {
  const base = process.env.SMOKE_BASE_URL || 'http://localhost:3107';
  for (const route of ['/api/cron/workflow', '/api/cron/email/poll']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 401, `${route} must reject missing credentials`);
  }
  for (const route of ['/inquiries', '/customer/inquiries/new', '/settings']) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.ok([303, 307, 308].includes(response.status), `${route} must redirect anonymous users`);
    assert.equal(new URL(response.headers.get('location'), base).pathname, '/login');
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(base + '/login');
    assert.equal(response.status(), 200);
    await page.locator('input[type="password"]').waitFor();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(errors, [], 'Login must hydrate without client errors');
    console.log('Production smoke passed: login hydration, anonymous route redirects, protected cron rejection.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
