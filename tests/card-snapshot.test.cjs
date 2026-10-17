const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
const render=require('../extension/dil-render');const text=require('../extension/fast-text');
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/dil-checkbox-longcard-appblock.raw.json','utf8'));
const [CHECK,LONG,RESOURCE]=['ab11004d-b6a8-47a5-a43e-f02ea863fb74','dc5b5b3e-e454-4de8-becf-a42ee48827e6','0a5e2ea3-32e8-4c78-a764-9aa0e9c66a11'];
const vmExecute=(code,scope)=>vm.runInNewContext(code,{...scope},{timeout:1000});
const tree=id=>render.evaluate(text.parseTree(fixture).messages.find(m=>m.id===id).dil,vmExecute);
const idle=async s=>{for(let i=0;i<300&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));};

test('real fixture: prose outside the card stays Markdown, each card is its own segment',()=>{
  for(const [id,before,after] of [[CHECK,'复选开始','复选结束'],[LONG,'长卡开始','长卡结束'],[RESOURCE,'资源开始','资源结束']]){
    const parts=render.segments(tree(id));
    assert.deepEqual(parts.map(p=>p.kind),['md','card','md'],id);
    assert.equal(render.toMarkdown(parts[0].tree),before);assert.equal(render.toMarkdown(parts[2].tree),after);
  }
});
test('real fixture: card HTML is well-formed XHTML with layout props and every row',()=>{
  const parse=html=>new (new JSDOM('').window.DOMParser)().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,'application/xml');
  const check=render.toHtml(render.segments(tree(CHECK))[1].tree),long=render.toHtml(render.segments(tree(LONG))[1].tree),res=render.toHtml(render.segments(tree(RESOURCE))[1].tree);
  for(const html of [check,long,res])assert.equal(parse(html).getElementsByTagName('parsererror').length,0,html);
  assert.match(check,/max-width:260px/);assert.match(check,/<span class="cb-box"><\/span><span>测试开关<\/span>/);assert.match(check,/当前值：<\/span><strong>关<\/strong>|当前值：<strong>关<\/strong>/);
  assert.equal(long.match(/行\d\d — 这是用于验证滚动截图的测试内容。/g).length,30);assert.match(long,/<hr class="hr"\/>/);assert.match(long,/padding:4px 0px/);
  assert.match(res,/图片未挂载/);assert.match(res,/<p class="t fs-sm c-secondary">图片未挂载<\/p>/);
  assert.doesNotMatch(render.toHtml({type:'text',props:{},children:['<script>&']}),/<script>/);
});
test('sandbox snapshot keeps text when a card cannot be rasterized',async()=>{
  const dom=new JSDOM('<body></body>');globalThis.ChatExportDilRender=render;delete require.cache[require.resolve('../extension/sandbox.js')];require('../extension/sandbox.js');
  const dil=text.parseTree(fixture).messages.find(m=>m.id===CHECK).dil;
  const result=await globalThis.ChatExportDilSandbox.snapshot({dil},dom.window.document);
  assert.deepEqual(result.segments.map(s=>s.kind),['md','card','md']);assert.ok(result.segments[1].error);assert.equal(result.timings.cards,1);assert.ok(result.timings.totalMs>=0);assert.equal(dom.window.document.body.children.length,0);
});
test('panel: ZIP embeds one PNG per card with folded text, prose stays outside',async()=>{
  const dom=new JSDOM(`<div data-message-id="${RESOURCE}">x</div>`,{url:'https://chatgpt.com/c/6ad0d397-212c-83e9-a872-c74862120015',runScripts:'outside-only'}),w=dom.window;
  const files=[];let snapshots=0;
  w.fetch=async path=>path==='/api/auth/session'?{ok:true,json:async()=>({accessToken:'t'})}:{ok:true,json:async()=>fixture};
  w.ChatExportDilEvaluate=async dil=>render.evaluate(dil,vmExecute);
  w.ChatExportDilSnapshot=async dil=>{snapshots++;return {segments:render.segments(render.evaluate(dil,vmExecute)).map(s=>s.kind==='card'?{...s,png:new Uint8Array([137,80,78,71]).buffer,width:300,height:120}:s)};};
  w.chrome={runtime:{sendMessage:async()=>({id:1})}};w.URL.createObjectURL=()=> 'blob:https://chatgpt.com/t';w.URL.revokeObjectURL=()=>{};
  w.JSZip=class{file(name,data){files.push({name,data});}async generateAsync(){return new w.Blob(['zip']);}};
  w.ChatExportDilRender=render;w.eval(fs.readFileSync('extension/fast-text.js','utf8'));w.eval(fs.readFileSync('extension/fast-content.js','utf8'));
  const s=w.document.querySelector('[data-archive-owned]').shadowRoot;await idle(s);assert.equal(snapshots,3);
  s.getElementById('preview').click();await idle(s);assert.doesNotMatch(s.getElementById('output').value,/assets\/card-|\[!note\]/);assert.match(s.getElementById('output').value,/当前值：\*\*关\*\*/);
  s.getElementById('archive').click();await idle(s);
  const md=files.find(f=>f.name==='conversation.md').data,card=`assets/card-${CHECK}-1.png`;
  assert.ok(md.includes(`复选开始\n\n![交互卡片](${card})\n\n> [!note]- 卡片文字\n> - [ ] 测试开关\n>\n> 当前值：**关**\n\n复选结束`),md);
  assert.match(md,/> 行30 — 这是用于验证滚动截图的测试内容。/);assert.ok(files.some(f=>f.name===card));assert.equal(files.filter(f=>f.name.startsWith('assets/card-')).length,3);
  const manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);assert.equal(manifest.assets.find(a=>a.path===card).width,300);assert.equal(manifest.timings.render.uiMessages,3);assert.deepEqual(manifest.timings.render.messages.map(m=>m.id),[CHECK,LONG,RESOURCE]);assert.ok(manifest.timings.render.wallMs>=0);
  assert.match(s.getElementById('status').textContent,/3 张卡片图、1 个嵌入应用、0 张截图/);
  dom.window.close();
});
