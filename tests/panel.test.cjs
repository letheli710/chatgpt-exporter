const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('panel discovers messages, respects selection, previews and toggles without duplicates',async()=>{
  const dom=new JSDOM('<div data-message-author-role="user">Question</div><div data-message-author-role="assistant"><div class="markdown"><p>Answer</p></div></div>',{url:'https://chatgpt.com/c/test',runScripts:'outside-only'});
  const w=dom.window; w.eval(fs.readFileSync('extension/jszip.min.js','utf8'));w.eval(fs.readFileSync('extension/core.js','utf8'));w.eval(fs.readFileSync('extension/automation.js','utf8'));w.eval(fs.readFileSync('extension/content.js','utf8'));
  const host=w.document.querySelector('[data-archive-owned]'),s=host.shadowRoot;
  assert.equal(s.querySelectorAll('#list input').length,2);
  s.querySelector('#list input').checked=false;s.getElementById('preview').click();
  for(let i=0;i<30&&s.getElementById('preview').disabled;i++)await new Promise(r=>setTimeout(r,5));
  const md=s.getElementById('output').value;assert.match(md,/Answer/);assert.doesNotMatch(md,/Question/);
  w.eval(fs.readFileSync('extension/content.js','utf8'));assert.equal(w.document.querySelectorAll('[data-archive-owned]').length,1);assert.equal(host.hidden,true);
  dom.window.close();
});
