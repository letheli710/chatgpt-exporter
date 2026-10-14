(function(root){
  'use strict';
  const core=()=>root.ChatExportCore || (typeof require==='function'?require('./core'):null);
  const automation=()=>root.ChatExportAutomation || (typeof require==='function'?require('./automation'):null);
  const now=()=>root.performance?.now() ?? Date.now();
  const noop=()=>{};
  function check(signal){if(signal?.aborted)throw new DOMException('用户已停止','AbortError');}
  function findMessage(id,doc=root.document){
    const matches=core().discover(doc).filter(m=>m.stable && m.id.split(/\s+/).includes(id));
    if(matches.length>1)throw Error('消息标识对应多个可见回答，已停止以避免混入其他分支');
    return matches[0] || null;
  }
  function scrollAdapter(doc){
    const first=core().discover(doc)[0],scope=core().conversationScope(doc).scope;
    const auto=automation(),el=auto.scrollerFor(first?.el || scope || doc.documentElement);
    if(!el)throw Error('无法确定当前对话滚动区域');
    return {position:()=>auto.position(el),range:()=>auto.range(el),move:value=>auto.move(el,value)};
  }
  function saveScrollPosition(doc=root.document,{scroll}={}){
    const adapter=scroll || scrollAdapter(doc),saved=adapter.position();
    return ()=>adapter.move(saved);
  }
  async function withScrollRestore(doc,task,options={}){
    const restore=saveScrollPosition(doc,options);
    try{return await task();}finally{restore();}
  }
  async function locateMessage(message,{doc=root.document,messages=[],signal,onProgress=noop,scroll,wait=ms=>automation().pause(ms),maxAttempts=14}={}){
    check(signal);const mounted=findMessage(message.id,doc);if(mounted)return mounted;
    const indexes=new Map(messages.map((m,i)=>[m.id,i])),target=indexes.get(message.id);
    if(target===undefined || messages.length<2)return null;
    const adapter=scroll || scrollAdapter(doc);
    let low=0,high=adapter.range(),lastRange=high,next=high*target/(messages.length-1),last=-1,stalled=0;
    for(let attempt=0;attempt<maxAttempts;attempt++){
      check(signal);
      const current=adapter.position(),visible=core().discover(doc).flatMap(m=>m.id.split(/\s+/).filter(id=>indexes.has(id)).map(id=>indexes.get(id)));
      if(visible.length){
        if(target<Math.min(...visible))high=Math.min(high,current);
        else if(target>Math.max(...visible))low=Math.max(low,current);
      }
      if(attempt>0)next=(low+high)/2;
      next=Math.max(0,Math.min(adapter.range(),next));
      if(Math.abs(next-last)<2)stalled++;else stalled=0;
      if(stalled>=2)break;
      last=next;onProgress({messageId:message.id,phase:'locate-ui',attempt:attempt+1,total:maxAttempts});
      adapter.move(next);await wait(240);check(signal);
      const found=findMessage(message.id,doc);if(found)return found;
      // Virtualized height estimates can change when cards mount. Expand the
      // upper search bound only when its physical range actually changes.
      const measuredRange=adapter.range();
      if(measuredRange>lastRange)high+=measuredRange-lastRange;
      high=Math.min(high,measuredRange);lastRange=measuredRange;
    }
    return null;
  }
  async function stableBlock(message,path,options){
    const {doc=root.document,signal,wait=ms=>automation().pause(ms)}=options;
    for(let attempt=0;attempt<4;attempt++){
      check(signal);const dom=await locateMessage(message,options);if(!dom)throw Error('目标消息未重新挂载');
      let el=core().resolvePath(dom,path);if(!el?.isConnected)throw Error('目标卡片路径已改变，请重新预览');
      el.scrollIntoView?.({block:'start',behavior:'instant'});
      await wait(120);check(signal);
      const fresh=findMessage(message.id,doc),candidate=fresh && core().resolvePath(fresh,path);
      if(!candidate?.isConnected)continue;
      const before=candidate.getBoundingClientRect(),text=candidate.textContent;
      await wait(100);check(signal);
      const afterDom=findMessage(message.id,doc),after=afterDom && core().resolvePath(afterDom,path);
      if(!after?.isConnected)continue;
      const rect=after.getBoundingClientRect();
      if(after.textContent===text && Math.abs(rect.width-before.width)<=1 && Math.abs(rect.height-before.height)<=1)return after;
    }
    throw Error('目标卡片重新挂载后仍在变化，请等待页面稳定');
  }
  function boundaryOf(target,doc=target?.ownerDocument || root.document){
    return core().discover(doc).find(m=>m.el===target || m.el.contains(target)) || null;
  }
  function parentBoundary(target,doc=target?.ownerDocument || root.document){
    const m=boundaryOf(target,doc);
    if(!m || target===m.el)return target;
    return target.parentElement && m.el.contains(target.parentElement)?target.parentElement:m.el;
  }
  function active(n){
    for(let p=n;p?.nodeType===1;p=p.parentElement){
      if(p.hidden || p.getAttribute('aria-hidden')==='true' || p.hasAttribute('inert'))return false;
      const style=p.ownerDocument.defaultView?.getComputedStyle(p);
      if(style && (style.display==='none' || style.visibility==='hidden'))return false;
    }
    return true;
  }
  function uiBlocks(m){
    // DIL may wrap the entire prose response, including ordinary long code. Only
    // bounded visual cards are screenshot targets, never every response root.
    const dil=[...m.el.querySelectorAll('[data-archive-widget],[data-dil-message-id] [data-d-component="box"][data-d-has-border],.DilResponseRoot [data-d-component="box"][data-d-has-border]')].filter(active);
    const planned=core().planBlocks(m).map(b=>b.el).filter(active);
    const charts=[...m.el.querySelectorAll('[data-w-component="chart"],[role="img"][aria-label*="chart"]')].filter(active).map(n=>n.closest('[role="img"]') || n);
    const all=[...new Set([...dil,...planned,...charts])];
    return all.filter(n=>!all.some(p=>p!==n && p.contains(n)));
  }
  const pendingSelector='[aria-busy="true"],[data-state="loading"],[data-loading="true"]';
  async function settleUI(message,{doc=root.document,signal,wait=ms=>automation().pause(ms),onProgress=noop,maxRounds=8,...options}={}){
    let previous=null,stable=0;const visited=new Set();
    for(let round=0;round<maxRounds;round++){
      check(signal);const dom=await locateMessage(message,{doc,signal,wait,...options});
      if(!dom)return {message:null,ready:false,reason:'目标交互消息未挂载'};
      const chartSeeds=[...dom.el.querySelectorAll('[data-w-component="chart"],[role="img"][aria-label*="chart"],'+pendingSelector)].map(n=>n.closest('[role="img"]') || n);
      let activated=false;
      for(const el of [...new Set(chartSeeds)]){
        const path=core().nodePath(dom,el);if(visited.has(path) || visited.size>=8)continue;
        visited.add(path);el.scrollIntoView?.({block:'center',behavior:'instant'});activated=true;
      }
      // Observe only structural/text completion. SVG animation path coordinates
      // and virtual code rows must not force a needless full-response scroll.
      const copy=dom.el.cloneNode(true);copy.querySelectorAll('pre,[data-markdown-copy="code-block"],.cm-editor,[role="tooltip"],.recharts-tooltip-wrapper,[aria-hidden="true"],[hidden],[data-archive-owned]').forEach(n=>n.remove());
      const key=JSON.stringify([copy.textContent,copy.querySelectorAll('*').length,copy.querySelectorAll('svg,canvas,img').length,[...dom.el.querySelectorAll('input,select,textarea')].map(n=>[n.value,n.checked])]);
      const pending=!!dom.el.querySelector(pendingSelector) || chartSeeds.some(n=>!n.querySelector('svg,canvas,img') && !n.textContent.trim());
      stable=key===previous && !activated && !pending?stable+1:0;previous=key;
      onProgress({messageId:message.id,phase:'settle-ui',attempt:round+1,total:maxRounds});
      if(stable>=2)return {message:dom,ready:true};
      await wait(120);
    }
    return {message:findMessage(message.id,doc),ready:false,reason:'交互界面仍在加载或子树尚未稳定，当前归档可能缺少异步内容'};
  }
  function needsInteractive(message,blocks=[]){return blocks.length>0 || !!message.needsUI && (!message.uiReasons?.length || message.uiReasons.some(reason=>!['model-dil','table-literal'].includes(reason)));}
  function hasUI(message,doc=root.document){const m=findMessage(message.id,doc);return !!m && (message.needsTableUI && !!m.el.querySelector('table') || needsInteractive(message,uiBlocks(m)));}
  function signature(message,doc=root.document){
    const m=findMessage(message.id,doc);if(!m)return null;
    const nodes=uiBlocks(m),result=[];
    if(message.needsTableUI)nodes.push(...m.el.querySelectorAll('table'));
    for(const el of nodes){
      const clone=el.cloneNode(true);clone.querySelectorAll('pre,[data-markdown-copy="code-block"],.cm-editor,script,style,[aria-hidden="true"],[hidden],[role="tooltip"],.recharts-tooltip-wrapper,[data-archive-owned]').forEach(n=>n.remove());
      const controls=[el,...el.querySelectorAll('input,textarea,select,[role="checkbox"],[role="radio"],[role="switch"],[role="slider"]')].filter(n=>active(n)).map(n=>[n.value ?? null,n.checked ?? null,n.getAttribute('aria-checked'),n.getAttribute('aria-valuenow'),n.getAttribute('aria-valuetext')]);
      result.push([clone.textContent.replace(/\s+/g,' ').trim(),controls]);
    }
    return JSON.stringify(result);
  }
  const tablePattern=/^[ \t]*\|[^\n]*\|[ \t]*\n[ \t]*\|[ \t:|\-]+\|[ \t]*(?:\n[ \t]*\|[^\n]*\|[ \t]*)*/gm;
  function headerKey(line){return line.trim().replace(/^\||\|$/g,'').split('|').map(v=>v.replace(/<[^>]*>/g,'').replace(/[\\`*_]/g,'').replace(/\s+/g,'').trim()).join('|');}
  async function repairTables(md,dom){
    const byHeader=new Map();
    for(const table of dom.el.querySelectorAll('table')){
      if(!active(table))continue;
      const header=table.querySelector('tr');if(!header)continue;
      const key=[...header.children].map(c=>c.textContent.replace(/\s+/g,'')).join('|');
      if(byHeader.has(key)){byHeader.set(key,null);continue;}
      byHeader.set(key,await core().convert({id:dom.id,roots:[table]},{warnings:[],asset:async()=>{throw Error('表格资产需要截图');}}));
    }
    let count=0;
    // Protect source programs and equations; only actual prose tables are eligible.
    const protectedParts=[];
    const fenced=md.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*(?=\n|$)/gm,m=>`\u0000TABLE_PROTECTED_${protectedParts.push(m)-1}\u0000`);
    // normalizeText may insert this exact notice just before a protected inline
    // formula. Remove that insertion before recognizing the whole source table.
    const joined=fenced.replace(/\n{1,2}> 表格代码单元格已保留接口原字符并修复分列；页面显示的转义字符需要核对。/g,'');
    const safe=joined.replace(/(\$\$[\s\S]*?\$\$)|(\\\([\s\S]*?\\\))|(\\\[[\s\S]*?\\\])/gm,m=>`\u0000TABLE_PROTECTED_${protectedParts.push(m)-1}\u0000`);
    const result=safe.replace(tablePattern,table=>{const replacement=byHeader.get(headerKey(table.split('\n')[0]));if(!replacement)return table;count++;return replacement;}).replace(/\u0000TABLE_PROTECTED_(\d+)\u0000/g,(_,i)=>protectedParts[Number(i)]);
    return {md:count?result:md,count};
  }
  const numericTokens=s=>String(s).match(/[+-]?\d[\d,]*(?:\.\d+)?/g) || [];
  const uiTemplate=s=>String(s).replace(/〔实时状态未包含在接口文字中，需要从页面补充〕/g,'').replace(/<[^>]+>/g,'').replace(/^[ \t]*#{1,6}\s*/,'').replace(/[\\`*_]/g,'').replace(/[+-]?\d[\d,]*(?:\.\d+)?/g,'').replace(/[+−-]/g,'').replace(/\s+/g,'').trim();
  function repairedUIBody(body,supplement){
    const protectedParts=[];
    body=body.replace(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?=\n|$))|(\$\$[\s\S]*?\$\$)|(\\\([\s\S]*?\\\))|(\\\[[\s\S]*?\\\])/gm,m=>`\u0000UI_BODY_${protectedParts.push(m)-1}\u0000`);
    const tables=[...supplement.matchAll(tablePattern)].map(m=>m[0]);
    const rowLabel=s=>String(s).replace(/[\\`*_]/g,'').replace(/\s+/g,'').trim();
    const rows=table=>table.split('\n').filter(line=>!/^\s*\|[\s:|\-]+\|\s*$/.test(line)).map(line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim()));
    body=body.replace(tablePattern,table=>{
      const old=rows(table),values=old.flatMap(row=>row.slice(1));
      if(!old.length || values.some(value=>numericTokens(value).length))return table;
      const key=JSON.stringify([old[0].length,old.map(row=>rowLabel(row[0]))]);
      const matches=tables.filter(candidate=>{
        const actual=rows(candidate);if(JSON.stringify([actual[0]?.length,actual.map(row=>rowLabel(row[0]))])!==key)return false;
        return old.every((row,r)=>row.length===actual[r].length && row.slice(1).every((value,c)=>numericTokens(actual[r][c+1]).length>0 && uiTemplate(value)===uiTemplate(actual[r][c+1])));
      });
      return matches.length===1?matches[0]:table;
    });
    const source=supplement.split(/\n{2,}/).filter(p=>p.trim()),templates=new Map();
    for(const paragraph of source){
      if(paragraph.startsWith('|') || !numericTokens(paragraph).length)continue;
      const key=uiTemplate(paragraph);if(!key)continue;
      if(templates.has(key) && templates.get(key)!==paragraph)templates.set(key,null);else if(!templates.has(key))templates.set(key,paragraph);
    }
    const paragraphs=body.split(/\n{2,}/);
    for(let i=0;i<paragraphs.length;i++){
      const paragraph=paragraphs[i];if(paragraph.includes('\u0000') || paragraph.trim().startsWith('|'))continue;
      const key=uiTemplate(paragraph),withoutAction=uiTemplate(paragraph.replace(/\s*\[[^\]]+\]\s*$/,''));
      const candidate=templates.get(key) || templates.get(withoutAction),oldValues=numericTokens(paragraph);
      if(candidate && numericTokens(candidate).length>oldValues.length){
        const actualValues=numericTokens(candidate);let at=0;
        if(oldValues.every(value=>{while(at<actualValues.length && actualValues[at]!==value)at++;return at++<actualValues.length;}))paragraphs[i]=candidate;
      }else if(!oldValues.length && (templates.has(key) || templates.has(withoutAction))){
        paragraphs[i]='> 接口未含此处实时状态，见下方交互界面补充：'+paragraph.replace(/^\s*#{1,6}\s*/,'');
      }
      // A numeric display can be missing entirely between its unchanged title
      // and unit. Restore only a uniquely matched source title/value/unit triple.
      if(i+1<paragraphs.length){
        const triples=source.slice(0,-2).map((p,j)=>[p,source[j+1],source[j+2]]).filter(([title,value,unit])=>uiTemplate(title)===uiTemplate(paragraphs[i]) && uiTemplate(unit)===uiTemplate(paragraphs[i+1]) && /^[+-]?\d[\d,.]*%?$/.test(value.replace(/^[ \t]*#{1,6}\s*/,'').replace(/[*_`\s]/g,'')));
        if(triples.length===1)paragraphs[i]+='\n\n'+triples[0][1];
      }
    }
    return paragraphs.join('\n\n').replace(/\u0000UI_BODY_(\d+)\u0000/g,(_,i)=>protectedParts[Number(i)]);
  }
  async function uiText(el,id){
    // Read live properties before cloning: attribute defaults do not represent user changes.
    const clone=el.cloneNode(true),holder=el.ownerDocument.createElement('div'),originals=[el,...el.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];holder.append(clone);
    originals.forEach((n,i)=>{
      const c=copies[i];if(!c || !c.parentNode && c!==clone)return;
      if(!active(n) || n.matches('script,style,noscript,[data-archive-owned],pre,[data-markdown-copy="code-block"],.cm-editor')){c.remove();return;}
      if(n.matches('input,select,textarea,[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],button')){
        if(n.matches('input[type="hidden"]')){c.remove();return;}
        const associated=n.closest('label') || n.labels?.[0] || (n.id && [...el.querySelectorAll('label[for]')].find(l=>l.htmlFor===n.id));
        const label=associated?'':n.getAttribute('aria-label') || n.getAttribute('title') || '';
        let value='';
        if(n.matches('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],[role="switch"]'))value=(n.checked || n.getAttribute('aria-checked')==='true')?'☑ 已勾选':'☐ 未勾选';
        else if(n.matches('select'))value=[...n.selectedOptions].map(o=>o.textContent).join('、');
        else value=n.value ?? n.getAttribute('aria-valuetext') ?? n.getAttribute('aria-valuenow') ?? n.textContent;
        const span=c.ownerDocument.createElement('span');span.textContent=[value,label && !String(value).includes(label)?label:''].filter(Boolean).join(' ');c.replaceWith(span);
      }
      if(n.matches('svg')){const span=c.ownerDocument.createElement('span');span.textContent=[...n.querySelectorAll('text,title,desc')].map(t=>t.textContent).join(' ');c.replaceWith(span);}
      if(n.matches('img,canvas,iframe,video,audio'))c.remove();
    });
    const warnings=[];
    const text=await core().convert({id,roots:[holder]}, {warnings,asset:async()=>{throw Error('使用截图保存图像');}});
    return text.replace(/Current selection unavailable\.?/gi,'').replace(/\uE200[^\uE201]*\uE201/g,'').trim();
  }
  async function captureTarget(target,message,options={}){
    const doc=options.doc || target.ownerDocument;
    const dom=boundaryOf(target,doc);
    if(!dom || !dom.id.split(/\s+/).includes(message.id))throw Error('截图区域不属于所选消息');
    check(options.signal);
    const result=await automation().captureElement(target,{...options,hide:options.hide || noop,show:options.show || noop});
    return {...result,path:options.path || `assets/${String(message.id).replace(/[^a-zA-Z0-9_-]/g,'_')}-ui.png`,kind:'screenshot',messageId:message.id};
  }
  async function enrich(message,{doc=root.document,signal,capture,hide=noop,show=noop,screenshot=true,onProgress=noop,messages=[],scroll,wait}={}){
    const started=now(),assets=[],warnings=[],timings={locateMs:0,settleMs:0,textMs:0,captureMs:0,totalMs:0},parts=[];
    check(signal);
    let dom=await locateMessage(message,{doc,messages,signal,onProgress,scroll,wait});
    timings.locateMs=now()-started;
    if(!dom){warnings.push(`${message.id}: 有限稳定 ID 定位后仍未加载交互界面，API 正文已保留；未进行全段滚动扫描`);return {md:message.md,assets,warnings,textSupplemented:false,captureComplete:false,timings:{...timings,totalMs:now()-started}};}
    let uiReady=true;
    if(needsInteractive(message,uiBlocks(dom))){
      const settleStart=now();
      const settled=await settleUI(message,{doc,messages,signal,onProgress,scroll,wait});uiReady=settled.ready;dom=settled.message || dom;
      timings.settleMs=now()-settleStart;
      if(!uiReady)warnings.push(`${message.id}: ${settled.reason}`);
    }
    const tableResult=message.needsTableUI?await repairTables(message.md,dom):{md:message.md,count:0};
    let body=tableResult.md;
    const blocks=uiBlocks(dom);
    const interactiveNeeded=needsInteractive(message,blocks);
    if(!blocks.length && interactiveNeeded){
      const roots=[...dom.el.querySelectorAll('[data-dil-message-id],.DilResponseRoot')].filter(active);
      for(const el of roots.filter(n=>!roots.some(p=>p!==n && p.contains(n)))){
        const t=now(),text=await uiText(el,message.id);timings.textMs+=now()-t;
        if(text)parts.push(`#### 交互界面当前文字\n\n${text}`);
      }
      if(screenshot)warnings.push(`${message.id}: 交互内容未识别到独立卡片边界，请手动选择截图区域`);
    }
    for(let i=0;i<blocks.length;i++){
      check(signal);let el=blocks[i];const path=core().nodePath(dom,el);onProgress({messageId:message.id,block:i+1,total:blocks.length,phase:'ui-text'});
      const t=now(),text=await uiText(el,message.id);timings.textMs+=now()-t;
      if(text)parts.push(`#### 交互界面 ${i+1} 当前文字\n\n${text}`);
      if(screenshot){
        const ct=now();
        try{
          if(typeof capture!=='function')throw Error('截图通道不可用');
          onProgress({messageId:message.id,block:i+1,total:blocks.length,phase:'screenshot'});
          el=await stableBlock(message,path,{doc,messages,signal,onProgress,scroll,wait});
          const currentText=await uiText(el,message.id);
          if(text && currentText!==text){const index=parts.indexOf(`#### 交互界面 ${i+1} 当前文字\n\n${text}`);if(index>=0)parts[index]=`#### 交互界面 ${i+1} 当前文字\n\n${currentText}`;}
          const asset=await captureTarget(el,message,{doc,signal,capture,hide,show,path:`assets/${String(message.id).replace(/[^a-zA-Z0-9_-]/g,'_')}-ui-${i+1}.png`});
          assets.push(asset);parts.push(`![交互界面 ${i+1} 当前画面](${asset.path})`);
        }catch(e){if(e.name==='AbortError')throw e;warnings.push(`${message.id}: 交互界面 ${i+1} 截图未保存：${e.message}`);parts.push(`> 交互界面 ${i+1} 截图未保存：${e.message}`);}
        finally{timings.captureMs+=now()-ct;}
      }
    }
    // The API body is authoritative: virtual DOM code editors may have only 33 of 100+ lines.
    const recovered=parts.some(p=>p.startsWith('####'));
    if(recovered){
      body=repairedUIBody(body,parts.filter(p=>p.startsWith('####')).join('\n\n'));
      body=body.replace(/〔实时状态未包含在接口文字中，需要从页面补充〕/g,'〔接口未含此处实时状态，见下方交互界面补充〕');
      body=body.replace(/\n?> 此处的交互内容无法从结构化数据解析，需要从页面补充文字及截图。/g,'');
      if(screenshot && warnings.length===0)body=body.replace(/\n?> 此处为交互(?:图表的结构化数据|内容的结构化文字)；当前画面需要从页面补充。/g,'').replace(/〔内部内容标记未展开，需要从页面核对：[^〕]*〕/g,'');
    }
    const md=[body,parts.length?'### 交互界面补充（导出时的状态）\n\n'+parts.join('\n\n'):''].filter(Boolean).join('\n\n');
    const textSupplemented=uiReady && (!interactiveNeeded || recovered) && (!message.needsTableUI || tableResult.count>0);
    if(!textSupplemented)warnings.push(`${message.id}: 交互文字仍未取得，API 正文已保留，请加载该界面后重试`);
    timings.totalMs=now()-started;
    return {md,assets,warnings,timings,uiReady,textSupplemented,tableCorrected:tableResult.count>0,captureComplete:screenshot && warnings.length===0};
  }
  const api={findMessage,locateMessage,saveScrollPosition,withScrollRestore,stableBlock,settleUI,boundaryOf,parentBoundary,uiBlocks,hasUI,signature,uiText,repairTables,repairedUIBody,captureTarget,enrich};
  root.ChatExportFastVisual=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
