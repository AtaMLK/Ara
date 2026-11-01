import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supplierNameIssue } from '../src/lib/suppliers/identity.ts';

test('supplier identity rejects product codes and scraped sentence fragments', () => {
  for (const name of ['D5011S','The single channel Repeater Power','We are an authorized GMI','Repeater Power','HS-421T handsfor Dual-output accelerometer with']) {
    assert.ok(supplierNameIssue(name),name);
  }
});
test('supplier identity keeps plausible names across languages and short brands', () => {
  for (const name of ['3M','W H Good','WiAutomation','Anvex Shop','ÖZHAT','شرکت آریا','G.M. International S.p.A.']) {
    assert.equal(supplierNameIssue(name),null,name);
  }
});
