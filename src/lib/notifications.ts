export function notificationHref(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/notifications';
  try { const url=new URL(value,'https://arat.invalid'); return url.origin==='https://arat.invalid' ? url.pathname+url.search+url.hash : '/notifications'; }
  catch { return '/notifications'; }
}

export type AdminAttention = {
  unreadCount:number;
  notifications:Array<{id:string;title:string;message:string;action_url:string|null;created_at:string}>;
  revisionCount:number;
  revisions:Array<{id:string;quoteId:string;reference:string;reason:string;message:string|null}>;
  approvals:number;
  rfqs:number;
  alerts:number;
  tasks:number;
  draftCount:number;
  drafts:Array<{id:string;reference:string;status:string}>;
};

export function sameOriginRequest(origin:string|null,host:string|null):boolean {
 if(!origin||!host)return false;
 try{const url=new URL(origin);return ['http:','https:'].includes(url.protocol)&&url.host===host&&!url.username&&!url.password;}catch{return false;}
}
