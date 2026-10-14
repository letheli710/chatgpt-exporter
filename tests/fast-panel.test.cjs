const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const {JSDOM}=require('jsdom');
test('default fast panel loads unloaded history, selects messages, previews repeatedly without extra requests or scrolling',async()=>{
 const dom=new JSDOM('<div data-message-id="b">Visible answer</div>',{url:'https://chatgpt.com/c/chat',runScripts:'outside-only'}),w=dom.window;let requests=0;
 const data={title:'Test',current_node:'b',mapping:{a:{parent:null,children:['b'],message:{id:'a',author:{role:'user'},content:{parts:['Unloaded history']}}},b:{parent:'a',children:[],message:{id:'b',author:{role:'assistant'},content:{parts:['Visible answer']}}}}};
 w.fetch=async path=>{requests++;return {ok:true,json:async()=>path==='/api/auth/session'?{accessToken:'test'}:data};};w.scrollTo=()=>assert.fail('must not scroll');
 w.eval(fs.readFileSync('extension/fast-text.js','utf8'));w.eval(fs.readFileSync('extension/fast-content.js','utf8'));
 const s=w.document.querySelector('[data-archive-owned]').shadowRoot;for(let i=0;i<30&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(s.querySelectorAll('#list input').length,2);s.getElementById('preview').click();assert.match(s.getElementById('output').value,/Unloaded history/);
 s.querySelector('#list input').checked=false;s.getElementById('preview').click();assert.doesNotMatch(s.getElementById('output').value,/Unloaded history/);assert.equal(requests,2);
 w.history.pushState({},'', '/c/other');s.getElementById('preview').click();assert.match(s.getElementById('status').textContent,/切换对话/);dom.window.close();
});
