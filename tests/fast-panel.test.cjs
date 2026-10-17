const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const {JSDOM}=require('jsdom');
test('default fast panel loads unloaded history, selects messages, previews repeatedly without extra requests or scrolling',async()=>{
 const dom=new JSDOM('<div data-message-id="b">Visible answer</div>',{url:'https://chatgpt.com/c/chat',runScripts:'outside-only'}),w=dom.window;let requests=0;
 const data={title:'Test',current_node:'b',mapping:{a:{parent:null,children:['b'],message:{id:'a',author:{role:'user'},content:{parts:['Unloaded history']}}},b:{parent:'a',children:[],message:{id:'b',author:{role:'assistant'},content:{parts:['Visible answer']}}}}};
 w.fetch=async path=>{requests++;return {ok:true,json:async()=>path==='/api/auth/session'?{accessToken:'test'}:data};};w.scrollTo=()=>assert.fail('must not scroll');
 w.eval(fs.readFileSync('extension/fast-text.js','utf8'));w.eval(fs.readFileSync('extension/fast-content.js','utf8'));
 const s=w.document.querySelector('[data-archive-owned]').shadowRoot;for(let i=0;i<30&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(s.querySelectorAll('#list input').length,2);s.getElementById('preview').click();await new Promise(r=>setTimeout(r,5));assert.match(s.getElementById('output').value,/Unloaded history/);
 s.querySelector('#list input').checked=false;s.getElementById('preview').click();await new Promise(r=>setTimeout(r,5));assert.doesNotMatch(s.getElementById('output').value,/Unloaded history/);assert.equal(requests,2);
 w.history.pushState({},'', '/c/other');s.getElementById('preview').click();await new Promise(r=>setTimeout(r,5));assert.match(s.getElementById('status').textContent,/切换对话/);dom.window.close();
});
test('ZIP download names the file by version, honours save-as, refuses a switched chat and survives re-injection',async()=>{
 const dom=new JSDOM('<div data-message-id="answer">source</div>',{url:'https://chatgpt.com/c/chat',runScripts:'outside-only'}),w=dom.window;
 const files=[],downloads=[],idle=async s=>{for(let i=0;i<100&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));};
 w.fetch=async path=>({ok:true,json:async()=>path==='/api/auth/session'?{accessToken:'test'}:{title:'sample',current_node:'answer',mapping:{answer:{parent:null,children:[],message:{id:'answer',author:{role:'assistant'},content:{parts:['API original']}}}}}});
 w.chrome={runtime:{sendMessage:async m=>{downloads.push(m);return {id:1};}}};w.URL.createObjectURL=()=>'blob:https://chatgpt.com/test';w.URL.revokeObjectURL=()=>{};
 w.JSZip=class{file(name,data){files.push({name,data});}async generateAsync(){return new w.Blob(['archive']);}};
 w.eval(fs.readFileSync('extension/fast-text.js','utf8'));w.eval(fs.readFileSync('extension/fast-content.js','utf8'));const s=w.document.querySelector('[data-archive-owned]').shadowRoot;await idle(s);
 s.getElementById('archive').click();await idle(s);
 const manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);assert.ok(manifest.timings.readMs>=0);assert.deepEqual(manifest.messages,['answer']);
 assert.match(files.find(f=>f.name==='conversation.md').data,/API original/);
 assert.equal(downloads[0].filename,`sample-swift-${require('../extension/manifest.json').version}.zip`);assert.equal(downloads[0].saveAs,false);
 s.getElementById('saveAs').checked=true;s.getElementById('archive').click();await idle(s);assert.equal(downloads[1].saveAs,true);
 w.history.pushState({},'','/c/other');s.getElementById('archive').click();await idle(s);assert.match(s.getElementById('status').textContent,/切换对话/);assert.equal(downloads.length,2);
 // Chrome reloads an extension's isolated world without removing its old DOM.
 w.__fastTextPanel=undefined;w.eval(fs.readFileSync('extension/fast-content.js','utf8'));assert.equal(w.document.querySelectorAll('[data-archive-owned="fast-text"]').length,1);
 dom.window.close();
});
