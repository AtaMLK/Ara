import type {SupplierEvidence} from './supplier-policy';
import {isSupplierEvidenceSource,supplierCountryEvidence,supplierHost} from './supplier-policy';

/** Bounded, best-effort country evidence lookup; failures remain unknown. */
export async function enrichSupplierLocations<T extends SupplierEvidence>(rows:T[],readText:(url:string)=>Promise<string>,reviewed:Record<string,string[]>={},limit=8):Promise<T[]>{
  const sources=new Map<string,T>();
  for(const row of rows){
    const host=supplierHost(row.source_url),id=String(row.structured_data?.arat_requirement_id??'');
    if(sources.size>=limit)break;
    if(!isSupplierEvidenceSource(row)||host.endsWith('.tr')||supplierCountryEvidence(row)||reviewed[id]?.includes(host))continue;
    if(!sources.has(host))sources.set(host,row);
  }
  const countries=new Map<string,{country:string;basis:string;text:string;url:string}>();
  const marketplaces=new Set<string>();
  const jobs=[...sources];let next=0;
  await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
    while(next<jobs.length){
      const [host,row]=jobs[next++];
      try{
        const text=await readText(row.source_url);
        const plain=text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        if(/\b(?:industrial|multi.vendor)\s+(?:stock\s+)?marketplace\b|\bendustriyel\b[^.!?]{0,50}\bpazaryeri\b/.test(plain)){
          marketplaces.add(host);continue;
        }
        const found=supplierCountryEvidence({source_url:row.source_url,structured_data:null,finding:text});
        if(found)countries.set(host,{...found,url:row.source_url});
      }catch{/* A missing page is not country evidence. */}
    }
  }));
  return rows.map(row=>{
    if(marketplaces.has(supplierHost(row.source_url)))return {...row,structured_data:{...row.structured_data,arat_source_kind:'marketplace'}};
    const found=countries.get(supplierHost(row.source_url));
    if(!found||supplierCountryEvidence(row))return row;
    return {...row,structured_data:{...row.structured_data,country:found.country,arat_country_evidence:found}};
  });
}
