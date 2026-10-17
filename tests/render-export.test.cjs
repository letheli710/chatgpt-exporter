const {test}=require('node:test');
const assert=require('node:assert/strict');
let renderer;
try {renderer=require('../scripts/render-export.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('offline renderer distinguishes role headings from fenced examples',{skip:!renderer&&'Install optional pinned KaTeX renderer dependency'},()=>{
 const md='# Title\n\n## 我\n\nhello\n\n---\n\n## ChatGPT\n\n```md\n## 我\n```\n\n## Actual heading\n\nbye';
 const parsed=renderer.parseMessages(md,['u','a']);
 assert.equal(parsed.messages.length,2);assert.equal(parsed.messages[1].id,'a');assert.equal(parsed.messages[1].role,'assistant');
 assert.match(parsed.messages[1].md,/## Actual heading/);assert.match(parsed.messages[1].md,/```md\n## 我/);
 assert.throws(()=>renderer.parseMessages(md,['u']),/mismatch/);
});
test('GFM and LaTeX render as tables, code, and preserved TeX annotations',{skip:!renderer&&'Install optional pinned KaTeX renderer dependency'},()=>{
 const report={formulas:0,mathErrors:[]};
 const html=renderer.parser(report).parse('| A | B |\n|---|---|\n| <code>a&#124;b</code> | $x^2$ |\n\n\\[E=P\\times t\\]\n\n```python\nprint("$x$")\n```');
 assert.match(html,/<table>/);assert.match(html,/a&#124;b/);assert.match(html,/annotation encoding="application\/x-tex">E=P\\times t/);
 assert.match(html,/<code class="language-python">/);assert.equal(report.formulas,2);assert.deepEqual(report.mathErrors,[]);
});
