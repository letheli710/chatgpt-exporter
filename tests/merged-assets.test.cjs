const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const visual=require('../extension/fast-visual');
const text=require('../extension/fast-text');
const docOf=html=>new JSDOM(`<article data-message-author-role="assistant" data-message-id="m"><div class="markdown">${html}</div></article>`,{url:'https://chatgpt.com/c/test'}).window.document;
test('image-only API messages survive fast extraction and request targeted assets',()=>{
 const result=text.records([{id:'m',author:{role:'user'},content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'private'}]}}]);
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].needsAssets,true);
 assert.doesNotMatch(JSON.stringify(result.messages),/private/);
});
test('archive keeps full API code while saving original images and standalone SVG',async()=>{
 const doc=docOf('<img src="/image.png" alt="示意图"><svg viewBox="0 0 100 100"><text>图示</text></svg>');
 const md='```js\n'+Array.from({length:120},(_,i)=>`line(${i});`).join('\n')+'\n```';let calls=0;
 const result=await visual.enrich({id:'m',md,needsAssets:true},{doc,fetch:async(url,options)=>{calls++;assert.equal(options.credentials,'same-origin');return {ok:true,blob:async()=>new Blob(['pixels'],{type:'image/png'})};}});
 assert.equal(calls,1);assert.ok(result.md.startsWith(md));assert.equal(result.assets.length,2);
 assert.deepEqual(result.assets.map(a=>a.kind),['original-image','svg']);assert.ok(result.assets.every(a=>a.messageId==='m'));
 assert.match(await result.assets[1].blob.text(),/xmlns=/);assert.equal(result.warnings.length,0);
 assert.equal(result.captureComplete,true);
});
test('card-contained images are owned by their screenshot; hidden and toolbar images excluded',()=>{
 const doc=docOf('<div data-archive-widget><img src="/card.png"></div><img hidden src="/secret.png"><button><svg viewBox="0 0 1 1"></svg></button><img src="/plain.png">');
 const nodes=visual.imageNodes(visual.findMessage('m',doc));assert.equal(nodes.length,1);assert.equal(nodes[0].getAttribute('src'),'/plain.png');
});
test('text preview does not fetch images; failed archive preserves body and reports missing asset',async()=>{
 const doc=docOf('<img src="https://example.com/image.png">');let calls=0;
 const fetch=async(url,options)=>{calls++;assert.equal(options.credentials,'omit');throw Error('offline');};
 const preview=await visual.enrich({id:'m',md:'body'},{doc,screenshot:false,fetch});assert.equal(calls,0);assert.equal(preview.assets.length,0);
 const result=await visual.enrich({id:'m',md:'body'},{doc,fetch});assert.equal(calls,1);assert.match(result.md,/body/);assert.match(result.warnings.join(),/图像 1 未保存/);assert.equal(result.captureComplete,false);
});
test('changed image invalidates visual cache and cancellation propagates',async()=>{
 const doc=docOf('<img src="/a.png">'),message={id:'m',md:'body'};
 const before=visual.signature(message,doc);doc.querySelector('img').src='/b.png';assert.notEqual(visual.signature(message,doc),before);
 const controller=new AbortController();controller.abort();await assert.rejects(visual.originalAsset(doc.querySelector('img'),message,{signal:controller.signal,path:'assets/m'}),{name:'AbortError'});
});
test('missing image DOM cannot be reported as a complete archive',async()=>{
 const result=await visual.enrich({id:'m',md:'body',needsAssets:true},{doc:docOf('<p>body</p>')});
 assert.equal(result.captureComplete,false);assert.match(result.warnings.join(),/未找到图像/);
});
test('failed original download falls back to a message-owned screenshot',async()=>{
 const doc=docOf('<img src="/blocked.png">'),previous=global.ChatExportAutomation;
 global.ChatExportAutomation={...require('../extension/automation'),captureElement:async()=>({blob:new Blob(['pixels']),width:100,height:80})};
 try{
  const result=await visual.enrich({id:'m',md:'body'},{doc,fetch:async()=>{throw Error('blocked');},capture:async()=>'',wait:async()=>{}});
  assert.equal(result.assets.length,1);assert.equal(result.assets[0].kind,'screenshot');assert.equal(result.captureComplete,true);
 }finally{global.ChatExportAutomation=previous;}
});
test('static screenshot dedup preserves code blank lines and cached text-only export',async()=>{
 const doc=docOf('<div data-archive-widget><p>图表标题</p><p>数值 123</p></div>'),previous=global.ChatExportAutomation;
 global.ChatExportAutomation={...require('../extension/automation'),captureElement:async()=>({blob:new Blob(['pixels']),width:100,height:80})};
 const code='```text\n图表标题\n\n\n\n数值 123\n```';
 try{
  const result=await visual.enrich({id:'m',md:'图表标题\n\n数值 123\n\n'+code},{doc,capture:async()=>'',wait:async()=>{}});
  assert.ok(result.md.includes(code));assert.match(result.textMd,/数值 123/);assert.doesNotMatch(result.textMd,/!\[/);
 }finally{global.ChatExportAutomation=previous;}
});
