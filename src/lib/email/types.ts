export type EmailAttachment={fileName:string;mimeType:string;storagePath:string};
export type GeneratedEmailAttachment={fileName:string;mimeType:string;content:Uint8Array;cid?:string};
export type SendEmailInput={from:string;to:string[];replyTo?:string;subject:string;html:string;text?:string;attachments?:EmailAttachment[];generatedAttachments?:GeneratedEmailAttachment[];idempotencyKey?:string;inquiryId?:string};
export type SendEmailResult={providerMessageId:string;threadId?:string;sentAt:string};
export interface EmailProvider{send(input:SendEmailInput):Promise<SendEmailResult>;}
