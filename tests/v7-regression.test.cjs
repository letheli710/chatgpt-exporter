const {test}=require('./private-fixtures.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),core=require('../extension/core');
function fixture(){const d=new JSDOM(JSON.parse(fs.readFileSync('research/2026-10-12/LONG-R02.json')).html).window.document;return {id:'r03',role:'assistant',roots:[[...d.querySelectorAll('[data-dil-message-id]')].at(-1)]};}
test('ratio screenshot includes title and both aligned captions, excludes following prose',async()=>{
 const m=fixture(),b=core.planBlocks(m).find(b=>b.reason==='CSS 比例或进度图');
 assert.match(b.el.textContent,/典型日能量分配/);assert.match(b.el.textContent,/负载 480 Wh · 30%/);assert.match(b.el.textContent,/净余量 1,120 Wh · 70%/);assert.doesNotMatch(b.el.textContent,/不必然全部进入电池/);
 const md=await core.convert(m,{warnings:[],asset:async()=> 'other.svg',replacements:new Map([[b.el,'ratio.png']])});
 assert.doesNotMatch(md,/\n\n负载 480/);assert.doesNotMatch(md,/\n\n净余量 1,120/);assert.match(md,/不必然全部进入电池/);
});
test('chart title is bold and remains a separate paragraph from subtitle',async()=>{
 const md=await core.convert(fixture(),{warnings:[],asset:async()=> 'other.svg'});
 assert.match(md,/\*\*不同日照情景下的每日发电量\*\*\n\n概率分别/);
});

