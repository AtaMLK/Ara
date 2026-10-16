const test=require('node:test'),assert=require('node:assert/strict');
const createLoad=require('./helpers/load-ts.cjs');
test('catalog traversal finds every requested code despite missing search-engine pages',async()=>{
 const calls=[];
 const load=createLoad({'../supplier-page':{readSupplierHtml:async(url,redirects,xml)=>{calls.push(url);assert.equal(xml,true);if(url.endsWith('/sitemap.xml'))return '<sitemapindex><sitemap><loc>https://supplier.example/product-sitemap.xml</loc></sitemap><sitemap><loc>https://evil.example/private.xml</loc></sitemap></sitemapindex>';if(url.endsWith('/product-sitemap.xml'))return '<urlset>'+['D5072D','D5040S','D5030S','D5011S','D5212Q','D5011S2'].map(code=>'<url><loc>https://supplier.example/products/'+code+'</loc></url>').join('')+'</urlset>';return '';}}});
 const models=['D5072D','D5040S','D5030S','D5011S','D5212Q'];
 const leads=await load('@/lib/ai/research/supplier-catalog').supplierCatalogModels(['https://supplier.example/products/D5011S'],models);
 assert.equal(leads.length,5);assert.deepEqual(leads.map(x=>x.url.split('/').pop()),models);
 assert.ok(calls.length<=6);assert.ok(calls.every(url=>url.startsWith('https://supplier.example/')));
});
test('unavailable or malformed sitemaps do not stop discovery',async()=>{
 const load=createLoad({'../supplier-page':{readSupplierHtml:async()=>{throw Error('unavailable')}}});
 assert.deepEqual(await load('@/lib/ai/research/supplier-catalog').supplierCatalogModels(['bad','http://user:secret@example.test','https://supplier.example/'],['D5040S']),[]);
});

