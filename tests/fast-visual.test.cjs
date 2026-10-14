const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const visual=require('../extension/fast-visual');
const fs=require('node:fs');
const core=require('../extension/core');
const fixture=name=>{const data=JSON.parse(fs.readFileSync(`research/2026-10-12/${name}.json`,'utf8'));return new JSDOM(data.html,{url:data.url}).window.document;};
const docOf=html=>new JSDOM(html,{url:'https://chatgpt.com/c/test'}).window.document;
const turn=(id,html)=>`<article data-message-author-role="assistant" data-chatgpt-search-message-ids="${id}"><div class="markdown">${html}</div></article>`;
test('stable API id matches a token within merged DOM message ids, not a substring',()=>{
 const doc=docOf(turn('before r06 after','body'));
 assert.equal(visual.findMessage('r06',doc).id,'before r06 after');assert.equal(visual.findMessage('r0',doc),null);
 assert.equal(visual.boundaryOf(doc.querySelector('.markdown'),doc).id,'before r06 after');
 assert.equal(visual.parentBoundary(doc.querySelector('.markdown'),doc),doc.querySelector('article'));
});
test('ambiguous stable ids fail instead of mixing regenerated branches',()=>{
 const doc=docOf(turn('id','one')+turn('id','two'));assert.throws(()=>visual.findMessage('id',doc),/多个可见回答/);
});
// This semantic fixture models the 24-control R06 case recorded in FIRST-VALIDATION;
// the repository does not contain a saved DOM dump of the user's private conversation.
test('R06 checklist case recovers all 24 item descriptions and live checked states',async()=>{
 const items=Array.from({length:24},(_,i)=>`<label>验收条目 ${i+1}<input type="checkbox">说明 ${i+1}</label>`).join('');
 const doc=docOf(turn('r06',`<div data-dil-message-id="d06"><div data-d-component="box" data-d-has-border>${items}<p>完成进度</p></div></div>`));
 doc.querySelector('input').checked=true;
 const result=await visual.enrich({id:'r06',md:'API 标题'}, {doc,screenshot:false});
 for(let i=1;i<=24;i++)assert.match(result.md,new RegExp('说明 '+i));
 assert.ok(result.md.includes('\\[x\\]'));assert.match(result.md,/API 标题/);assert.match(result.md,/完成进度/);
 assert.equal(visual.uiBlocks(visual.findMessage('r06',doc)).length,1);
 assert.ok(result.timings.totalMs>=0);
});
test('R08 comparison case retains live select, slider and number values',async()=>{
 const doc=docOf(turn('r08','<div class="DilResponseRoot"><div data-d-component="box"><select aria-label="方案"><option>A</option><option>B</option></select><input aria-label="预算" type="number" value="1"><div role="slider" aria-label="比例" aria-valuenow="50"></div><p>Current selection unavailable.</p></div></div>'));
 doc.querySelector('select').value='B';doc.querySelector('input').value='250';
 const {md}=await visual.enrich({id:'r08',md:'比较正文'}, {doc,screenshot:false});
 assert.match(md,/B 方案/);assert.match(md,/250 预算/);assert.match(md,/50 比例/);assert.doesNotMatch(md,/Current selection unavailable/);
});
test('API full code stays intact when an interactive DOM editor only has initial lines',async()=>{
 const code='```python\n'+Array.from({length:120},(_,i)=>`print(${i})`).join('\n')+'\n```';
 const doc=docOf(turn('r07','<div class="DilResponseRoot"><div data-markdown-copy="code-block"><div class="cm-editor">print(0)<div class="cm-gap"></div></div></div><div data-archive-widget><button>Run</button><p>结果</p></div></div>'));
 const result=await visual.enrich({id:'r07',md:code}, {doc,screenshot:false});
 assert.ok(result.md.startsWith(code));assert.equal(result.md.match(/print\(0\)/g).length,1);assert.match(result.md,/结果/);
});
test('unloaded UI reports warning without scrolling; abort remains explicit',async()=>{
 const doc=docOf(turn('other','<input>'));const result=await visual.enrich({id:'missing',md:'完整 API'}, {doc});
 assert.equal(result.md,'完整 API');assert.match(result.warnings[0],/未加载/);
 const controller=new AbortController();controller.abort();await assert.rejects(visual.enrich({id:'missing',md:'body'},{doc,signal:controller.signal}),{name:'AbortError'});
});
test('hidden UI does not leak; screenshot errors preserve searchable text',async()=>{
 const doc=docOf(turn('a','<div class="DilResponseRoot"><div data-archive-widget><p>可保存</p><p hidden>secret</p><button>选择</button></div></div>'));
 const result=await visual.enrich({id:'a',md:'body'},{doc});assert.match(result.md,/可保存/);assert.doesNotMatch(result.md,/secret/);assert.match(result.warnings[0],/截图通道不可用/);
 await assert.rejects(visual.captureTarget(doc.body,{id:'a'},{doc}),/不属于所选消息/);
});
test('real LONG-R06 DOM recovers 24 labels once each and removes resolved live-state placeholder',async()=>{
 const doc=fixture('LONG-R06');const dom=core.discover(doc).find(m=>m.role==='assistant' && m.el.textContent.includes('R06-BEGIN'));
 const result=await visual.enrich({id:dom.id,md:'清单正文\n〔实时状态未包含在接口文字中，需要从页面补充〕',needsUI:true,uiReasons:['live-state']},{doc,screenshot:false});
 const labels=[...dom.el.querySelectorAll('label')].map(n=>n.textContent.trim());assert.equal(labels.length,24);
 for(const label of labels){assert.ok(result.md.includes(label),label);assert.equal(result.md.split(label).length-1,1,label);}
 assert.equal(result.textSupplemented,true);assert.doesNotMatch(result.md,/实时状态未包含/);assert.equal(visual.uiBlocks(dom).length,1);
});
test('real LONG-R07 table uses exact visible literal while fenced source programs remain untouched',async()=>{
 const doc=fixture('LONG-R07');const dom=core.discover(doc).find(m=>m.role==='assistant' && m.el.textContent.includes('R07-BEGIN'));
 const source='```text\n| 测试编号 | 测试内容 | 预期保留值 |\n| --- | --- | --- |\n| T01 | code | unchanged |\n```';
 const md=source+'\n\n| 测试编号 | 测试内容 | 预期保留值 |\n| --- | --- | --- |\n| T01 | 竖线字符 | <code>Solar \\\\\\\\&#124; Battery</code> |\n\n> 表格代码单元格已保留接口原字符并修复分列；页面显示的转义字符需要核对。';
 const result=await visual.enrich({id:dom.id,md,needsUI:true,needsTableUI:true,uiReasons:['table-literal']},{doc,screenshot:false});
 assert.ok(result.md.startsWith(source));assert.match(result.md,/<code>Solar &#92;&#124; Battery<\/code>/);
 assert.doesNotMatch(result.md,/页面显示的转义字符需要核对/);assert.equal(result.tableCorrected,true);assert.equal(result.textSupplemented,true);assert.equal(result.assets.length,0);assert.equal(visual.uiBlocks(dom).length,0);
 const {marked}=require('marked');const rendered=new JSDOM(marked.parse(result.md)).window.document;
 const row=[...rendered.querySelectorAll('tr')].find(n=>n.firstElementChild?.textContent==='T01');assert.equal(row.children.length,3);assert.equal(row.children[2].textContent,'Solar \\| Battery');
});
test('model-dil ordinary prose does not force screenshots or duplicate API code',async()=>{
 const doc=docOf(turn('plain','<div class="DilResponseRoot"><p>普通全文</p><div data-markdown-copy="code-block"><div class="cm-editor">line1</div></div></div>'));
 const message={id:'plain',md:'完整API代码',needsUI:true,uiReasons:['model-dil']};
 const result=await visual.enrich(message,{doc,screenshot:true});assert.equal(result.md,message.md);assert.equal(result.textSupplemented,true);assert.equal(result.captureComplete,true);assert.deepEqual(result.warnings,[]);assert.equal(visual.hasUI(message,doc),false);
 const before=visual.signature(message,doc);doc.querySelector('.cm-editor').textContent='line90';assert.equal(visual.signature(message,doc),before);
});
test('signature follows live UI values and checkbox state, excluding virtual code fragments',()=>{
 const doc=docOf(turn('sig','<div data-archive-widget><p>当前配置</p><input type="number" value="2"><input type="checkbox"><div data-markdown-copy="code-block"><div class="cm-editor">line1</div></div></div>'));
 const message={id:'sig'};const a=visual.signature(message,doc);doc.querySelector('input[type="number"]').value='4';const b=visual.signature(message,doc);assert.notEqual(a,b);
 doc.querySelector('input[type="checkbox"]').checked=true;const c=visual.signature(message,doc);assert.notEqual(b,c);
 doc.querySelector('.cm-editor').textContent='line100';assert.equal(visual.signature(message,doc),c);
});
