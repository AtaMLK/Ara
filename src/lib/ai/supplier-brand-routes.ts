import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { oneRelated } from '@/lib/data/relations';
import { ToolError } from '@/lib/errors';
import { canonicalBrand, isExclusiveBrand, isAryaPreferredBrand, isAryaWebsite, productBrand, type BrandRequirement } from './supplier-policy';
type Database = ReturnType<typeof createSupabaseAdminClient>;
type Supplier = {id:string;legal_name:string;primary_country:string;verification_status:string;status?:string};
function check(error: {message:string}|null) {if(error) throw new ToolError('TRANSIENT',error.message);}

export async function recordVerifiedSupplierBrands(db:Database,inquiryId:string) {
  const [requirements,candidates] = await Promise.all([
    db.from('requirements').select('id,type,value,source_ref').eq('inquiry_id',inquiryId).eq('status','confirmed'),
    db.from('supplier_candidates').select('supplier_id,requirement_id,match_evidence,suppliers(id,verification_status,status)').eq('inquiry_id',inquiryId).eq('status','finalized'),
  ]);
  check(requirements.error);check(candidates.error);
  for(const candidate of candidates.data ?? []) {
    const supplier=oneRelated(candidate.suppliers);
    if(!supplier || supplier.verification_status!=='verified' || supplier.status==='inactive') continue;
    if(candidate.match_evidence?.match_type==='related_alternative') continue;
    const product=(requirements.data ?? []).find(row=>row.id===candidate.requirement_id);
    if(!product) continue;
    const brand=productBrand(product,requirements.data ?? []);
    if(!brand) continue;
    const result=await db.from('supplier_brands').upsert({supplier_id:supplier.id,name:brand,is_unknown:false,is_suggested:false,approved_at:new Date().toISOString()},{onConflict:'supplier_id,name'});
    check(result.error);
  }
}

async function aryaSupplier(db:Database):Promise<Supplier> {
  const sites=await db.from('supplier_websites').select('supplier_id,url,suppliers!supplier_websites_supplier_id_fkey(id,legal_name,primary_country,verification_status,status)').ilike('url','%aryaautomation.com%');check(sites.error);
  const existing=(sites.data ?? []).find(row=>isAryaWebsite(row.url));
  let supplier=existing ? oneRelated(existing.suppliers) : null;
  if(!supplier) {
    const named=await db.from('suppliers').select('id,legal_name,primary_country,verification_status,status').eq('legal_name','Arya Automation').limit(1).maybeSingle();check(named.error);
    supplier=named.data;
  }
  if(supplier) {
    if(supplier.verification_status!=='verified' && supplier.verification_status!=='rejected') {
      const decision=await db.from('supplier_verification_history').select('changed_by').eq('supplier_id',supplier.id).order('created_at',{ascending:false}).limit(1).maybeSingle();check(decision.error);
      if(!decision.data?.changed_by) {
        const verified=await db.from('suppliers').update({verification_status:'verified',last_verified_at:new Date().toISOString()}).eq('id',supplier.id);check(verified.error);
        supplier={...supplier,verification_status:'verified'};
        const history=await db.from('supplier_verification_history').insert({supplier_id:supplier.id,new_status:'verified',reason:'Admin business rule: certified Arya distributor',agent_id:'supplier_discovery'});check(history.error);
      }
    }
    return supplier;
  }
  // The Admin explicitly identifies Arya as the certified distributor of these brands.
  const created=await db.from('suppliers').insert({legal_name:'Arya Automation',primary_country:'Turkey',supplier_type:'distributor',verification_status:'verified',last_verified_at:new Date().toISOString(),status:'active'}).select('id,legal_name,primary_country,verification_status,status').single();check(created.error);
  if(!created.data) throw new ToolError('TRANSIENT','Could not create the Arya distributor record');
  const website=await db.from('supplier_websites').insert({supplier_id:created.data.id,url:'https://aryaautomation.com',is_primary:true}).select('id').single();check(website.error);
  if(website.data) {const result=await db.from('suppliers').update({primary_website_id:website.data.id}).eq('id',created.data.id);check(result.error);}
  const configuredEmail=process.env.PURCHASE_DEP_EMAIL || process.env.SMTP_FROM || process.env.IMAP_USER;
  if(configuredEmail && /^[^\s<>@]+@aryaautomation\.com$/i.test(configuredEmail)) {
    const email=await db.from('supplier_emails').insert({supplier_id:created.data.id,email:configuredEmail.toLowerCase(),is_primary:true,status:'active'}).select('id').single();check(email.error);
    if(email.data) {const result=await db.from('suppliers').update({primary_email_id:email.data.id}).eq('id',created.data.id);check(result.error);}
  }
  const history=await db.from('supplier_verification_history').insert({supplier_id:created.data.id,new_status:'verified',reason:'Admin business rule: Arya supplies GMI, CTC, Hansford Sensors and Siemens',agent_id:'supplier_discovery'});check(history.error);
  return created.data;
}

/** Reuse verified brand relationships before any external research or AI call. */
export async function reuseVerifiedBrandSuppliers(db:Database,inquiryId:string,requirements:BrandRequirement[]) {
  const products=requirements.filter(row=>row.type==='product');
  const wanted=new Set(products.map(product=>productBrand(product,requirements)).filter(Boolean));
  const routes=new Map<string,Map<string,Supplier>>();
  const brands=await db.from('supplier_brands').select('name,supplier_id,is_suggested,is_unknown,suppliers(id,legal_name,primary_country,verification_status,status)');check(brands.error);
  for(const row of brands.data ?? []) {
    const brand=canonicalBrand(row.name);const supplier=oneRelated(row.suppliers);
    if(!wanted.has(brand)||row.is_suggested||row.is_unknown||!supplier||supplier.verification_status!=='verified'||supplier.status==='inactive') continue;
    const list=routes.get(brand) ?? new Map<string,Supplier>();list.set(supplier.id,supplier);routes.set(brand,list);
  }
  // Compatibility: older verified suppliers may predate saved brand associations.
  const missing=[...wanted].filter(brand=>!isExclusiveBrand(brand)&&!routes.has(brand));
  if(missing.length) {
    const previous=await db.from('supplier_candidates').select('inquiry_id,requirement_id,supplier_id,match_evidence,suppliers(id,legal_name,primary_country,verification_status,status)').eq('status','finalized');check(previous.error);
    const eligible=(previous.data ?? []).filter(row=>oneRelated(row.suppliers)?.verification_status==='verified' && oneRelated(row.suppliers)?.status!=='inactive' && row.match_evidence?.match_type!=='related_alternative');
    const ids=[...new Set(eligible.map(row=>row.inquiry_id))];
    if(ids.length) {
      const old=await db.from('requirements').select('id,inquiry_id,type,value,source_ref').in('inquiry_id',ids).eq('status','confirmed');check(old.error);
      for(const candidate of eligible) {
        const rows=(old.data ?? []).filter(row=>row.inquiry_id===candidate.inquiry_id);const product=rows.find(row=>row.id===candidate.requirement_id);if(!product) continue;
        const brand=productBrand(product,rows);if(!missing.includes(brand)) continue;
        const supplier=oneRelated(candidate.suppliers)!;const list=routes.get(brand) ?? new Map<string,Supplier>();list.set(supplier.id,supplier);routes.set(brand,list);
      }
    }
  }
  const handled=new Set<string>();
  let arya:Supplier|null=null;
  for(const product of products) {
    const brand=productBrand(product,requirements);if(!brand) continue;
    const exclusive=isExclusiveBrand(brand);
    const preferred=isAryaPreferredBrand(brand);
    if(preferred && !arya) arya=await aryaSupplier(db);
    const suppliers=exclusive ? [arya!] : [...(preferred ? [arya!] : []),...(routes.get(brand)?.values() ?? [])].filter((supplier,index,all)=>all.findIndex(other=>other.id===supplier.id)===index);
    if(!suppliers.length) continue;
    // Siemens keeps external research available after the preferred Arya route.
    if (!preferred || exclusive) handled.add(product.id);
    if(exclusive) {
      const prior=await db.from('supplier_candidates').select('id,supplier_id,match_evidence,status').eq('inquiry_id',inquiryId).eq('requirement_id',product.id);check(prior.error);
      for(const other of prior.data ?? []) {
        if(other.supplier_id===arya!.id || other.status==='admin_removed' || other.status==='admin_rejected') continue;
        const removed=await db.from('supplier_candidates').update({status:'admin_removed',match_evidence:{...other.match_evidence,exclusive_distributor_rule:true,exclusion_reason:'Admin requires Arya Automation as the only supplier for this brand'}}).eq('id',other.id);check(removed.error);
      }
    }
    for(const supplier of suppliers) {
      const isArya=preferred && supplier.id===arya?.id;
      const website=isArya?'https://aryaautomation.com':null;
      const existing=await db.from('supplier_candidates').select('id,status,match_evidence,verification_evidence').eq('inquiry_id',inquiryId).eq('requirement_id',product.id).eq('supplier_id',supplier.id).maybeSingle();check(existing.error);
      if(existing.data && ['admin_removed','admin_rejected'].includes(existing.data.status)) continue;
      // Reusing a brand must not replace an existing external candidate's sourced details.
      if(existing.data && !isArya && !exclusive) {
        const result=await db.from('supplier_candidates').update({match_evidence:{...existing.data.match_evidence,preferred_brand_supplier:true}}).eq('id',existing.data.id);check(result.error);
        continue;
      }
      const payload={inquiry_id:inquiryId,requirement_id:product.id,supplier_id:supplier.id,proposed_name:supplier.legal_name,proposed_country:supplier.primary_country,proposed_website:website,
        status:'finalized',match_evidence:{brand,preferred_brand_supplier:true,exclusive_distributor:exclusive,match_type:'same_brand_distributor',match_score:100,match_note:exclusive?'Admin-designated exclusive certified distributor.':isArya?'Admin-designated preferred supplier; confirm availability of the requested model.':'Previously verified supplier for this brand; confirm availability of the requested model.'},
        verification_evidence:{...(existing.data?.verification_evidence ?? {}),source_url:website,verification_basis:exclusive?'admin_exclusive_distributor_rule':isArya?'admin_preferred_supplier_rule':'existing_verified_brand_supplier'}};
      const result=existing.data ? await db.from('supplier_candidates').update(payload).eq('id',existing.data.id) : await db.from('supplier_candidates').insert(payload);check(result.error);
    }
  }
  return handled;
}
