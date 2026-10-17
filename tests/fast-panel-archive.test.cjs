const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const idle=async s=>{for(let i=0;i<100&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));};
test('archive panel wires UI completion, ZIP assets and timing, reuses cache and invalidates changed live state',async()=>{
 const dom=new JSDOM('<div data-message-id="answer">source</div>',{url:'https://chatgpt.com/c/chat',runScripts:'outside-only'}),w=dom.window;
 let requests=0,enrichCalls=0,signature='initial';const files=[],downloads=[],enrichedModes=[];
 w.fetch=async path=>{requests++;return {ok:true,json:async()=>path==='/api/auth/session'?{accessToken:'test'}:{title:'sample',current_node:'answer',mapping:{answer:{parent:null,children:[],message:{id:'answer',author:{role:'assistant'},content:{parts:['API original']},metadata:{model_dil_v2:{fallbackMarkdown:'API original'}}}}}}};};
 w.ChatExportFastVisual={hasUI:()=>true,signature:()=>signature,enrich:async(m,o)=>{enrichCalls++;enrichedModes.push(o.screenshot);return {md:o.screenshot?m.md+'\n![UI](assets/answer.png)':m.md+'\n\n24 labels and current values',textMd:m.md+'\n\n24 labels and current values',assets:o.screenshot?[{path:'assets/answer.png',blob:new w.Blob(['bytes']),messageId:m.id}]:[],warnings:[],textSupplemented:true,captureComplete:o.screenshot};}};
 w.chrome={runtime:{sendMessage:async m=>{downloads.push(m);return {id:1};}}};w.URL.createObjectURL=()=> 'blob:https://chatgpt.com/test';w.URL.revokeObjectURL=()=>{};
 w.JSZip=class{file(name,data){files.push({name,data});}async generateAsync(){return new w.Blob(['archive']);}};
 w.eval(fs.readFileSync('extension/fast-text.js','utf8'));w.eval(fs.readFileSync('extension/fast-content.js','utf8'));const s=w.document.querySelector('[data-archive-owned]').shadowRoot;await idle(s);s.getElementById('live').checked=true;
 s.getElementById('preview').click();await idle(s);assert.match(s.getElementById('output').value,/API original[\s\S]*24 labels/);assert.equal(enrichCalls,1);
 s.getElementById('archive').click();await idle(s);assert.equal(enrichCalls,2);assert.deepEqual(enrichedModes,[false,true]);assert.ok(files.some(f=>f.name==='assets/answer.png'));
 const manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);assert.ok(manifest.timings.readMs>=0);assert.deepEqual(manifest.messages,['answer']);assert.equal(downloads[0].filename,`sample-swift-${require('../extension/manifest.json').version}.zip`);
 assert.equal(downloads[0].saveAs,false);s.getElementById('saveAs').checked=true;
 s.getElementById('archive').click();await idle(s);assert.equal(enrichCalls,2);assert.equal(requests,2);assert.equal(downloads[1].saveAs,true);
 s.getElementById('preview').click();await idle(s);assert.doesNotMatch(s.getElementById('output').value,/assets\//);assert.match(s.getElementById('output').value,/24 labels and current values/);assert.equal(enrichCalls,2);
 signature='changed live selection';s.getElementById('preview').click();await idle(s);assert.equal(enrichCalls,3);assert.equal(requests,2);
 w.history.pushState({},'', '/c/other');s.getElementById('archive').click();await idle(s);assert.match(s.getElementById('status').textContent,/切换对话/);assert.equal(downloads.length,2);
 // Chrome reloads an extension's isolated world without removing its old DOM.
 w.__fastTextPanel=undefined;w.eval(fs.readFileSync('extension/fast-content.js','utf8'));await idle(w.document.querySelector('[data-archive-owned]').shadowRoot);assert.equal(w.document.querySelectorAll('[data-archive-owned="fast-text"]').length,1);
 dom.window.close();
});
