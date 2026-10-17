const {test}=require('./private-fixtures.cjs');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const visual=require('../extension/fast-visual');
const fs=require('node:fs');
const core=require('../extension/core');
// Real conversation captures stay private under ignored research/. These local
// regression checks intentionally require the owner's existing evidence files.
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
 assert.ok(result.md.includes('☑ 已勾选'));assert.match(result.md,/API 标题/);assert.match(result.md,/完成进度/);
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
test('unmounted UI is targeted by stable API order, remounted and scroll position restored',async()=>{
 const doc=docOf('<main></main>'),messages=Array.from({length:10},(_,i)=>({id:'m'+i,role:'assistant',md:'API '+i}));let position=9000,moves=0;
 const mount=index=>{doc.querySelector('main').innerHTML=turn('m'+index,`<div data-archive-widget>界面 ${index}<input value="${index}"></div>`);};mount(9);
 const scroll={position:()=>position,range:()=>9000,move:value=>{position=value;moves++;mount(Math.min(9,Math.floor(value/1000)));}};
 const result=await visual.withScrollRestore(doc,async()=>{
   const found=await visual.locateMessage(messages[1],{doc,messages,scroll,wait:async()=>{}});assert.equal(found.id,'m1');
   return visual.enrich({...messages[1],needsUI:true,uiReasons:['live-state']},{doc,messages,scroll,wait:async()=>{},screenshot:false});
 },{scroll});
 assert.match(result.md,/界面 1/);assert.equal(position,9000);assert.ok(moves<=16);assert.match(doc.querySelector('main').textContent,/界面 9/);
});
test('targeted remount never substitutes a different branch id and stays bounded',async()=>{
 const doc=docOf(turn('m1-alternative','wrong branch'));
 const messages=[{id:'m0'},{id:'m1'},{id:'m2'}];let moves=0,position=2000;
 const scroll={position:()=>position,range:()=>2000,move:value=>{position=value;moves++;doc.body.innerHTML=turn('m1-alternative','wrong branch');}};
 const found=await visual.locateMessage(messages[1],{doc,messages,scroll,wait:async()=>{},maxAttempts:6});assert.equal(found,null);assert.ok(moves<=6);
});
test('stable block resolves the selected id again after its original DOM node unmounts',async()=>{
 const doc=docOf(turn('selected','<div data-archive-widget><p>Current UI</p><input value="2"></div>'));const message={id:'selected'},original=visual.findMessage('selected',doc),path=core.nodePath(original,original.el.querySelector('[data-archive-widget]'));
 let waits=0;const el=await visual.stableBlock(message,path,{doc,wait:async()=>{waits++;if(waits===1)doc.body.innerHTML=turn('selected','<div data-archive-widget><p>Current UI</p><input value="2"></div>');}});
 assert.equal(el.isConnected,true);assert.notEqual(el,original.el.querySelector('[data-archive-widget]'));assert.equal(visual.boundaryOf(el,doc).id,'selected');
});
test('real API normalization with inline math still replaces the complete seven-row table once',async()=>{
 const doc=fixture('LONG-R07'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R07-BEGIN'));
 // Exact problematic table structure extracted from the user's v0.5 export.
 const sample=['| 测试编号 | 测试内容 | 预期保留值 |','|--------|--------|--------|','| T01 | 竖线字符 | `Solar \\\\| Battery` |','| T02 | 反引号字符串 | `` `400W` `` |','| T03 | 数学符号 | \\(E=P\\times t\\) |','| T04 | Unicode字符 | η、Δ、≥、≤ |','| T05 | 正负能源值 | \\+1.12 / −0.16 |','| T06 | 文件名 | `solar_config.json` |'].join('\n');
 const normalized=require('../extension/fast-text').normalizeText(sample);
 const repaired=await visual.repairTables(normalized.md,dom),{marked}=require('marked');
 const table=new JSDOM(marked.parse(repaired.md)).window.document.querySelector('table');assert.equal(table.querySelectorAll('tr').length,7);
 for(const id of ['T01','T02','T03','T04','T05','T06'])assert.equal((repaired.md.match(new RegExp('\\| '+id+' \\|','g')) || []).length,1,id);
 assert.doesNotMatch(repaired.md,/页面显示的转义字符需要核对/);
});
test('real checked UI controls use unambiguous text rather than LaTeX bracket delimiters',async()=>{
 const doc=fixture('LONG-R06'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R06-BEGIN'));
 const controls=[...dom.el.querySelectorAll('[role="checkbox"]')];controls[0].setAttribute('aria-checked','true');controls[1].setAttribute('aria-checked','true');
 const text=await visual.uiText(visual.uiBlocks(dom)[0],dom.id);
 assert.equal((text.match(/☑ 已勾选/g) || []).length,2);assert.equal((text.match(/☐ 未勾选/g) || []).length,22);
 assert.doesNotMatch(text,/\\\[x\\\]/);
});
test('cold mounted UI settles asynchronous chart subtree before blocks are finalized',async()=>{
 const doc=docOf(turn('async','<div class="DilResponseRoot"><div data-archive-widget>参数值<input value="2"></div><div id="late"></div></div>'));
 let waits=0;const result=await visual.enrich({id:'async',md:'API 正文',needsUI:true,uiReasons:['structured-ui']},{doc,screenshot:false,wait:async()=>{waits++;if(waits===2)doc.querySelector('#late').innerHTML='<div role="img" aria-label="概率 chart"><div data-w-component="chart"><svg><text>概率分布 20%</text></svg></div></div>';}});
 assert.ok(waits>=3);assert.match(result.md,/概率分布 20%/);assert.equal(visual.uiBlocks(visual.findMessage('async',doc)).length,2);assert.equal(result.uiReady,true);
});
test('viewport lazy chart shell is activated inside only selected message',async()=>{
 const doc=docOf(turn('lazy','<div class="DilResponseRoot"><div role="img" aria-label="概率 chart"><div data-w-component="chart" aria-busy="true"></div></div></div>'));
 let entered=0;doc.querySelector('[role="img"]').scrollIntoView=()=>{entered++;doc.querySelector('[data-w-component="chart"]').removeAttribute('aria-busy');doc.querySelector('[data-w-component="chart"]').innerHTML='<svg><text>已加载概率图</text></svg>';};
 const result=await visual.enrich({id:'lazy',md:'body',needsUI:true,uiReasons:['structured-ui']},{doc,screenshot:false,wait:async()=>{}});
 assert.equal(entered,1);assert.match(result.md,/已加载概率图/);assert.equal(result.uiReady,true);
});
test('permanently pending UI is bounded and cannot report complete screenshots',async()=>{
 const doc=docOf(turn('pending','<div class="DilResponseRoot"><div role="img" aria-label="pending chart"><div data-w-component="chart" aria-busy="true"></div></div></div>'));let waits=0;
 const result=await visual.enrich({id:'pending',md:'body',needsUI:true,uiReasons:['structured-ui']},{doc,screenshot:false,wait:async()=>{waits++;}});
 assert.ok(waits<=10);assert.equal(result.uiReady,false);assert.equal(result.captureComplete,false);assert.ok(result.warnings.some(w=>w.includes('仍在加载')));
});
test('real R08 UI repairs only proven empty numeric rows and displays without inventing values',async()=>{
 const doc=fixture('LONG-R08'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R08-BEGIN')),text=await visual.uiText(visual.uiBlocks(dom)[0],dom.id);
 const ordinary='普通正文：展示屏实际计划为每天6小时。\n\n| 指标 | 旧方案 | 新方案 |\n| --- | --- | --- |\n| 每日负载 | 0.48 kWh | 0.60 kWh |';
 const body='展示屏每日运行  小时\n\n每日计划总负载\n\nkWh/日\n\n照明 0.24 kWh 展示屏  kWh\n\n| 每日负载 | kWh | kWh |\n| --- | --- | --- |\n| 净余量 | \\+ kWh | \\+ kWh |\n| 续航 | 天 | 天 |\n\n'+ordinary;
 const repaired=visual.repairedUIBody(body,text);assert.doesNotMatch(repaired,/运行\s+小时|展示屏\s+kWh|\| 每日负载 \| kWh \| kWh \||\| 净余量 \| \\?\+ kWh/);
 assert.ok(repaired.endsWith(ordinary));assert.match(repaired,/每日计划总负载\n\n# [\d.]+\n\nkWh\/日/);
 const {marked}=require('marked'),rendered=new JSDOM(marked.parse(repaired)).window.document;const comparison=[...rendered.querySelectorAll('table')].find(t=>t.rows[0].cells[0].textContent==='每日负载');
 assert.equal(comparison.rows.length,3);for(const row of comparison.rows)for(const cell of [...row.cells].slice(1))assert.match(cell.textContent,/\d/);
});
test('real R06 UI restores empty progress templates; ambiguous unmatched templates stay explicit',async()=>{
 const doc=fixture('LONG-R06'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R06-BEGIN')),text=await visual.uiText(visual.uiBlocks(dom)[0],dom.id);
 const body='# %\n\n/  项完成\n\n尚有  项待验收 [恢复初始状态]\n\n普通说明不应该改变。';
 const repaired=visual.repairedUIBody(body,text);assert.match(repaired,/8%/);assert.match(repaired,/2 \/ 24 项完成/);assert.match(repaired,/尚有 22 项待验收/);assert.ok(repaired.endsWith('普通说明不应该改变。'));
 const ambiguous=visual.repairedUIBody('未知值 〔实时状态未包含在接口文字中，需要从页面补充〕 kg','不同值 5 kg');assert.match(ambiguous,/实时状态未包含/);
});
test('UI skeleton repair protects literal programs and exact row labels',()=>{
 const table='| 项目1 | kg | kg |\n| --- | --- | --- |\n| 项目2 | kg | kg |';
 const source='| 项目1 | 1 kg | 2 kg |\n| --- | --- | --- |\n| 项目2 | 3 kg | 4 kg |';
 const program='```text\n'+table+'\n```';assert.equal(visual.repairedUIBody(program,source),program);
 assert.equal(visual.repairedUIBody(table,source.replace('项目2','项目3')),table);
});
test('real R02 successful static screenshots replace complete fallback fragments once and keep explanations/code',async()=>{
 const doc=fixture('LONG-R02'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R02-BEGIN')),blocks=visual.uiBlocks(dom);
 const text=await Promise.all(blocks.map(el=>visual.uiText(el,dom.id)));assert.equal(blocks.length,4);
 const outside='即每日预计发电量的30%用于规定负载。\n\n这里的1,120 Wh并不必然全部进入电池。\n\n\\(\\sigma=448,\\;E=1344\\)';
 const literal='```text\n'+text[0]+'\n```';
 const body=outside+'\n\n'+text.slice(0,3).join('\n\n')+'\n\n'+text[3].replace('负载 480 Wh · 30%\n\n净余量','负载 480 Wh · 30% 净余量')+'\n\n'+literal;
 const original=global.ChatExportAutomation;global.ChatExportAutomation={...require('../extension/automation'),captureElement:async()=>({blob:new Blob(['test']),width:600,height:100})};
 try{
  const result=await visual.enrich({id:dom.id,md:body,needsUI:true,uiReasons:['model-dil']},{doc,capture:async()=>'',screenshot:true,wait:async()=>{}});
  assert.ok(result.md.startsWith(outside));assert.ok(result.md.includes(literal));assert.equal(result.assets.length,4);
  assert.equal((result.md.match(/!\[/g) || []).length,4);assert.equal((result.md.match(/典型日能量分配/g) || []).length,0);
  assert.equal((result.md.match(/期望发电量/g) || []).length,1); // only literal protected source
  assert.doesNotMatch(result.md,/0 Wh 550 Wh 1\.1K Wh/);assert.equal(result.textSupplemented,true);
 }finally{global.ChatExportAutomation=original;}
});
test('R02 Markdown and failed screenshots retain the readable metric/ratio/axis fallback',async()=>{
 const doc=fixture('LONG-R02'),dom=core.discover(doc).find(m=>m.role==='assistant'&&m.el.textContent.includes('R02-BEGIN'));
 for(const screenshot of [false,true]){
  const result=await visual.enrich({id:dom.id,md:'正文公式 \\(E=1344\\)',needsUI:true,uiReasons:['model-dil']},{doc,screenshot,wait:async()=>{}});
  assert.match(result.md,/期望发电量/);assert.match(result.md,/典型日能量分配/);assert.match(result.md,/0 Wh 550 Wh/);assert.equal(result.assets.length,0);
 }
});
