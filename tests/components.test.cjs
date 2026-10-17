const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
const render=require('../extension/dil-render');
// Real Intelligent UI messages from a public, non-private test conversation (ui/msg-*.json exports).
const dir='tests/fixtures/mainlab',files=fs.readdirSync(dir).sort();
const load=id=>JSON.parse(fs.readFileSync(`${dir}/${files.find(f=>f.includes(id))}`,'utf8'));
const exec=(code,scope)=>vm.runInNewContext(code,{...scope},{timeout:1000});
const segs=id=>{const j=load(id);return render.segments(render.evaluate({...j.dil,contentReferences:j.contentReferences},exec));};
const cards=id=>segs(id).filter(s=>s.kind==='card');
const mdOf=id=>segs(id).map(s=>render.toMarkdown(s.tree)).join('\n\n');
const parser=new (new JSDOM('').window.DOMParser)();
const xml=html=>parser.parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,'application/xml');

test('only real UI becomes an image; Markdown tables, lists, quotes and math stay text',()=>{
  const all=files.flatMap(f=>cards(f.slice(4,12)).map(c=>c.tree.type));
  assert.deepEqual(all.sort(),['box','box','box','box','box','box','box','box','grid']);
  assert.equal(cards('19a9ff6e').length,0);assert.equal(cards('c807990b').length,0);
});
test('Markdown side: GFM tables with alignment, $$ block math, nested numbered lists, headings by size',()=>{
  const md=mdOf('59cd99a4');
  assert.match(md,/\| 日期 \| 日照 \(h\) \| 发电 \(kWh\) \| 净余量 \(kWh\) \|\n\| --- \| ---: \| ---: \| ---: \|\n\| 第1天 \| 5 \| 1\.60 \| \+1\.12 \|/);
  assert.match(md,/\| \*\*合计\*\* \| \*\*26\*\* \| \*\*8\.32\*\* \| \*\*\+4\.96\*\* \|/);
  assert.match(md,/^\$\$\nE_\{\\mathrm\{net\}\}=E_\{\\mathrm\{solar\}\}-0\.48\n\$\$$/m);
  assert.match(md,/平均值为 \$26\/7\\approx3\.71\$ 小时/);
  assert.match(md,/^# 校园太阳能学习角｜R05 七天运行数据分析$/m);assert.match(md,/^## 一、七天运行记录$/m);assert.match(md,/^### 1\. 日照与发电波动$/m);
  const r01=mdOf('19a9ff6e');assert.match(r01,/^1\. \*\*能源自主性\*\*/m);assert.match(r01,/^   - /m);
});
test('Markdown side: UI text inside cards uses emphasis, controls and charts become readable text',()=>{
  const [chartCard,metrics]=cards('59cd99a4').map(c=>render.toMarkdown(c.tree));
  assert.match(chartCard,/选项：\*\*柱状图\*\* \/ 折线图/);assert.match(chartCard,/下拉选择：第7天/);
  assert.match(chartCard,/\| day \| 发电量 \| 负载能耗 \| 净余量 \|\n\| --- \| ---: \| ---: \| ---: \|\n\| 第1天 \| 1\.6 kWh \| 0\.48 kWh \| 1\.12 kWh \|/);
  assert.doesNotMatch(chartCard+metrics,/^#/m);assert.match(metrics,/累计发电\n\n\*\*8\.32\*\*\n\nkWh/);
  const sim=render.toMarkdown(cards('4bf3b0ef')[0].tree),quiz=render.toMarkdown(cards('4bf3b0ef')[1].tree);
  assert.match(sim,/滑块：400（100–1000）/);assert.match(quiz,/- \( \) 额定功率\n- \( \) 每日发电量/);
  assert.match(render.toMarkdown(cards('9a3073ce')[0].tree),/〔图示：方案B · 太阳能供电系统 · 太阳能板 · 400 W/);
});
test('card HTML is well-formed and draws each component kind',()=>{
  const html=Object.fromEntries(files.map(f=>[f.slice(4,12),cards(f.slice(4,12)).map(c=>render.toHtml(c.tree))]));
  for(const [id,list] of Object.entries(html))for(const h of list)assert.equal(xml(h).getElementsByTagName('parsererror').length,0,id);
  const [version]=html.a20b4d1b;
  assert.match(version,/<span class="seg-opt">旧方案 · 4小时<\/span><span class="seg-opt on">新方案 · 6小时<\/span>/);
  assert.match(version,/<span class="badge b-success">当前基线<\/span>/);assert.match(version,/background:#f9f9f9/);assert.match(version,/border:1px solid rgba\(13,13,13,\.1\)/);
  assert.match(version,/<table class="tbl">[\s\S]*<td style="text-align:right">/);assert.match(version,/<div class="box" data-fill="1" style="width:40%;background:#4389B8"/);
  const [sim,quiz]=html['4bf3b0ef'];
  assert.match(sim,/<div class="slider-fill" style="width:33\.33%"><\/div><div class="slider-thumb" style="left:33\.33%">/);assert.match(sim,/<span class="icon">↺<\/span>/);assert.match(sim,/btn-outline/);
  assert.equal((quiz.match(/class="rb"/g)||[]).length,9);
  const [chart,grid]=html['59cd99a4'];
  assert.equal((chart.match(/<rect [^>]*rx="2" fill="#3a83f7"/g)||[]).length,8);assert.match(chart,/<span class="select"><span>第7天<\/span>/);
  assert.match(grid,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  const [flow]=html['9a3073ce'];
  assert.match(flow,/<svg viewBox="0 0 350 440" width="100%" xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);assert.match(flow,/<marker id="r03arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">/);
  assert.match(flow,/marker-end="url\(#r03arrow\)"/);assert.match(flow,/<text x="175" y="22" text-anchor="middle" font-size="13"/);
});
test('client-defined widgets: code blocks become fenced Markdown, visualizations become charts',()=>{
  const md=mdOf('c807990b');assert.doesNotMatch(md,/嵌入应用/);
  assert.match(md,/^```python\nfrom dataclasses import dataclass\n\n@dataclass\nclass SolarConfig:/m);
  assert.match(md,/^```text\nDay 1: battery=1\.12 kWh, unserved=0\.00 kWh, curtailed=0\.00 kWh\n/m);assert.match(md,/^```json\n\{\n  "project": "Campus Solar Learning Corner",/m);
  const card=cards('7fe02b34')[1];assert.match(render.toMarkdown(card.tree),/不同日照情景下的每日发电量\n\n概率分别为20%、50%、30%。\n\n\| hours \| 发电量 \|\n\| --- \| ---: \|\n\| 2 h · 20% \| 640 Wh \|/);
  assert.equal((render.toHtml(card.tree).match(/<rect [^>]*rx="2" fill="#3a83f7"/g)||[]).length,4);
  assert.match(render.toHtml({type:'code-block',props:{value:'\na < b\n'},children:[]}),/^<pre class="codeblk"><code>a &lt; b<\/code><\/pre>$/);
});
test('a checkbox inside a list item is a task-list item',()=>{
  assert.match(mdOf('22172b7f'),/^- \[ \] \*\*参数版本：\*\* 展示屏已改为每天6小时/m);assert.doesNotMatch(mdOf('22172b7f'),/^- - \[/m);
});
test('pie charts, unsafe style values and unknown icons degrade safely',()=>{
  const pie=render.toHtml({type:'pie-chart',props:{data:[{n:'A',v:3},{n:'B',v:1}],series:[{dataKey:'v'}],xAxis:'n'},children:[]});
  assert.equal((pie.match(/<path d="M/g)||[]).length,2);assert.match(pie,/A：3（75%）/);
  assert.match(render.toMarkdown({type:'pie-chart',props:{data:[{n:'A',v:3}],series:[{dataKey:'v',label:'值'}],xAxis:'n'},children:[]}),/\| n \| 值 \|\n\| --- \| ---: \|\n\| A \| 3 \|/);
  assert.doesNotMatch(render.toHtml({type:'box',props:{background:'red;position:fixed',width:'1px"/><script>'},children:['x']}),/position|script/);
  assert.match(render.toHtml({type:'icon',props:{name:'never-seen'},children:[]}),/•/);
});
