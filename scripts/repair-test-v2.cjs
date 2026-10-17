// Repair this user-supplied archive using independently observed message IDs, never text similarity.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),core=require('../extension/core');
const source='archive/Output - test 1/早期归档版本/v2/conversation-archive-v2',destination='archive/Output - test 1/早期归档版本/v2/conversation-archive-v2-repaired';
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
const known=new Map();
for(const file of ['M02-t1.json','V2-ACTIVE-CONVERSATION.json']){
  const fixture=JSON.parse(fs.readFileSync('research/2026-10-12/'+file));assert.equal(fixture.url,manifest.url);
  for(const m of core.discover(new JSDOM(fixture.html).window.document))known.set(m.id,m);
}
const md=fs.readFileSync(path.join(source,'conversation.md'),'utf8');
const headings=[...md.matchAll(/^## (我|ChatGPT)\r?$/gm)];assert.equal(headings.length,manifest.messages.length);
const blocks=manifest.messages.map((m,i)=>({...m,body:md.slice(headings[i].index,headings[i+1]?.index || md.indexOf('## 未完整保存的内容')).trim()}));
const kept=blocks.filter(m=>known.has(m.id)).sort((a,b)=>known.get(a.id).order-known.get(b.id).order);
assert.equal(kept.length,16);assert.deepEqual(kept.map(m=>m.role),Array.from({length:16},(_,i)=>i%2?'assistant':'user'));
const missing=[...known.values()].filter(m=>!kept.some(k=>k.id===m.id)).map(m=>({id:m.id,role:m.role,order:m.order}));assert.equal(missing.length,4);
const warnings=[`旧归档混入其他聊天，已按独立核验的消息 ID 移除 ${blocks.length-kept.length} 条；当前聊天最后 ${missing.length} 条未保存在旧文件中，需要重新收集。`,...manifest.warnings.filter(w=>kept.some(m=>w.startsWith(m.id+':')))];
fs.mkdirSync(path.join(destination,'assets'),{recursive:true});
const body=kept.map(m=>m.body).join('\n\n');
const assets=manifest.assets.filter(a=>body.includes('('+a.path+')'));
for(const asset of assets){assert.match(asset.path,/^assets\/[\w.-]+$/);fs.copyFileSync(path.join(source,asset.path),path.join(destination,asset.path));}
fs.writeFileSync(path.join(destination,'conversation.md'),`# 可视化月度趋势（旧归档修复版，非完整对话）\n\n来源：${manifest.url}\n\n> ${warnings[0]}\n\n${body}\n\n## 未完整保存的内容\n\n${warnings.map(w=>'- '+w).join('\n')}\n`);
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({...manifest,scope:'repaired-partial-archive',collection:{complete:false,reason:'source archive mixed conversations and omitted four target messages'},repair:{source,removedMessages:blocks.length-kept.length,missingMessages:missing},messages:kept.map(({body,...m},index)=>({...m,index,conversationId:manifest.url.split('/').pop()})),assets,warnings},null,2));
console.log(JSON.stringify({destination,kept:kept.length,removed:blocks.length-kept.length,missing:missing.length,assets:assets.length}));
