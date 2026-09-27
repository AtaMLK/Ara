import {notificationSchema,timelineEventSchema} from '@/lib/ai/schemas';
import {ToolError} from '@/lib/errors';
import type {AIContext} from '@/lib/ai/context';
import {requireInquiryAccess} from '../guards';

export async function createNotification(ctx:AIContext,input:unknown){
  const value=notificationSchema.parse(input);
  if(value.category==='approval' && ctx.agentId==='reporting') throw new ToolError('AUTHORIZATION','Reporting Agent cannot create approval actions');
  const {supabase}=await requireInquiryAccess(ctx,ctx.inquiryId!);
  const {data,error}=await supabase.from('notifications').insert({
    user_id:value.userId,category:value.category,priority:value.priority,title:value.title,message:value.message,
    record_type:value.recordType,record_id:value.recordId,action_url:value.actionUrl
  }).select('*').single();
  if(error) throw new ToolError('TRANSIENT',error.message);
  return data;
}

export async function appendTimelineEvent(ctx:AIContext,input:unknown){
  const value=timelineEventSchema.parse(input);
  await requireInquiryAccess(ctx,value.inquiryId);
  const {supabase}=await requireInquiryAccess(ctx,value.inquiryId);
  const {data,error}=await supabase.from('timeline_events').insert({
    inquiry_id:value.inquiryId,event_type:value.eventType,visibility:value.visibility,
    actor_type:'ai',agent_id:ctx.agentId,metadata:value.metadata
  }).select('*').single();
  if(error) throw new ToolError('TRANSIENT',error.message);
  return data;
}
