const {test}=require('./private-fixtures.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const core=require('../extension/core');
const {RecordStore,collect,cropPlan}=require('../extension/automation');
const doc=html=>new JSDOM(html).window.document;
test('multiple widgets keep prose and independent cards separate',async()=>{
  const d=doc('<div data-message-author-role="assistant"><div class="markdown"><div data-dil-message-id="a"><p>Before</p><div data-d-component="box" data-d-has-border><h2>Calculator</h2><input><button>Reset</button></div><p>Between</p><div data-d-component="box" data-d-has-border><h2>Quiz</h2><input type="radio"></div><p>After</p></div></div></div>');
  const m=core.discover(d)[0],blocks=core.planBlocks(m);assert.equal(blocks.length,2);
  const replacements=new Map(blocks.map((b,i)=>[b.el,`assets/${i}.png`]));
  const md=await core.convert(m,{warnings:[],replacements});
  assert.match(md,/Before[\s\S]*0.png[\s\S]*Between[\s\S]*1.png[\s\S]*After/);
  for(const b of blocks)assert.equal(core.resolvePath(m,b.path),b.el);
});
test('real shared conversation identifies seven widgets and preserves text-only replies',()=>{
  const data=JSON.parse(fs.readFileSync('archive/research/2026-10-12/USER-SHARE-TEST1.json'));
  const messages=core.discover(doc(data.html));assert.equal(messages.length,20);
  const replies=messages.filter(m=>m.role==='assistant');
  assert.deepEqual(replies.map(m=>core.planBlocks(m).length),[1,1,1,0,1,1,0,1,0,1]);
  const first=core.planBlocks(replies[0])[0];assert.ok(!first.el.textContent.includes('趋势说明'));
  assert.equal(new Set(messages.map(m=>m.id)).size,20);assert.ok(messages.every(m=>m.stable));
});
test('stored solar classroom separates calculator, quiz, and diagram with outside caption',()=>{
  const data=JSON.parse(fs.readFileSync('archive/research/2026-10-12/I06-final.json'));
  const m=core.discover(doc(data.html)).find(m=>m.role==='assistant');
  const blocks=core.planBlocks(m);assert.equal(blocks.length,3);
  assert.ok(blocks.every(b=>!b.el.textContent.includes('太阳能电池板（Solar')));
});
test('record store deduplicates remounts and inserts earlier history in order',()=>{
  const s=new RecordStore();const m=n=>({id:String(n),role:'assistant',order:n,stable:true});
  s.observe([m(6),m(7)]);s.save({...m(6),md:'cached',assets:[]});s.observe([m(0),m(1),m(6)]);s.observe([m(7),m(8)]);
  assert.deepEqual(s.values().map(m=>m.id),['0','1','6','7','8']);assert.equal(s.records.get('6').md,'cached');
});
test('virtualized history traversal captures every message once, waits for delayed bottom, restores scroll',async()=>{
  let pos=700,end=900,settles=0;const seen=[];
  const adapter={position:()=>pos,range:()=>end,height:()=>200,move:n=>{pos=Math.min(n,end);},settle:async()=>{settles++;if(pos===900 && settles>4)end=1100;},scan:async()=>Array.from({length:3},(_,i)=>Math.min(11,Math.floor(pos/100)+i)).filter((n,i,a)=>a.indexOf(n)===i).map(n=>({id:String(n),stable:true}))};
  const result=await collect({adapter,process:async m=>seen.push(Number(m.id))});
  assert.equal(result.complete,true);assert.deepEqual([...seen].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i));assert.equal(new Set(seen).size,seen.length);assert.equal(pos,700);
});
test('cancelled traversal restores scroll and stops processing',async()=>{
  let pos=500;const controller=new AbortController(),seen=[];
  const adapter={position:()=>pos,range:()=>500,height:()=>200,move:n=>{pos=n;},settle:async()=>{},scan:async()=>[{id:'1',stable:true},{id:'2',stable:true}]};
  await assert.rejects(collect({adapter,signal:controller.signal,process:async m=>{seen.push(m.id);controller.abort();}}),{name:'AbortError'});
  assert.deepEqual(seen,['1']);assert.equal(pos,500);
});
test('tile crop uses covered offset without overlap and rejects horizontal clipping',()=>{
  const view={top:20,bottom:720,left:0,right:1000};
  const first=cropPlan({left:100,right:600,top:20,width:500,height:1600},view,0);
  const second=cropPlan({left:100,right:600,top:-680,width:500,height:1600},view,first.height);
  assert.equal(first.height,700);assert.equal(second.offset,700);assert.equal(second.y,20);assert.equal(second.height,700);
  assert.throws(()=>cropPlan({left:-1.5,right:500,top:20,width:501.5,height:50},view,0),/横向/);
});
