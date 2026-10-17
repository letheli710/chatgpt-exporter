// Usage: node scripts/build-source-block-ledger.cjs <ledger.json> <source-DOM.json> ...
// Source documents are browser snapshots, never exporter Markdown or API text.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const core = require('../extension/core');
const visual = require('../extension/fast-visual');
const URL = 'https://chatgpt.com/c/6acd9282-acbc-83e9-bbb4-51aace07323c';
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/\s+/g, '').normalize('NFC');
function logicalText(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('script,style,[aria-hidden="true"],[hidden],[data-archive-owned],button').forEach(n => n.remove());
  for (const formula of clone.querySelectorAll('.katex')) {
    if (formula.parentElement?.closest('.katex')) continue;
    formula.replaceWith(clone.ownerDocument.createTextNode(formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent || formula.textContent));
  }
  return clone.textContent.trim();
}
function extractMessage(message) {
  if (message.role === 'user') {
    const text=message.roots.map(logicalText).join('\n');
    return [{kind:'user-prose',text,blockIndex:0,normalized:normalize(text),sha256:digest(normalize(text))}];
  }
  const ui = visual.uiBlocks(message), blocks = [];
  const withinUI = node => ui.some(card => card === node || card.contains(node));
  const regionOf = node => { const index=ui.findIndex(card=>card===node||card.contains(node)); return index<0?null:index+1; };
  const add = (kind, text, extra = {}) => { if (text.trim()) blocks.push({kind,text,...extra}); };
  for (const root of message.roots) {
    for (const n of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,table,pre,[data-markdown-copy="code-block"]')) {
      if (n.closest('[aria-hidden="true"],[hidden],[data-archive-owned]')) continue;
      if (n.matches('table')) {
        add(withinUI(n)?'ui-table':'table', logicalText(n), {rows:[...n.rows].map(row=>[...row.cells].map(logicalText)),uiRegionIndex:regionOf(n)});
      } else if (n.matches('pre,[data-markdown-copy="code-block"]')) {
        if (n.parentElement?.closest('[data-markdown-copy="code-block"]')) continue;
        const editor=n.querySelector('.cm-editor'), lines=[...n.querySelectorAll('.cm-line')];
        const pre=n.matches('pre')?n:n.querySelector('pre,code,.whitespace-pre-wrap');
        const text=editor?lines.map(line=>line.textContent).join('\n'):(pre?.textContent || logicalText(n));
        add('code',text,{partial:!!n.querySelector('.cm-gap'),visibleLineCount:lines.length || text.split('\n').length});
      } else {
        if (n.closest('table,pre,[data-markdown-copy="code-block"],.cm-editor,.katex')) continue;
        if (n.matches('li') && n.querySelector('p,li')) continue;
        add(n.closest('.sr-only')?'accessible-alt':withinUI(n)?'ui-text':n.matches('h1,h2,h3,h4,h5,h6')?'heading':n.matches('li')?'list-item':'paragraph',logicalText(n),{uiRegionIndex:regionOf(n)});
      }
    }
    for (const n of root.querySelectorAll('annotation[encoding="application/x-tex"]')) add('formula',n.textContent,{display:!!n.closest('.katex-display'),withinUI:withinUI(n),uiRegionIndex:regionOf(n)});
    for (const n of root.querySelectorAll('input,select,textarea,[role="checkbox"],[role="radio"],[role="slider"],[role="switch"]')) {
      if (!withinUI(n) || n.closest('[aria-hidden="true"],[hidden]')) continue;
      const label=[...root.querySelectorAll('label')].find(label=>label.htmlFor===n.id)?.textContent;
      add('ui-control',n.getAttribute('aria-label') || n.labels?.[0]?.textContent || label || n.id || n.tagName,{value:n.value ?? n.getAttribute('aria-valuenow'),checked:n.checked ?? n.getAttribute('aria-checked'),uiRegionIndex:regionOf(n)});
    }
  }
  return blocks.map((block,i)=>({...block,blockIndex:i,normalized:normalize(block.text),sha256:digest(normalize(block.text))}));
}
function build(files) {
  const messages=new Map(),sources=[];
  for (const file of files) {
    const absolute=path.resolve(file),data=JSON.parse(fs.readFileSync(absolute,'utf8'));
    if (data.url !== URL || typeof data.html !== 'string') throw Error('Wrong source URL or missing DOM: '+file);
    const dom=new JSDOM(data.html,{url:data.url}), discovered=core.discover(dom.window.document);
    sources.push({path:absolute,url:data.url,sha256:digest(data.html),capturedAt:data.capturedAt || data.timestamp || null,historical:/2026-10-12[\\/]/.test(absolute),historicalDate:/2026-10-12[\\/]/.test(absolute)?'2026-10-12':null,messages:discovered.length});
    for (const m of discovered) {
      const text=m.roots.map(r=>r.textContent).join('\n'),round=/R(0[1-9])(?:-BEGIN|｜)/.exec(text)?.[1];
      if (!round) continue;
      const preferred = path.basename(file).includes('LONG-R'+round);
      if (messages.get(m.id)?.preferred && !preferred) continue;
      const regionNodes=visual.uiBlocks(m);
      messages.set(m.id,{id:m.id,role:m.role,round:'R'+round,source:absolute,preferred,blocks:extractMessage(m),uiRegions:regionNodes.length,uiRegionInventory:regionNodes.map((node,index)=>({index:index+1,tag:node.tagName,text:logicalText(node),svgLabels:[...node.querySelectorAll('svg text')].map(n=>n.textContent),sourcePath:core.pathFor?.(m,node)||null}))});
    }
    dom.window.close();
  }
  const list=[...messages.values()].sort((a,b)=>a.round.localeCompare(b.round)||(a.role==='user'?-1:1));
  const counts={};for(const m of list)for(const b of m.blocks)counts[b.kind]=(counts[b.kind]||0)+1;
  return {sourceUrl:URL,mode:'source-browser-DOM-block-ledger',createdAt:new Date().toISOString(),sources,messages:list,counts,complete18MessageInventory:list.length===18,limitations:['历史DOM不证明本轮实时UI状态；仅本轮现场抓取及截图可作为动态状态真值。','含cm-gap的代码仅记录可见行，不声明完整代码已核对。','此台账尚未比较渲染后的导出HTML、PDF或分页PNG，因此不构成新验收通过。']};
}
if(require.main===module){const [out,...files]=process.argv.slice(2);if(!out||!files.length)throw Error('Usage: build-source-block-ledger.cjs <ledger.json> <source-DOM.json> ...');const ledger=build(files);fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(ledger,null,2));console.log(JSON.stringify({messages:ledger.messages.length,counts:ledger.counts,partialCodes:ledger.messages.flatMap(m=>m.blocks.filter(b=>b.kind==='code'&&b.partial).map(b=>({message:m.id,round:m.round,visibleLineCount:b.visibleLineCount}))),output:path.resolve(out)},null,2));}
module.exports={build,extractMessage,logicalText,normalize};
