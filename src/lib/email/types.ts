export type EmailAttachment={fileName:string;mimeType:string;storagePath:string};
export type SendEmailInput={from:string;to:string[];subject:string;html:string;text?:string;attachments?:EmailAttachment[];idempotencyKey?:string};
export type SendEmailResult={providerMessageId:string;threadId?:string;sentAt:string};
export interface EmailProvider{send(input:SendEmailInput):Promise<SendEmailResult>;}
