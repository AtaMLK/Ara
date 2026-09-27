import {z} from 'zod';
import {ToolError} from '@/lib/errors';
import {requireAdmin} from '../guards';

const rateSchema=z.object({fromCurrency:z.string().length(3),toCurrency:z.string().length(3),rate:z.number().positive(),validFrom:z.string(),validUntil:z.string().optional(),source:z.string().optional()});

export async function proposeExchangeRate(input:unknown){
 const value=rateSchema.parse(input); const {supabase}=await requireAdmin();
 const {data,error}=await supabase.from('exchange_rates').insert({from_currency:value.fromCurrency,to_currency:value.toCurrency,rate:value.rate,valid_from:value.validFrom,valid_until:value.validUntil,source:value.source,status:'proposed'}).select('*').single();
 if(error) throw new ToolError('CONFLICT',error.message); return data;
}
export async function getApprovedExchangeRate(fromCurrency:string,toCurrency:string,date:string){
 const {supabase}=await requireAdmin();
 const {data,error}=await supabase.from('exchange_rates').select('*').eq('from_currency',fromCurrency).eq('to_currency',toCurrency).eq('status','approved').lte('valid_from',date).or('valid_until.is.null,valid_until.gte.'+date).order('valid_from',{ascending:false}).limit(1).maybeSingle();
 if(error) throw new ToolError('TRANSIENT',error.message);
 if(!data) throw new ToolError('APPROVAL_REQUIRED','No approved exchange rate exists');
 return data;
}
