// Real local-app UI audit using disposable accounts/records; never sends email.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {chromium}=require('@playwright/test');
require('@next/env').loadEnvConfig(process.cwd());
const db=require('./helpers/load-ts.cjs')()('@/lib/supabase/admin').createSupabaseAdminClient();
const dir=path.resolve('test-results/portal-audit');fs.mkdirSync(dir,{recursive:true});
const run=randomBytes(4).toString('hex'),password=randomBytes(24).toString('base64url')+'aA1!';
const users=[],customers=[],inquiries=[],suppliers=[],findings=[],errors=[];let browser;
const check=async(name,fn)=>{try{await fn();findings.push({name,status:'passed'});console.log('PASS '+name);return true;}catch(e){findings.push({name,status:'failed',error:e.message});console.log('FAIL '+name+': '+e.message.split('\n')[0]);return false;}};
async function insert(table,value){const r=await db.from(table).insert(value).select().single();if(r.error)throw Error(table+': '+r.error.message);return r.data;}
async function account(role,index){
 const email=`arat-qa-${run}-${role}${index}@example.invalid`;
 const r=await db.auth.admin.createUser({email,password,email_confirm:true});if(r.error)throw r.error;const id=r.data.user.id;users.push(id);
 const p=await db.from('profiles').upsert({user_id:id,role,status:'active',display_name:'ARAT QA '+run},{onConflict:'user_id'});if(p.error)throw p.error;
 let customer;if(role==='customer'){customer=await insert('customers',{user_id:id,customer_code:'QA-'+run+'-'+index,customer_type:'company',name:'QA Customer '+run,company_name:'ARAT QA '+run,email,country:'Turkey',status:'active'});customers.push(customer.id);}
 return {id,email,customer};
}
async function quote(customer,status='sent',tag='test'){
 const inquiry=await insert('inquiries',{customer_id:customer.id,reference:'AO-20261015-'+randomBytes(3).toString('hex').toUpperCase(),title:'ARAT QA '+run+' '+tag,status:'quoting',normalized_information:{submitted_items:[{description:'QA temperature sensor',partNumber:'QA-HS421T',brand:'QA Brand',quantity:150}]},original_customer_text:'QA temperature sensor, 150 pcs'});inquiries.push(inquiry.id);
 const q=await insert('customer_quotes',{inquiry_id:inquiry.id,customer_id:customer.id,reference:inquiry.reference+'-Q1',status,currency:'EUR',subject:'Quotation '+inquiry.reference+'-Q1',sent_at:status==='sent'?new Date().toISOString():null,valid_until:'2026-11-15'});
 const line=await insert('customer_quote_items',{customer_quote_id:q.id,description:'QA temperature sensor',model:'QA-HS421T',brand:'QA Brand',delivery_text:'2 weeks',quantity:150,unit_price:status==='draft'?null:225,price_status:status==='draft'?'suggested':'admin_confirmed',supplier_cost:175,supplier_currency:'EUR',price_calculation:{commercial:{net:175,gross:210,taxRate:20,taxMode:'excluded',leadTime:{min:2,max:2,unit:'weeks',original:'two weeks',businessDays:false}}}});
 return {inquiry,q,line};
}
async function login(context,account,next){const page=await context.newPage();page.on('pageerror',e=>errors.push({url:page.url(),message:e.message}));await page.goto('http://localhost:3000/login'+(next?'?next='+encodeURIComponent(next):''));await page.getByLabel('Email',{exact:true}).fill(account.email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(u=>u.pathname!=='/login',{timeout:25000});return page;}
async function body(page){return page.locator('body').innerText();}
async function waitStatus(id,status){for(let i=0;i<30;i++){const {data}=await db.from('customer_quotes').select('status').eq('id',id).single();if(data?.status===status)return;await new Promise(r=>setTimeout(r,200));}throw Error('Quote did not reach '+status);}
async function cleanup(){
 const qs=inquiries.length?(await db.from('customer_quotes').select('id,parent_quote_id').in('inquiry_id',inquiries)).data||[]:[];
 async function del(table,column,ids){if(!ids.length)return;const r=await db.from(table).delete().in(column,ids);if(r.error)throw Error('Cleanup '+table+': '+r.error.message);}
 await del('notifications','record_id',qs.map(q=>q.id));
 if(qs.length){const {data:documents}=await db.from('supplier_order_confirmations').select('snapshot').in('customer_quote_id',qs.map(q=>q.id));const paths=(documents??[]).map(row=>row.snapshot?.pdf_path).filter(Boolean);if(paths.length){const r=await db.storage.from('supplier-email-attachments').remove(paths);if(r.error)throw r.error;}}
 await del('supplier_order_confirmations','customer_quote_id',qs.map(q=>q.id));
 await del('notifications','user_id',users);await del('audit_logs','actor_user_id',users);
 await del('quote_revision_requests','quote_id',qs.map(q=>q.id));await del('customer_quote_items','customer_quote_id',qs.map(q=>q.id));
 await del('timeline_events','inquiry_id',inquiries);await del('ai_executions','inquiry_id',inquiries);
 await del('customer_quotes','id',qs.filter(q=>q.parent_quote_id).map(q=>q.id));await del('customer_quotes','id',qs.filter(q=>!q.parent_quote_id).map(q=>q.id));
 await del('supplier_quotes','supplier_response_id',(await db.from('supplier_responses').select('id').in('inquiry_id',inquiries)).data?.map(r=>r.id)||[]);
 await del('supplier_responses','inquiry_id',inquiries);await del('rfqs','inquiry_id',inquiries);await del('suppliers','id',suppliers);
 await del('inquiries','id',inquiries);await del('customers','id',customers);await del('profiles','user_id',users);
 for(const id of users){const r=await db.auth.admin.deleteUser(id);if(r.error)throw r.error;}
 console.log('Temporary accounts and records removed.');
}
(async()=>{
 try{
 const admin=await account('admin',0),customer=await account('customer',0),other=await account('customer',1);
 const accepted=await quote(customer.customer,'sent','accept'),rejected=await quote(customer.customer,'sent','reject'),revision=await quote(customer.customer,'sent','revision'),draft=await quote(customer.customer,'draft','draft'),privateQuote=await quote(other.customer,'sent','other customer');
 // Disposable source offers. These tests never click the supplier order send button.
 for(let i=0;i<3;i++){
  const supplier=await insert('suppliers',{legal_name:'ARAT QA '+run+' supplier '+i,primary_country:'Turkey',status:'active'});suppliers.push(supplier.id);
  await insert('rfqs',{supplier_id:supplier.id,inquiry_id:accepted.inquiry.id,status:'sent',recipient_email:'qa-supplier-'+i+'@example.invalid',sent_at:new Date().toISOString()});
  const response=await insert('supplier_responses',{supplier_id:supplier.id,inquiry_id:accepted.inquiry.id,status:'processed'});
  const offer=await insert('supplier_quotes',{supplier_response_id:response.id,currency:'EUR',quantity:150,net_price:175,gross_price:210,match_status:'match'});
  const item={supplier_quote_id:offer.id,description:'QA requested item '+i,model:'QA-MODEL-'+i,price_calculation:{source_ref:'intake:item:'+i,commercial:{net:175,gross:210,taxRate:20,taxMode:'excluded',delivery:{original:'two weeks'}}}};
  if(i===0){const r=await db.from('customer_quote_items').update(item).eq('id',accepted.line.id);if(r.error)throw r.error;}
  else await insert('customer_quote_items',{...item,customer_quote_id:accepted.q.id,quantity:150,unit_price:225,price_status:'admin_confirmed',supplier_cost:175,supplier_currency:'EUR'});
 }
 browser=await chromium.launch({channel:'msedge',headless:true});
 const ac=await browser.newContext({viewport:{width:1440,height:1000}}),cc=await browser.newContext({viewport:{width:1440,height:1000}}),anon=await browser.newContext();
 ac.setDefaultTimeout(30000);cc.setDefaultTimeout(30000);anon.setDefaultTimeout(30000);
 let ap,cp;
 await check('Admin password sign-in and routing',async()=>{ap=await login(ac,admin);assert.equal(new URL(ap.url()).pathname,'/');});
 await check('Customer password sign-in preserves requested quotation',async()=>{cp=await login(cc,customer,'/customer/quotes/'+accepted.inquiry.id);assert.equal(new URL(cp.url()).pathname,'/customer/quotes/'+accepted.inquiry.id);});
 if(!ap||!cp)throw Error('Required login failed');
 if(process.argv.includes('--display')){
  const adminRoutes=['/','/inquiries','/suppliers','/rfqs','/quotes','/quotes/revisions','/customers','/notifications','/settings','/inquiries/'+accepted.inquiry.id,'/quotes/'+draft.q.id];
  const customerRoutes=['/customer','/customer/inquiries/new','/customer/inquiries/'+accepted.inquiry.id,'/customer/quotes/'+accepted.inquiry.id,'/customer/notifications'];
  for(const [role,page,routes]of [['admin',ap,adminRoutes],['customer',cp,customerRoutes]]){
   const ready=await check(role+' switches to Turkish and persists on reload',async()=>{
    await page.locator('.language-toggle:visible').click();await page.locator('html[lang="tr"]').waitFor();
    assert.match(await body(page),role==='admin'?/Kontrol paneli/:/Teklifi kabul et/);
    await page.reload();await page.locator('html[lang="tr"]').waitFor();
    await page.locator('.theme-toggle:visible').click();await page.locator('html[data-theme="dark"]').waitFor();
   });
   if(!ready)throw Error('Display setup did not finish; stopping and cleaning disposable records.');
   if(role==='admin')await check('Turkish dark pricing dialog has translated controls and readable text',async()=>{
    await page.goto('http://localhost:3000/quotes/'+draft.q.id);
    await page.getByRole('button',{name:'Ön teklifi incele ve fiyatlandır',exact:true}).click();
    await page.getByRole('dialog').waitFor();assert.equal(await page.getByLabel('Müşteri fiyat yöntemi').count(),1);
    assert.deepEqual(await page.evaluate(require('./helpers/contrast-audit.cjs')),[]);
    await page.screenshot({path:path.join(dir,'admin-turkish-pricing.png'),fullPage:true});await page.keyboard.press('Escape');
   });
   for(const route of routes)await check(role+' Turkish dark page '+route.replace(/[0-9a-f-]{36}/g,':id'),async()=>{
    const r=await page.goto('http://localhost:3000'+route);assert.ok(r.status()<400);await page.locator('html[lang="tr"][data-theme="dark"]').waitFor();
    assert.doesNotMatch(await body(page),/Runtime (?:Error|ToolError)|Application error|Authentication required/);
    const surfaces=await page.evaluate(()=>[...document.querySelectorAll('main *,aside *,header *')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);if(r.width<2||r.height<2||s.visibility==='hidden'||e.matches('.primary-button,.button,.customer-brand-mark,.admin-brand-mark,.inquiry-process-current-dot,.nav-notification-count'))return false;const rgb=s.backgroundColor.match(/[\d.]+/g)?.map(Number);return rgb&&rgb.length>=3&&(rgb.length<4||rgb[3]>.8)&&rgb.slice(0,3).every(v=>v>180)}).map(e=>({tag:e.tagName,cls:e.className,bg:getComputedStyle(e).backgroundColor})).slice(0,15));
    assert.deepEqual(surfaces,[],'Unexpected light surfaces: '+JSON.stringify(surfaces));
    const contrast=await page.evaluate(require('./helpers/contrast-audit.cjs'));
    assert.deepEqual(contrast,[],'Unreadable text: '+JSON.stringify(contrast));
   });
   await page.screenshot({path:path.join(dir,role+'-turkish-dark.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.goto('http://localhost:3000'+(role==='admin'?'/quotes/'+draft.q.id:'/customer/inquiries/new'));
   await check(role+' Turkish mobile controls remain usable',async()=>{assert.ok(await page.locator('.language-toggle:visible').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(dir,role+'-turkish-mobile.png'),fullPage:true});});
   if(role==='customer'){
    await page.getByLabel('Ürün açıklaması',{exact:false}).fill('Original HS-421T customer wording');
    await page.getByLabel('Miktar',{exact:false}).fill('150');await page.getByLabel('Öncelik',{exact:false}).selectOption('urgent');
   }
   await page.locator('.language-toggle:visible').click();await page.locator('html[lang="en"]').waitFor();
   if(role==='customer')await check('Language switch preserves unsaved customer data and submitted option values',async()=>{
    assert.equal(await page.getByLabel('Product description',{exact:false}).inputValue(),'Original HS-421T customer wording');assert.equal(await page.getByLabel('Quantity',{exact:false}).inputValue(),'150');assert.equal(await page.getByLabel('Priority',{exact:false}).inputValue(),'urgent');
   });
   await page.reload();assert.equal(await page.locator('html').getAttribute('lang'),'en');
  }
  return;
 }
 const runOfferSelection=async()=>{await check('Admin changes selected supplier offer atomically in a draft',async()=>{const f=await quote(customer.customer,'draft','offer choice');const updated=await db.from('customer_quote_items').update({price_calculation:{source_ref:'intake:item:0',commercial:{net:175}}}).eq('id',f.line.id);assert.ifError(updated.error);const alternative=await insert('customer_quote_items',{customer_quote_id:f.q.id,is_selected:false,description:'Alternative sensor offer',model:'QA-ALT',quantity:150,supplier_cost:180,supplier_currency:'EUR',price_status:'suggested',price_calculation:{source_ref:'intake:item:0',commercial:{net:180}}});await ap.goto('http://localhost:3000/quotes/'+f.q.id);await ap.getByRole('button',{name:'Review & price pre-quote'}).click();await ap.getByRole('button',{name:'Use this supplier offer for this item',exact:true}).click();await ap.getByRole('dialog').waitFor({state:'hidden'});const r=await db.from('customer_quote_items').select('id,is_selected').eq('customer_quote_id',f.q.id);assert.ifError(r.error);assert.equal(r.data.find(row=>row.id===f.line.id).is_selected,false);assert.equal(r.data.find(row=>row.id===alternative.id).is_selected,true);});};
 if(process.argv.includes('--selection')){await runOfferSelection();return;}
 if(process.argv.includes('--orders')){
  await db.from('customer_quotes').update({status:'accepted'}).eq('id',accepted.q.id);
  await check('Admin reviews supplier PDF attachments with a short email note',async()=>{
   await ap.goto('http://localhost:3000/quotes/'+accepted.q.id);await ap.getByLabel('Purchasing / delivery instructions').fill('QA warehouse instructions');await ap.getByRole('button',{name:'Prepare / refresh supplier order previews',exact:true}).click();
   await ap.locator('.supplier-order-pdf').first().waitFor();assert.equal(await ap.getByRole('link',{name:'Preview / Download purchase order PDF',exact:true}).count(),3);
   const {data:orders,error}=await db.from('supplier_order_confirmations').select('id,status,body,snapshot').eq('customer_quote_id',accepted.q.id);assert.ifError(error);assert.equal(orders.length,3);
   for(const order of orders){assert.equal(order.status,'draft');assert.match(order.body,/ekte/);assert.doesNotMatch(order.body,/62527506564|QA-MODEL|175[.,]00/);const url='http://localhost:3000/api/supplier-orders/'+order.id+'/pdf?v='+order.snapshot.pdf_sha256;const r=await ac.request.get(url);assert.equal(r.status(),200);assert.match(r.headers()['content-type'],/pdf/);const bytes=await r.body();assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),order.snapshot.pdf_sha256);assert.equal((await cc.request.get(url)).status(),403);assert.equal((await anon.request.get(url)).status(),403);}
   await ap.screenshot({path:path.join(dir,'supplier-pdf-preview.png'),fullPage:true});await ap.setViewportSize({width:390,height:844});assert.ok(await ap.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  });
  await check('Legacy sent orders offer a PDF copy without modifying or resending the order',async()=>{
   const {data:order}=await db.from('supplier_order_confirmations').select('id,snapshot').eq('customer_quote_id',accepted.q.id).limit(1).single();const snapshot={...order.snapshot};const oldPath=snapshot.pdf_path;delete snapshot.pdf_path;delete snapshot.pdf_sha256;await db.storage.from('supplier-email-attachments').remove([oldPath]);await db.from('supplier_order_confirmations').update({status:'sent',sent_at:new Date().toISOString(),snapshot}).eq('id',order.id);
   const response=await ac.request.get('http://localhost:3000/api/supplier-orders/'+order.id+'/pdf?copy=current');assert.equal(response.status(),200);assert.equal((await response.body()).subarray(0,4).toString(),'%PDF');const {data:unchanged}=await db.from('supplier_order_confirmations').select('status,snapshot').eq('id',order.id).single();assert.equal(unchanged.status,'sent');assert.equal(unchanged.snapshot.pdf_path,undefined);
  });return;
 }

 for(const route of ['/','/inquiries','/suppliers','/rfqs','/quotes','/quotes/revisions','/customers','/notifications','/settings','/inquiries/'+accepted.inquiry.id,'/quotes/'+draft.q.id])await check('Admin page '+route.replace(/[0-9a-f-]{36}/g,':id'),async()=>{const r=await ap.goto('http://localhost:3000'+route);assert.ok(r.status()<400,'HTTP '+r.status());assert.doesNotMatch(await body(ap),/Runtime (?:Error|ToolError)|Application error|Authentication required/);});
 await check('Customer request shows AO identity and hides internal process and supplier cost',async()=>{await cp.goto('http://localhost:3000/customer/inquiries/'+accepted.inquiry.id);const text=await body(cp);assert.match(text,/AO-20261015/);assert.doesNotMatch(text,/Supplier Research|Supplier Verification|Request Process|175\.00|supplier cost/i);await cp.screenshot({path:path.join(dir,'customer-request-desktop.png'),fullPage:true});});
 await check('Customer mobile request fits viewport',async()=>{await cp.setViewportSize({width:390,height:844});assert.ok(await cp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await cp.screenshot({path:path.join(dir,'customer-request-mobile.png'),fullPage:true});await cp.setViewportSize({width:1440,height:1000});});

 if(process.argv.includes('--smoke')){
  await check('Healthy Admin inquiry has no workflow or retry buttons',async()=>{await ap.goto('http://localhost:3000/inquiries/'+accepted.inquiry.id);assert.equal(await ap.getByRole('button',{name:/Start workflow|Continue workflow|Run workflow|Retry failed automation/}).count(),0);});
  await check('Failed automation exposes recovery only for the actual failure',async()=>{await insert('ai_executions',{task_key:'inquiry:'+draft.inquiry.id+':stage:research',inquiry_id:draft.inquiry.id,agent_id:'product_research',status:'failed',attempt_count:3,error_message:'QA: exhausted provider failure'});await ap.goto('http://localhost:3000/inquiries/'+draft.inquiry.id);assert.equal(await ap.getByRole('button',{name:'Retry failed automation',exact:true}).count(),1);assert.equal(await ap.getByRole('button',{name:/Start workflow|Continue workflow|Run workflow/}).count(),0);});
  return;
 }
 await check('Customer cannot access another customer request',async()=>{const r=await cp.goto('http://localhost:3000/customer/inquiries/'+privateQuote.inquiry.id);assert.equal(r.status(),404);assert.doesNotMatch(await body(cp),/QA temperature sensor/);});
 await check('Customer cannot download another customer PDF',async()=>{const r=await cc.request.get('http://localhost:3000/api/quotes/'+privateQuote.q.id+'/pdf');assert.ok([403,404].includes(r.status()),'HTTP '+r.status());});
 await check('Customer cannot see draft quotation',async()=>{const r=await cp.goto('http://localhost:3000/customer/quotes/'+draft.inquiry.id);assert.equal(r.status(),404);});
 await check('Anonymous quotation access asks for sign-in',async()=>{const p=await anon.newPage();await p.goto('http://localhost:3000/customer/quotes/'+accepted.inquiry.id);assert.equal(new URL(p.url()).pathname,'/login');await p.close();});
 await check('Customer can download their confirmed quotation PDF',async()=>{const r=await cc.request.get('http://localhost:3000/api/quotes/'+accepted.q.id+'/pdf');assert.equal(r.status(),200);assert.match(r.headers()['content-type'],/pdf/);assert.equal((await r.body()).subarray(0,4).toString(),'%PDF');});
 await check('Unconfirmed draft PDF is blocked for Admin',async()=>{const r=await ac.request.get('http://localhost:3000/api/quotes/'+draft.q.id+'/pdf');assert.equal(r.status(),409);});

 await check('Customer API does not expose supplier costs or internal calculations',async()=>{const client=require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:customer.email,password});assert.ifError(login.error);const result=await client.from('customer_quote_items').select('supplier_cost,price_calculation').eq('customer_quote_id',accepted.q.id);assert.ifError(result.error);assert.deepEqual(result.data,[],'Internal quote item table must be inaccessible to customer API sessions');await client.auth.signOut({scope:'local'});});
 await check('Customer accepts real test quotation',async()=>{await cp.goto('http://localhost:3000/customer/quotes/'+accepted.inquiry.id);await cp.getByRole('button',{name:'Accept quotation',exact:true}).click();await waitStatus(accepted.q.id,'accepted');const {data:acceptedInquiry}=await db.from('inquiries').select('status').eq('id',accepted.inquiry.id).single();assert.equal(acceptedInquiry.status,'converted');await cp.getByRole('button',{name:'Accept quotation',exact:true}).waitFor({state:'hidden'});assert.equal(await cp.getByRole('button',{name:'Accept quotation',exact:true}).count(),0);});
 await check('Acceptance notifies Admin with supplier order action',async()=>{await ap.goto('http://localhost:3000/notifications');assert.ok(await ap.getByRole('link',{name:'Review & send supplier orders',exact:true}).count()>0);const {data}=await db.from('notifications').select('id').eq('user_id',admin.id).eq('record_id',accepted.q.id).eq('record_type','supplier_order_confirmation');assert.equal(data.length,1);});
 await check('Admin prepares three separate supplier order previews without sending',async()=>{await ap.goto('http://localhost:3000/quotes/'+accepted.q.id+'#supplier-order-confirmation');await ap.getByLabel('Purchasing / delivery instructions').fill('QA warehouse instructions');await ap.getByRole('button',{name:'Prepare / refresh supplier order previews',exact:true}).click();await ap.getByRole('button',{name:'Send order confirmation to supplier & order items',exact:true}).first().waitFor();assert.equal(await ap.getByRole('button',{name:'Send order confirmation to supplier & order items',exact:true}).count(),3);const {data:orders,error}=await db.from('supplier_order_confirmations').select('*').eq('customer_quote_id',accepted.q.id);assert.ifError(error);assert.equal(orders.length,3);for(const order of orders){assert.equal(order.status,'draft');assert.equal(order.sent_at,null);assert.doesNotMatch(order.body,/225|markup/i);const i=suppliers.indexOf(order.supplier_id);const file=await db.storage.from('supplier-email-attachments').download(order.snapshot.pdf_path);assert.ifError(file.error);const extracted=await require('unpdf').extractText(new Uint8Array(await file.data.arrayBuffer()),{mergePages:true});assert.match(extracted.text,new RegExp('QA-MODEL-'+i));for(let j=0;j<3;j++)if(i!==j)assert.doesNotMatch(extracted.text,new RegExp('QA-MODEL-'+j));}await ap.screenshot({path:path.join(dir,'supplier-orders-desktop.png'),fullPage:true});await ap.setViewportSize({width:390,height:844});assert.ok(await ap.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await ap.screenshot({path:path.join(dir,'supplier-orders-mobile.png'),fullPage:true});await ap.setViewportSize({width:1440,height:1000});});
 await check('Customer cannot read supplier orders through Data API',async()=>{const client=require('@supabase/supabase-js').createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:customer.email,password});assert.ifError(login.error);const r=await client.from('supplier_order_confirmations').select('recipient_email,body,snapshot').eq('customer_quote_id',accepted.q.id);assert.ifError(r.error);assert.deepEqual(r.data,[]);await client.auth.signOut({scope:'local'});});
 await runOfferSelection();
 await check('Customer rejects test quotation with a reason',async()=>{await cp.goto('http://localhost:3000/customer/quotes/'+rejected.inquiry.id);await cp.getByRole('button',{name:'Reject quotation',exact:true}).click();await cp.getByRole('textbox').fill('QA: price does not fit');await cp.getByRole('button',{name:'Confirm rejection'}).click();await waitStatus(rejected.q.id,'rejected');await cp.getByRole('button',{name:'Confirm rejection'}).waitFor({state:'hidden'});});
 await check('Customer requests delivery revision',async()=>{await cp.goto('http://localhost:3000/customer/quotes/'+revision.inquiry.id);await cp.getByRole('button',{name:'Request revision',exact:true}).click();await cp.getByLabel('What needs to change?').selectOption('delivery_time');await cp.getByLabel('Details',{exact:true}).fill('QA: need one week delivery');await cp.getByRole('button',{name:'Submit request'}).click();await waitStatus(revision.q.id,'revision_requested');await cp.getByRole('button',{name:'Submit request',exact:true}).waitFor({state:'hidden'});});

 for(const reason of ['price','quantity','product_specification','payment_terms','other'])await check('Customer revision reason '+reason,async()=>{const f=await quote(customer.customer,'sent','revision '+reason);await cp.goto('http://localhost:3000/customer/quotes/'+f.inquiry.id);await cp.getByRole('button',{name:'Request revision',exact:true}).click();await cp.getByLabel('What needs to change?').selectOption(reason);await cp.getByLabel('Details',{exact:true}).fill('QA '+run+' '+reason);await cp.getByRole('button',{name:'Submit request',exact:true}).click();await waitStatus(f.q.id,'revision_requested');await cp.getByRole('button',{name:'Submit request',exact:true}).waitFor({state:'hidden'});});
 await check('Admin approves delivery revision and copies public item fields',async()=>{await ap.goto('http://localhost:3000/quotes/revisions');const row=ap.locator('.row').filter({hasText:revision.q.reference});await row.getByRole('button',{name:'Approve & create revision',exact:true}).click();await row.waitFor({state:'hidden'});const {data,error}=await db.from('customer_quotes').select('id,status,reference').eq('parent_quote_id',revision.q.id).single();assert.ifError(error);assert.equal(data.status,'draft');assert.match(data.reference,/-R1$/);const {data:line}=await db.from('customer_quote_items').select('description,model,brand,delivery_text,price_status').eq('customer_quote_id',data.id).single();assert.equal(line.model,'QA-HS421T');assert.equal(line.price_status,'suggested');await waitStatus(revision.q.id,'superseded');});
 await check('Admin rejects another revision and restores sent quotation',async()=>{await ap.goto('http://localhost:3000/quotes/revisions');const row=ap.locator('.row').filter({hasText:'QA '+run+' price'});await row.getByRole('button',{name:'Reject',exact:true}).click();await row.waitFor({state:'hidden'});assert.equal(await row.count(),0);});
 await check('Customer Admin URL does not disclose Admin content',async()=>{await cp.goto('http://localhost:3000/settings');assert.equal(new URL(cp.url()).pathname,'/login');assert.doesNotMatch(await body(cp),/Quotation letterhead|SMTP password|AI provider configuration/);});
 await check('Admin test draft review opens real pricing controls',async()=>{await ap.goto('http://localhost:3000/quotes/'+draft.q.id);await ap.getByRole('button',{name:'Review & price pre-quote'}).click();await ap.getByRole('dialog').waitFor();assert.equal(await ap.getByRole('button',{name:'Confirm line & price'}).isDisabled(),true);await ap.screenshot({path:path.join(dir,'admin-pricing.png'),fullPage:true});await ap.keyboard.press('Escape');});

 await check('Admin confirms manual price and submits approval without sending',async()=>{await ap.goto('http://localhost:3000/quotes/'+draft.q.id);await ap.getByRole('button',{name:'Review & price pre-quote'}).click();await ap.getByLabel('Customer price method').selectOption('manual');await ap.getByRole('spinbutton',{name:/^Customer unit price/}).fill('235');await ap.getByRole('button',{name:'Confirm line & price'}).click();await ap.getByRole('button',{name:'Confirm line & price'}).waitFor({state:'visible'});await ap.getByRole('button',{name:'Confirm line & price'}).isEnabled();await ap.getByText('1/1 prices confirmed',{exact:true}).first().waitFor();await ap.keyboard.press('Escape');const {data:item}=await db.from('customer_quote_items').select('unit_price,price_status').eq('id',draft.line.id).single();assert.equal(Number(item.unit_price),235);assert.equal(item.price_status,'admin_confirmed');ap.once('dialog',d=>d.accept());await ap.getByRole('button',{name:'Request approval',exact:true}).click();await waitStatus(draft.q.id,'pending_approval');await ap.getByRole('button',{name:'Approve & Send',exact:true}).waitFor();assert.equal(await ap.getByRole('button',{name:'Approve & Send',exact:true}).count(),1);});
 await check('Customer new request validates required fields and supports multiple items',async()=>{await cp.goto('http://localhost:3000/customer/inquiries/new');await cp.getByRole('button',{name:'+ Add Another Item',exact:true}).click();assert.equal(await cp.getByLabel('Product description',{exact:false}).count(),2);await cp.getByLabel('Product description',{exact:false}).first().fill('QA sensor');await cp.getByLabel('Quantity',{exact:false}).first().fill('-1');assert.equal(await cp.getByLabel('Quantity',{exact:false}).first().evaluate(el=>el.validity.rangeUnderflow),true);});
 await check('Admin views customer link in Admin inquiry',async()=>{await ap.goto('http://localhost:3000/customer/inquiries/'+accepted.inquiry.id);assert.equal(new URL(ap.url()).pathname,'/inquiries/'+accepted.inquiry.id);});

 await check('Invalid password displays an error without entering a portal',async()=>{const p=await anon.newPage();await p.goto('http://localhost:3000/login');await p.getByLabel('Email',{exact:true}).fill(customer.email);await p.getByLabel('Password',{exact:true}).fill('Deliberately-wrong-password-123!');await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.locator('.error-box').waitFor();assert.equal(new URL(p.url()).pathname,'/login');await p.close();});
 await check('Customer cannot navigate to an external post-login destination',async()=>{const context=await browser.newContext();const p=await login(context,other,'//example.com');assert.equal(new URL(p.url()).origin,'http://localhost:3000');assert.equal(new URL(p.url()).pathname,'/customer');await context.close();});
 await check('Inactive customer account is refused at sign-in',async()=>{await db.from('profiles').update({status:'inactive'}).eq('user_id',other.id);const context=await browser.newContext(),p=await context.newPage();try{await p.goto('http://localhost:3000/login');await p.getByLabel('Email',{exact:true}).fill(other.email);await p.getByLabel('Password',{exact:true}).fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.locator('.error-box').waitFor();assert.equal(new URL(p.url()).pathname,'/login');}finally{await db.from('profiles').update({status:'active'}).eq('user_id',other.id);await context.close();}});
 await check('Customer sign-out removes protected session',async()=>{await cp.goto('http://localhost:3000/customer');const b=cp.getByRole('button',{name:/sign out/i});await b.first().click();await cp.waitForURL(/\/login/);await cp.goto('http://localhost:3000/customer/inquiries/'+accepted.inquiry.id);assert.equal(new URL(cp.url()).pathname,'/login');});
 }finally{
 if(browser)await browser.close();
 try{await cleanup();findings.push({name:'Temporary data cleanup',status:'passed'});}catch(e){findings.push({name:'Temporary data cleanup',status:'failed',error:e.message});console.error(e.message);}
 fs.writeFileSync(path.join(dir,'report-'+run+'.json'),JSON.stringify({run,findings,browserErrors:errors},null,2));
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({run,findings,browserErrors:errors},null,2));
 console.log(JSON.stringify({passed:findings.filter(x=>x.status==='passed').length,failed:findings.filter(x=>x.status==='failed').length,browserErrors:errors.length}));
 if(findings.some(x=>x.status==='failed')||errors.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
