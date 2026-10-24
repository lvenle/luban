import test from 'node:test';
import assert from 'node:assert/strict';
import {appUrl,applicationPath} from '../public/common/application-base.js';
test('mounted frontend preserves its routes and leaves central identity and external URLs unchanged',()=>{
 const previous=globalThis.document;
 try{
  globalThis.document={querySelector:()=>({getAttribute:()=>'/luban/'})};
  assert.equal(appUrl('/api/ai/chat'),'/luban/api/ai/chat');
  assert.equal(appUrl('/luban/api/ai/chat'),'/luban/api/ai/chat');
  assert.equal(appUrl('/api/identity/logout'),'/api/identity/logout');
  assert.equal(appUrl('https://example.test/a'),'https://example.test/a');
  assert.equal(applicationPath('/luban/app/demo/page/main'),'/app/demo/page/main');
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
 assert.equal(appUrl('/api/ai/chat'),'/api/ai/chat');
});
