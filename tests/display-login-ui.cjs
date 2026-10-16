const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('@playwright/test');
const dir=path.resolve('test-results/display-login');fs.mkdirSync(dir,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'light'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000/login');assert.equal(await page.locator('html').getAttribute('lang'),'en');
 await page.getByLabel('Email',{exact:true}).fill('no-send@example.invalid');await page.locator('.language-toggle').click();
 assert.equal(await page.getByRole('heading',{name:'Giriş yap'}).count(),1);assert.equal(await page.getByLabel('E-posta',{exact:true}).inputValue(),'no-send@example.invalid');
 await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'tr');
 await page.locator('.theme-toggle').click();await page.locator('html[data-theme="dark"]').waitFor();await page.reload();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.deepEqual(await page.evaluate(require('./helpers/contrast-audit.cjs')),[]);
 await page.screenshot({path:path.join(dir,'turkish-dark-mobile.png'),fullPage:true});
 await page.locator('.language-toggle').click();await page.locator('.theme-toggle').click();await page.locator('html[lang="en"][data-theme="light"]').waitFor();
 await page.screenshot({path:path.join(dir,'english-light-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 console.log('Login display passed: primary English, Turkish, reload persistence, input preservation, light/dark and mobile contrast. No sign-in or email sent.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
