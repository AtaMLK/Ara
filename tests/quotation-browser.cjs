const {chromium}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://localhost:3000/customer/inquiries/f6fc2f0f-3e5e-481b-b79d-58663a749bb6');
    await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor();
    assert.ok(page.url().includes('/login?next='));
    assert.equal(new URL(page.url()).searchParams.get('next'),'/customer/inquiries/f6fc2f0f-3e5e-481b-b79d-58663a749bb6');
    const download=await page.request.get('http://localhost:3000/api/quotes/8359c144-ae57-45ee-bcdd-ba020fc58c78/pdf');
    assert.equal(download.status(),401);
    const dir=path.resolve('test-results/quotation-browser');fs.mkdirSync(dir,{recursive:true});
    await page.setContent(fs.readFileSync('output/pdf/Quotation-AM-20261010-Q1.html','utf8'));
    assert.equal(await page.getByRole('columnheader',{name:'Delivery',exact:true}).count(),1);
    assert.equal(await page.getByText('Quoted item',{exact:true}).count(),0);
    await page.screenshot({path:path.join(dir,'email-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(dir,'email-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Browser checks passed: sign-in return path, private PDF authorization, separate item/delivery table and desktop/mobile email layout.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
