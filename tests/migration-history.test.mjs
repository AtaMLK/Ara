import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
test('deployed migration files match the recorded SQL history',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('../docs/database/migration-manifest.json',import.meta.url),'utf8'));
 assert.ok(rows.length>=22);
 for(const row of rows){
  const sql=fs.readFileSync(new URL('../'+row.file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(sql).digest('hex'),row.sha256,row.file);
 }
});
