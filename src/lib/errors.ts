export type ToolErrorCode='VALIDATION'|'AUTHORIZATION'|'NOT_FOUND'|'CONFLICT'|'TRANSIENT'|'AI_PROCESSING'|'APPROVAL_REQUIRED';

export class ToolError extends Error {
  constructor(public readonly code:ToolErrorCode,message:string,public readonly details?:unknown){super(message);this.name='ToolError';}
}
