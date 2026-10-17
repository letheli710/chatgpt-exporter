const {test}=require('./private-fixtures.cjs');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const core=require('../extension/core');
const {RecordStore}=require('../extension/automation');
const fs=require('node:fs');
const pair=(chat,prefix)=>`<div data-chatgpt-selection-conversation-id="local-chatgpt:${chat}"><div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-message-id="${prefix}u"><div data-user-message-bubble>${prefix} question</div></div><div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-message-id="${prefix}a"><div class="markdown">${prefix} answer</div></div></div>`;
test('cached inactive conversations cannot enter active conversation archive',()=>{
  const d=new JSDOM(`<div hidden>${pair('old','old')}</div><div role="region" aria-label="Conversation">${pair('current','current')}</div>`,{url:'https://chatgpt.com/c/current'}).window.document;
  const store=new RecordStore();store.observe(core.discover(d));
  assert.deepEqual(store.values().map(m=>m.id),['currentu','currenta']);
});
test('CSS-hidden chats and foreign conversation metadata are excluded without hiding offscreen messages',()=>{
  const d=new JSDOM(`<style>.inactive{display:none}</style><div class="inactive" role="region" aria-label="Conversation">${pair('old','old')}</div><div role="region" aria-label="Conversation">${pair('current','current')}<div style="margin-top:30000px">${pair('current','offscreen')}</div>${pair('foreign','foreign')}</div>`,{url:'https://chatgpt.com/c/current'}).window.document;
  assert.deepEqual(core.discover(d).map(m=>m.id),['currentu','currenta','offscreenu','offscreena']);
});
test('store refuses cross-chat batches before changing cache',()=>{
  const store=new RecordStore();store.observe([{id:'a',conversationId:'first'}]);
  assert.throws(()=>store.observe([{id:'b',conversationId:'second'}]),/不同聊天/);
  assert.deepEqual(store.ids,['a']);
});
test('an unambiguous visible local alias may differ from the route ID',()=>{
  const d=new JSDOM(`<div role="region" aria-label="Conversation">${pair('local-alias','current')}</div>`,{url:'https://chatgpt.com/c/remote-id'}).window.document;
  assert.equal(core.discover(d).length,2);
});
test('remote conversation mismatch stops instead of exporting the previous page',()=>{
  const d=new JSDOM(`<div role="region" aria-label="Conversation">${pair('old','old').replaceAll('local-chatgpt:','')}</div>`,{url:'https://chatgpt.com/c/current'}).window.document;
  assert.throws(()=>core.discover(d),/不匹配/);
});
test('real active DOM plus cached foreign DOM preserves actual turn order',()=>{
  const active=JSON.parse(fs.readFileSync('archive/research/2026-10-12/V2-ACTIVE-CONVERSATION.json'));
  const foreign=JSON.parse(fs.readFileSync('archive/research/2026-10-12/USER-SHARE-TEST1.json'));
  const d=new JSDOM(`<div style="display:none">${foreign.html}</div>${active.html}`,{url:active.url}).window.document;
  const store=new RecordStore();store.observe(core.discover(d));
  assert.equal(store.values().length,18);
  assert.deepEqual(store.values().map(m=>m.role),Array.from({length:18},(_,i)=>i%2?'assistant':'user'));
  assert.ok(store.values().every(m=>m.conversationId==='6acd61d7-98f8-83e9-a882-c849b6319b87'));
});
