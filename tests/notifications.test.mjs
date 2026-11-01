import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationHref,sameOriginRequest} from '../src/lib/notifications.ts';
test('notification links stay inside the application',()=>{
 for(const value of ['https://evil.example','//evil.example','/\\evil.example','javascript:alert(1)','/\nevil.example',null,'']) assert.equal(notificationHref(value),'/notifications');
 assert.equal(notificationHref('/quotes/123?revision=2'),'/quotes/123?revision=2');
 assert.equal(notificationHref('/quotes/revisions'),'/quotes/revisions');
});

test('read-marker requests accept the public host and reject cross-origin requests',()=>{
 assert.equal(sameOriginRequest('http://127.0.0.1:3000','127.0.0.1:3000'),true);
 assert.equal(sameOriginRequest('https://arat.example','arat.example'),true);
 for(const origin of ['https://evil.example','null','invalid',null])assert.equal(sameOriginRequest(origin,'arat.example'),false);
});
