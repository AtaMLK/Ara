const UUID_SOURCE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function displayText(value:unknown,labels:Record<string,string>={}):string {
 const text=value==null?'':String(value);
 if(/AI output failed schema validation|expected.*received.*invalid_type/i.test(text))return 'The response could not be processed. Review the request and try again.';
 if(/Could not embed because more than one relationship/i.test(text))return 'Related information could not be loaded. Please try again.';
 if(/duplicate key value violates/i.test(text))return 'This information is already recorded. Refresh before trying again.';
 return text.replace(new RegExp(UUID_SOURCE,'gi'),id=>labels[id.toLowerCase()]||'linked item');
}
export function quoteDisplayReference(reference:string,stored?:string|null):string {
 const value=stored||reference;
 return new RegExp(UUID_SOURCE,'i').test(value)?'Draft quotation':value;
}
export function internalIds(texts:string[]):string[]{return [...new Set(texts.flatMap(text=>text.match(new RegExp(UUID_SOURCE,'gi'))??[]))].slice(0,200);}
