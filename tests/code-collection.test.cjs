const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {CodeLines}=require('../extension/automation');
test('overlapping code frames preserve duplicate and empty lines; gaps cannot pass',()=>{
  const c=new CodeLines();c.add({start:true,end:null,lines:[{index:0,text:'a'},{index:1,text:''}]});
  c.add({start:false,end:4,lines:[{index:3,text:'a'}]});assert.equal(c.result().complete,false);
  c.add({start:false,end:null,lines:[{index:1,text:''},{index:2,text:'return x'}]});assert.equal(c.result().complete,true);assert.equal(c.result().text,'a\n\nreturn x\na');
  assert.throws(()=>c.add({start:false,end:null,lines:[{index:2,text:'changed'}]}),/重叠/);
});
test('actual collector traverses a virtual editor and restores scroll and presentation',async()=>{
  const w=new JSDOM('<div id="scroll" style="overflow-y:auto"><div data-markdown-copy="code-block"><div class="cm-content" style="padding-top:0px"></div></div></div>',{runScripts:'outside-only'}).window;
  const d=w.document,scroller=d.querySelector('#scroll'),surface=d.querySelector('[data-markdown-copy]'),editor=d.querySelector('.cm-content');
  const source=fs.readFileSync('tests/fixtures/v5-python.py','utf8').replace(/\r/g,'').split('\n');
  let pos=200;const render=()=>{editor.replaceChildren();let begin=Math.max(0,Math.floor(pos/20)-2),end=Math.min(source.length,begin+12);
    if(begin){const gap=d.createElement('div');gap.className='cm-gap';editor.append(gap);}
    for(let i=begin;i<end;i++){const line=d.createElement('div');line.className='cm-line';line.textContent=source[i];line.getBoundingClientRect=()=>({top:i*20-pos,height:20});editor.append(line);}
    if(end<source.length){const gap=d.createElement('div');gap.className='cm-gap';editor.append(gap);}
  };
  Object.defineProperties(scroller,{scrollHeight:{value:source.length*20},clientHeight:{value:160},scrollTop:{get:()=>pos,set:x=>{pos=x;render();}}});
  scroller.scrollTo=({top})=>{scroller.scrollTop=Math.max(0,Math.min(source.length*20-160,top));};
  scroller.getBoundingClientRect=()=>({top:0,bottom:160,left:0,right:800});editor.getBoundingClientRect=()=>({top:-pos});surface.scrollIntoView=()=>{};
  w.innerHeight=800;w.innerWidth=800;w.setTimeout=f=>{f();return 1;};render();
  w.eval(fs.readFileSync('extension/automation.js','utf8'));
  const result=await w.ChatExportAutomation.collectCode(surface);
  assert.equal(result.complete,true,result.reason);assert.equal(result.text,source.join('\n'));assert.match(result.text,/return results/);assert.match(result.text,/results.append/);assert.equal(pos,200);assert.equal(editor.hasAttribute('data-archive-code'),false);assert.equal(d.querySelectorAll('style').length,0);w.close();
});
