const fs=require('node:fs'),{JSDOM}=require('jsdom'),core=require('../extension/core');
const dir='research/2026-10-12';
const rounds=[];
for(let i=1;i<=9;i++){
  const tag='R'+String(i).padStart(2,'0'),file=`${dir}/LONG-${tag}.json`;if(!fs.existsSync(file))continue;
  const data=JSON.parse(fs.readFileSync(file)),doc=new JSDOM(data.html,{url:data.url}).window.document;
  const messages=core.discover(doc),reply=messages.filter(m=>m.role==='assistant').at(-1);if(!reply)continue;
  const content=reply.roots.map(n=>n.textContent).join('\n');
  const count=selector=>reply.roots.reduce((total,n)=>total+n.querySelectorAll(selector).length,0);
  rounds.push({round:tag,url:data.url,messageId:reply.id,loadedMessages:messages.length,textCharacters:content.length,begin:content.includes(tag+'-BEGIN'),end:content.includes(i===9?'LONG-MIXED-END':tag+'-END'),math:count('.katex'),tables:count('table'),codeBlocks:count('pre'),inlineSVG:count('svg'),svgImages:reply.roots.reduce((sum,n)=>sum+[...n.querySelectorAll('img')].filter(img=>img.src.startsWith('data:image/svg')).length,0),interactiveBlocks:core.planBlocks(reply).length,checkboxes:count('[role="checkbox"],input[type="checkbox"]')});
}
fs.writeFileSync(`${dir}/LONG-MIXED-INDEX.json`,JSON.stringify({model:'GPT-6',effort:'Medium',rounds},null,2));
console.log(JSON.stringify(rounds,null,2));
