const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function environment({reverse=false,moveDuringCapture=false,occluded=false,rounded=false,composer=false}={}) {
  const dom=new JSDOM('<div id="scroll"><div id="card">Tall widget</div></div>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document,scroll=d.querySelector('#scroll'),card=d.querySelector('#card'),draws=[];
  let pos=300,raw=0,captures=0,hidden=false;
  Object.defineProperties(w,{innerWidth:{value:1000},innerHeight:{value:800},devicePixelRatio:{value:2}});
  Object.defineProperties(scroll,{scrollHeight:{value:3500},clientHeight:{value:800},scrollTop:{get:()=>reverse?pos-2700:pos}});
  scroll.scrollTo=({top})=>{raw=top;pos=Math.max(0,Math.min(2700,reverse?top+2700:top));};
  scroll.getBoundingClientRect=()=>({top:0,left:0,right:1000,bottom:800});
  card.getBoundingClientRect=()=>({top:500-pos,left:100,right:600,width:500,height:1900,bottom:2400-pos});
  w.getComputedStyle=el=>({overflowY:el===scroll?'auto':'visible',flexDirection:reverse?'column-reverse':'column'});
  d.elementFromPoint=(x,y)=>{
    if(occluded)return d.body;
    const r=card.getBoundingClientRect();
    if(rounded && ((x-r.left<12 || r.right-x<12) && (y-r.top<12 || r.bottom-y<12)))return scroll;
    return card;
  };
  const original=d.createElement.bind(d);
  d.createElement=tag=>tag==='canvas'?{width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args.slice(1))}),toBlob:callback=>callback(new w.Blob(['png'],{type:'image/png'}))}:original(tag);
  w.Image=class{constructor(){this.width=2000;this.height=1600;}async decode(){}};
  w.setTimeout=callback=>{callback();return 1;};
  w.eval(fs.readFileSync('extension/automation.js','utf8'));
  if(composer){const footer=d.createElement('div');footer.setAttribute('data-thread-scroll-footer','true');footer.textContent='Ask ChatGPT';d.body.append(footer);}
  return {dom,w,card,draws,position:()=>pos,raw:()=>raw,captures:()=>captures,hidden:()=>hidden,options:{capture:async()=>{captures++;if(moveDuringCapture)pos+=40;return 'data:image/png;base64,AA==';},hide:()=>hidden=true,show:()=>hidden=false}};
}
for(const reverse of [false,true])test(`capture stitches tall block with no gaps at DPR 2 (reverse=${reverse})`,async()=>{
  const env=environment({reverse});
  const result=await env.w.ChatExportAutomation.captureElement(env.card,env.options);
  assert.ok(result.tiles.length>=3);assert.equal(result.tiles.reduce((s,t)=>s+t.height,0),1900);assert.equal(env.position(),300);assert.equal(env.hidden(),false);
  let end=0;for(const draw of env.draws){assert.equal(draw[5],end);end+=draw[7];}assert.equal(end,3800);assert.equal(env.captures(),result.tiles.length);
  env.dom.window.close();
});
test('capture rejects scrolling during browser capture and restores state',async()=>{
  const env=environment({moveDuringCapture:true});
  await assert.rejects(env.w.ChatExportAutomation.captureElement(env.card,env.options),/移动/);assert.equal(env.position(),300);assert.equal(env.hidden(),false);env.dom.window.close();
});
test('occluded block fails before capture instead of archiving a floating overlay',async()=>{
  const env=environment({occluded:true});await assert.rejects(env.w.ChatExportAutomation.captureElement(env.card,env.options),/遮挡/);assert.equal(env.captures(),0);assert.equal(env.hidden(),false);env.dom.window.close();
});
test('rounded transparent corners do not count as an occlusion',async()=>{
  const env=environment({rounded:true});const result=await env.w.ChatExportAutomation.captureElement(env.card,env.options);assert.ok(result.blob.size>0);env.dom.window.close();
});

test('capture suppresses composer and tooltip for every tile and restores them on failure',async()=>{
  const env=environment({composer:true});const d=env.w.document;
  const tooltip=d.createElement('div');tooltip.className='recharts-tooltip-wrapper';tooltip.textContent='hover-only';env.card.append(tooltip);
  const original=env.options.capture;
  env.options.capture=async()=>{
    assert.ok([...d.querySelectorAll('style')].some(s=>s.textContent.includes('[data-thread-scroll-footer]') && s.textContent.includes('visibility: hidden')));
    throw Error('capture failed');
  };
  await assert.rejects(env.w.ChatExportAutomation.captureElement(env.card,env.options),/capture failed/);
  assert.equal(d.querySelectorAll('style[data-archive-owned]').length,0);
  assert.equal(d.querySelector('[data-thread-scroll-footer]').textContent,'Ask ChatGPT');
  env.options.capture=original;env.dom.window.close();
});

test('capture clears a collapsed caret and restores the original selection without editing text',async()=>{
  const env=environment(),d=env.w.document,selection=d.getSelection(),range=d.createRange();
  range.setStart(env.card.firstChild,3);range.collapse(true);selection.addRange(range);
  const original=env.options.capture;env.options.capture=async()=>{assert.equal(selection.rangeCount,0);return original();};
  await env.w.ChatExportAutomation.captureElement(env.card,env.options);
  assert.equal(selection.anchorOffset,3);assert.equal(selection.isCollapsed,true);assert.equal(env.card.textContent,'Tall widget');env.dom.window.close();
});
