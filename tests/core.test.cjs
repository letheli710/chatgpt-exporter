const {test} = require('./private-fixtures.cjs');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const core = require('../extension/core');
const documentOf = html => new JSDOM(html, {url:'https://chatgpt.com/c/test'}).window.document;
async function markdown(html, extra={}) {
  const document = documentOf(html), warnings = [];
  return {text:await core.convert({id:'test',roots:[document.body]}, {warnings,asset:async()=> 'assets/test.svg',...extra}),warnings};
}
test('modern and nested legacy messages retain order without duplicates', () => {
  const d = documentOf('<div data-chatgpt-search-unit-key="fallback-turn-0:0:user"><div data-user-message-bubble>Question</div></div><div data-chatgpt-selection-message-id="a"><div data-message-author-role="assistant"><div class="markdown">Answer</div></div></div>');
  assert.deepEqual(core.discover(d).map(m=>[m.role,m.roots[0].textContent]), [['user','Question'],['assistant','Answer']]);
});
test('code fences, tables, lists, and KaTeX survive conversion', async () => {
  const {text} = await markdown('<h2>标题</h2><pre><code class="language-js">const s = "```";</code></pre><ol start="3"><li>A</li><li>B</li></ol><table><tr><th>A</th><th>B</th></tr><tr><td>x|y</td><td>z<br>k</td></tr></table><span class="katex"><span>duplicate</span><annotation encoding="application/x-tex">x^2</annotation></span>');
  assert.match(text,/````js/); assert.match(text,/3\. A\n4\. B/); assert.match(text,/x\\\|y/); assert.match(text,/z<br>k/); assert.match(text,/\$x\^2\$/); assert.doesNotMatch(text,/duplicate/);
});
test('screenshot replacement stays between surrounding paragraphs', async () => {
  const d = documentOf('<p>Before</p><div id="widget"><input type="range"></div><p>After</p>'), warnings=[];
  const text = await core.convert({id:'m',roots:[d.body]}, {warnings,replacements:new Map([[d.querySelector('#widget'),'assets/capture.png']])});
  assert.match(text,/Before[\s\S]*capture.png[\s\S]*After/); assert.equal(warnings.length,0);
});
test('unknown UI and inaccessible assets produce visible omissions', async () => {
  const {text,warnings} = await markdown('<iframe></iframe><img src="x">',{asset:async()=>{throw Error('CORS')}});
  assert.equal(warnings.length,2); assert.match(text,/未归档/); assert.match(text,/图像未保存/);
});
test('SVG has namespace, strips executable attributes, rejects foreignObject', () => {
  const d=documentOf('<svg onload="alert(1)"><script>alert(1)</script><path d="M0 0"/></svg>');
  const svg=core.serializeSVG(d.querySelector('svg'));
  assert.match(svg,/xmlns=/); assert.doesNotMatch(svg,/onload|script/);
  assert.throws(()=>core.serializeSVG(documentOf('<svg><foreignObject/></svg>').querySelector('svg')),/截图/);
});
test('saved real conversation fixtures yield nonempty ordered messages', async () => {
  const dir='archive/research/2026-10-12'; let checked=0;
  for(const name of fs.readdirSync(dir).filter(n=>/^I0[16].*\.json$/.test(n))){
    const data=JSON.parse(fs.readFileSync(`${dir}/${name}`)); if(!data.html) continue;
    const messages=core.discover(new JSDOM(data.html,{url:data.url || 'https://chatgpt.com/'}).window.document); assert.ok(messages.length>=2,name);
    assert.equal(messages[0].role,'user',name);
    for(const m of messages){const text=await core.convert(m,{warnings:[],asset:async()=> 'assets/image.svg'});assert.ok(text.length>0,name);}
    checked++;
  }
  assert.ok(checked>0);
});
