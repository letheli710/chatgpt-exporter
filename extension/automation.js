(function(root) {
  'use strict';
  const pause = ms => new Promise(r => setTimeout(r, ms));
  function check(signal) { if (signal?.aborted) throw new DOMException('用户已停止，已完成的消息保留在缓存中', 'AbortError'); }
  class CodeLines {
    constructor(){this.lines=new Map();this.end=null;this.start=false;}
    add(frame){
      for(const {index,text} of frame.lines){
        if(!Number.isInteger(index) || index<0)throw Error('无法确认代码行的位置');
        if(this.lines.has(index) && this.lines.get(index)!==text)throw Error('代码重叠行发生变化，停止合并');
        this.lines.set(index,text);
      }
      this.start ||= frame.start;
      if(frame.end!==null){if(this.end!==null && this.end!==frame.end)throw Error('代码长度发生变化');this.end=frame.end;}
    }
    next(){let i=0;while(this.lines.has(i))i++;return i;}
    result(){const complete=this.start && this.end!==null && this.next()===this.end;
      return {complete,text:[...this.lines].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join('\n'),lineCount:this.lines.size};}
  }
  function codeFrame(editor){
    const nodes=[...editor.children],lines=nodes.filter(n=>n.classList.contains('cm-line'));
    if(!lines.length)throw Error('代码行尚未加载');
    const style=getComputedStyle(editor),step=lines[0].getBoundingClientRect().height;
    if(step<1)throw Error('代码行不可见');
    const origin=editor.getBoundingClientRect().top+(parseFloat(style.paddingTop)||0);
    const values=lines.map(n=>{const r=n.getBoundingClientRect(),slot=(r.top-origin)/step;
      if(Math.abs(slot-Math.round(slot))*step>1 || Math.abs(r.height-step)>1)throw Error('代码行布局不规则，无法安全合并');
      return {index:Math.round(slot),text:n.textContent};});
    return {lines:values,start:nodes[0]===lines[0],end:nodes.at(-1)===lines.at(-1)?values.at(-1).index+1:null,step};
  }
  async function collectCode(surface,{signal,progress}={}){
    const editor=surface.querySelector('.cm-content');if(!editor)return null;
    const fallback=[...editor.querySelectorAll('.cm-line')].map(n=>n.textContent).join('\n');
    if(!editor.querySelector('.cm-gap'))return {text:fallback,complete:true};
    const ancestors=[];for(let p=editor.parentElement;p;p=p.parentElement)ancestors.push({el:p,top:p.scrollTop,left:p.scrollLeft});
    const before=editor.getAttribute('data-archive-code'),style=document.createElement('style');
    const read=new CodeLines();let reason='未能读取全部代码行';
    try{
      editor.setAttribute('data-archive-code','reading');style.dataset.archiveOwned='code';
      style.textContent='[data-archive-code="reading"] .cm-line { white-space: pre !important; }';document.head.append(style);
      surface.scrollIntoView({block:'start',behavior:'instant'});await pause(180);
      const scroller=scrollerFor(editor);let stalled=0;
      for(let i=0;i<240;i++){
        check(signal);if(!editor.isConnected)throw Error('代码编辑器已卸载');
        const frame=codeFrame(editor),count=read.lines.size;read.add(frame);
        progress?.({iteration:i,lines:read.lines.size,next:read.next(),position:position(scroller),range:range(scroller),first:frame.lines[0].index,last:frame.lines.at(-1).index});
        if(read.result().complete)return read.result();
        stalled=read.lines.size===count?stalled+1:0;if(stalled>10)throw Error('滚动后没有加载新的代码行');
        const view=viewport(scroller),target=editor.getBoundingClientRect().top+(parseFloat(getComputedStyle(editor).paddingTop)||0)+read.next()*frame.step;
        move(scroller,position(scroller)+target-view.top-Math.min(80,(view.bottom-view.top)/4));await pause(350);
      }
    }catch(e){if(e.name==='AbortError')throw e;reason=e.message;}
    finally{
      style.remove();if(before===null)editor.removeAttribute('data-archive-code');else editor.setAttribute('data-archive-code',before);
      for(const {el,top,left} of ancestors){el.scrollTop=top;el.scrollLeft=left;}
    }
    // Do not silently join disjoint fragments into an apparently complete program.
    return {text:fallback,complete:false,reason};
  }
  class RecordStore {
    constructor() { this.records = new Map(); this.ids = []; this.conversationId=null; }
    observe(batch) {
      const owners=new Set(batch.map(m=>m.conversationId).filter(Boolean));
      if(this.conversationId)owners.add(this.conversationId);
      if(owners.size>1)throw Error('检测到不同聊天的消息，已阻止合并缓存');
      this.conversationId=[...owners][0] || null;
      for (let i = 0; i < batch.length; i++) {
        const m = batch[i];
        if (!this.ids.includes(m.id)) {
          const next = batch.slice(i+1).find(n => this.ids.includes(n.id));
          const prev = batch.slice(0,i).reverse().find(n => this.ids.includes(n.id));
          if (next) this.ids.splice(this.ids.indexOf(next.id),0,m.id);
          else if (prev) this.ids.splice(this.ids.indexOf(prev.id)+1,0,m.id);
          else this.ids.push(m.id);
        }
        const old = this.records.get(m.id);
        this.records.set(m.id, {...old, id:m.id, role:m.role, conversationId:m.conversationId || old?.conversationId, order:m.order, stable:m.stable, summary:m.summary || old?.summary || m.roots?.map(r=>r.textContent).join(' ').trim().slice(0,80)});
      }
      if (this.ids.every(id => this.records.get(id).order != null)) this.ids.sort((a,b) => this.records.get(a).order-this.records.get(b).order);
    }
    save(record) { this.observe([record]); this.records.set(record.id,record); }
    values() { return this.ids.map(id => this.records.get(id)); }
  }
  function scrollerFor(el) {
    for (let p = el?.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (/(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return document.scrollingElement;
  }
  function range(scroller) { return Math.max(0,scroller.scrollHeight-scroller.clientHeight); }
  function reversed(scroller) { return getComputedStyle(scroller).flexDirection === 'column-reverse'; }
  function position(scroller) { return Math.max(0,Math.min(range(scroller), reversed(scroller) ? range(scroller)+scroller.scrollTop : scroller.scrollTop)); }
  function move(scroller, top) {
    const normal = Math.max(0,Math.min(range(scroller),top));
    scroller.scrollTo({top:reversed(scroller) ? normal-range(scroller) : normal,behavior:'instant'});
  }
  function viewport(scroller) {
    const r = scroller === document.scrollingElement ? {top:0,left:0,right:innerWidth,bottom:innerHeight} : scroller.getBoundingClientRect();
    return {top:Math.max(0,r.top)+12, bottom:Math.min(innerHeight,r.bottom)-12, left:Math.max(0,r.left), right:Math.min(innerWidth,r.right)};
  }
  function cropPlan(rect, view, covered) {
    if (rect.left < view.left-1 || rect.right > view.right+1) throw Error('内容块横向超出窗口，需要缩小浏览器缩放后重试');
    const top = rect.top + covered;
    if (top < view.top-1 || top >= view.bottom-1) throw Error('无法将下一段内容滚动到可见区域');
    const height = Math.min(rect.height-covered,view.bottom-top);
    if (height < 1) throw Error('没有可截图的内容');
    return {x:rect.left,y:top,width:rect.width,height,offset:covered};
  }
  function unobscured(el, rect) {
    // Rounded corners are intentionally transparent; sample inside their content edges.
    const insetX=Math.min(24,rect.width/4),insetY=Math.min(12,rect.height/4);
    for (const x of [rect.x+insetX,rect.x+rect.width/2,rect.x+rect.width-insetX]) {
      const ys=[rect.y+insetY,rect.y+rect.height-insetY];
      for(let y=rect.y+insetY+16;y<rect.y+rect.height-insetY;y+=16)ys.push(y);
      for (const y of ys) {
        const hit = document.elementFromPoint(x,y);
        if (!hit || !(el === hit || el.contains(hit))) return false;
      }
    }
    return true;
  }
  const tooltipSelector='[role="tooltip"],.recharts-tooltip-wrapper,.recharts-tooltip-cursor,.recharts-active-dot,[data-d-component="tooltip"]';
  function neutralText(el){const copy=el.cloneNode(true);copy.querySelectorAll(tooltipSelector).forEach(n=>n.remove());return copy.textContent;}
  function prepareCapture(el){
    // Visibility preserves layout and scroll range; removing the stylesheet restores everything.
    const selectors=tooltipSelector+',[data-thread-scroll-footer],[data-chatgpt-composer],[data-testid="composer"]';
    const style=document.createElement('style');style.setAttribute('data-archive-owned','capture');
    style.textContent=selectors+','+selectors.split(',').map(s=>s+' *').join(',')+' { visibility: hidden !important; } * { caret-color: transparent !important; }';
    document.head.append(style);
    const selection=document.getSelection(),ranges=[];
    for(let i=0;selection && i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
    selection?.removeAllRanges();
    const suppress=e=>e.stopImmediatePropagation();
    const events=['pointermove','pointerover','mousemove','mouseover'];
    events.forEach(t=>document.addEventListener(t,suppress,true));
    for(const node of [el,...el.querySelectorAll(':hover')]){
      node.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}));
      node.dispatchEvent(new MouseEvent('mouseleave',{relatedTarget:document.body}));
    }
    return ()=>{style.remove();events.forEach(t=>document.removeEventListener(t,suppress,true));
      if(selection){selection.removeAllRanges();for(const range of ranges)if(range.startContainer.isConnected && range.endContainer.isConnected)selection.addRange(range);}
    };
  }
  async function captureElement(el, options) {
    const {signal, capture, hide, show} = options;
    check(signal);
    if (!el?.isConnected) throw Error('内容块已卸载，请重新收集');
    const scroller = scrollerFor(el), saved = position(scroller), view = viewport(scroller);
    const initial = el.getBoundingClientRect(), width = initial.width, height = initial.height;
    const initialText = neutralText(el);
    if (width < 1 || height < 1) throw Error('内容块不可见');
    if (height*devicePixelRatio > 28000 || width*height*devicePixelRatio**2 > 45000000) throw Error('内容块超过截图内存上限，已保留缺失提示');
    const tiles = []; let covered = 0, canvas,restore;
    try {
      restore=prepareCapture(el);hide(); await pause(120);
      while (covered < height-0.5) {
        check(signal);
        if (tiles.length >= 80) throw Error('跨屏截图超过 80 段上限');
        if (!el.isConnected) throw Error('截图时内容块被页面卸载');
        let r = el.getBoundingClientRect();
        move(scroller,position(scroller)+r.top+covered-view.top);
        await pause(220); check(signal);
        r = el.getBoundingClientRect();
        if (!el.isConnected || neutralText(el)!==initialText || Math.abs(r.height-height)>1 || Math.abs(r.width-width)>1) throw Error('截图时内容或尺寸发生变化，请等待页面稳定后重试');
        let crop = cropPlan(r,view,covered);
        // Fixed headers/composer may overlap the scrollport. Shrink only the tile's bottom;
        // if its beginning is hidden, move it down and retry before capturing.
        if (!unobscured(el,{...crop,height:Math.min(4,crop.height)})) {
          move(scroller,position(scroller)-96); await pause(180); r=el.getBoundingClientRect(); crop=cropPlan(r,view,covered);
        }
        while (crop.height > 32 && !unobscured(el,crop)) crop.height -= 24;
        if (!unobscured(el,crop)) throw Error('截图区域被悬浮界面遮挡，请关闭遮挡后重试');
        const vw=innerWidth,vh=innerHeight, data=await capture(); check(signal);
        const after=el.getBoundingClientRect();
        if (!el.isConnected || vw!==innerWidth || vh!==innerHeight || ['top','left','width','height'].some(k=>Math.abs(r[k]-after[k])>1)) throw Error('截图过程中页面移动或尺寸变化，请重试');
        const image=new Image(); image.src=data; await image.decode();
        const sx=image.width/vw,sy=image.height/vh;
        if (!canvas) { canvas=document.createElement('canvas'); canvas.width=Math.round(width*sx); canvas.height=Math.round(height*sy); }
        const y1=Math.round(covered*sy),y2=Math.round((covered+crop.height)*sy);
        canvas.getContext('2d').drawImage(image,crop.x*sx,crop.y*sy,crop.width*sx,crop.height*sy,0,y1,canvas.width,y2-y1);
        tiles.push({offset:covered,height:crop.height}); covered+=crop.height;
      }
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png')); if(!blob) throw Error('截图编码失败');
      return {blob,tiles,width,height};
    } finally { restore?.();move(scroller,saved); show(); }
  }
  // A bounded traversal of rendered history. No conversation API or private application state.
  async function collect({adapter, process, signal, progress, maxSteps=600}) {
    const processed=new Set(); let topReached=false,bottomReached=false,steps=0,stable=0,lastTopSignature='';
    const bookmark=adapter.position();
    try {
      // Virtualized lists may extend their scroll range while older messages load.
      for(let i=0;i<20;i++) {
        check(signal); await adapter.move(0); await adapter.settle();
        const batch=await adapter.scan(),signature=batch.map(m=>m.id).join('|')+':'+adapter.range();
        if(adapter.position()<2 && signature===lastTopSignature) stable++; else stable=0;
        lastTopSignature=signature;
        if(stable>=2){topReached=true;break;}
      }
      if(!topReached) throw Error('无法确认滚动顶部已稳定，请稍后重试');
      let bottomStable=0;
      while(steps++<maxSteps) {
        check(signal);
        const start=adapter.position(), batch=await adapter.scan();
        for(const m of batch) {
          check(signal);
          if(!m.stable) throw Error('发现缺少稳定标识的消息，停止全量收集以避免重复或覆盖');
          if(processed.has(m.id)) continue;
          await process(m); processed.add(m.id); progress?.({messages:processed.size,steps});
        }
        await adapter.move(start); await adapter.settle();
        const end=adapter.range();
        if(adapter.position()>=end-2) {
          const next=await adapter.scan();
          if(next.every(m=>processed.has(m.id))) bottomStable++; else bottomStable=0;
          if(bottomStable>=3){bottomReached=true;break;}
        } else bottomStable=0;
        const next=Math.min(end,adapter.position()+Math.max(100,adapter.height()*0.65));
        await adapter.move(next); await adapter.settle();
      }
      return {topReached,bottomReached,messages:processed.size,steps,complete:topReached&&bottomReached};
    } finally { await adapter.move(bookmark); }
  }
  const api={RecordStore,CodeLines,collectCode,scrollerFor,position,move,range,viewport,cropPlan,captureElement,collect,check,pause};
  root.ChatExportAutomation=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
