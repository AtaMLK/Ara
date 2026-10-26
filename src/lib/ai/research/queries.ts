export function supplierSearchQueries(item:{product:string;brand?:string;model?:string}){
  const brand=item.brand?.trim()??'',model=item.model?.trim()??'';
  const description=item.product.split(/;|Country of Origin\s*:|HS Code\s*:|Sales Status\s*:/i)[0]
    .replace(/^\s*\d+(?:[.,]\d+)?\s+(?:pcs?|pieces?|adet|kg|g|mm|cm|m)\s+(?:of\s+)?/i,'').trim().split(/\s+/).slice(0,12).join(' ');
  const identity=[brand,model].filter(Boolean).join(' ');
  const queries:string[]=[];
  if(identity){
    queries.push(identity+' official product',identity+' manufacturer',identity+' supplier Turkey',identity+' distributor Europe',identity+' supplier');
    queries.push(identity+' Türkiye tedarikçi distribütör',identity+' Türkiye stok satış');
  }
  if(brand)queries.push(brand+' authorized distributor Turkey',brand+' official distributor Europe',brand+' worldwide distributor locator official');
  if(description)queries.push([identity,description,'supplier'].filter(Boolean).join(' '),[brand,description,'supplier Turkey'].filter(Boolean).join(' '));
  return [...new Set(queries)];
}

export async function mapResearchQueries<T,R>(jobs:T[],run:(job:T)=>Promise<R>,concurrency=4):Promise<R[]>{
  const results:R[]=new Array(jobs.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},async()=>{
    while(next<jobs.length){const index=next++;results[index]=await run(jobs[index]);}
  }));
  return results;
}
