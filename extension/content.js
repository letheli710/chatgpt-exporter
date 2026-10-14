(() => {
  if (globalThis.__conversationArchive) { globalThis.__conversationArchive.hidden = !globalThis.__conversationArchive.hidden; return; }
  const core = globalThis.ChatExportCore;
  const auto = globalThis.ChatExportAutomation;
  const extensionVersion = globalThis.chrome?.runtime?.getManifest?.()?.version || "0.4.2";
  const host = document.createElement('div'); host.dataset.archiveOwned = 'true';
  globalThis.__conversationArchive = host; document.documentElement.append(host);
  const shadow = host.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font:14px/1.5 system-ui;color:#172330} :host([hidden]){display:none}
    *{box-sizing:border-box} main{width:370px;max-height:90vh;overflow:auto;background:#fff;border:1px solid #b9c6d1;border-radius:14px;padding:18px;box-shadow:0 8px 40px #0003}
    h2{font-size:18px;margin:0 0 10px} p{margin:8px 0} button{padding:7px 10px;margin:3px;border:1px solid #aebdca;border-radius:6px;background:#f2f6f9;cursor:pointer}button:disabled{opacity:.5;cursor:wait}
    label{display:block;padding:6px;border-bottom:1px solid #e6ebef} #list{max-height:260px;overflow:auto} textarea{width:100%;height:180px} .note{font-size:12px;color:#596976} #status{white-space:pre-wrap} .primary{background:#155c54;color:white}
    #picker{display:none;position:fixed;inset:0;z-index:2;cursor:crosshair} #outline{position:fixed;border:3px solid #13ba98;background:#13ba9819;pointer-events:none} #tools{position:fixed;left:12px;top:12px;background:white;border:1px solid #aaa;padding:10px;border-radius:8px;max-width:550px;cursor:default} input[type=number]{width:65px}
  </style><main><h2>对话归档 · 0.4.2</h2><p class="note">自动识别交互卡片并截图，正文保留为文字。长对话可从顶部滚动收集到末尾，过程中请保持标签页在前台，不要操作页面。</p><div><button id="refresh">刷新消息</button><button id="all">全选</button><button id="none">清空</button><button id="close">收起</button></div><div id="list"></div><p><button id="collect">收集整段对话</button><button id="auto">自动处理所选消息</button><button id="stop" disabled>停止</button></p><p><button id="pick">手动补截图</button><button id="preview">预览 Markdown</button><button id="export" class="primary">导出 ZIP</button></p><p class="note">预览和导出会自动处理尚未缓存的消息。超出一屏的卡片自动滚动拼接；失败区域会明确标记。手动截图替换所选 DOM 块，可调整边界。</p><div id="status" role="status"></div><textarea id="output" hidden readonly aria-label="Markdown 预览"></textarea></main><div id="picker"><div id="outline"></div><div id="tools">移动选择内容块，点击锁定。<br><button id="parent">扩大到父级</button><button id="child">缩小到子级</button><button id="unlock">重新选择</button><button id="capture">保存截图</button><button id="cancel">取消</button><br><span id="coords"></span><p id="pickStatus"></p></div></div>`;
  const $ = id => shadow.getElementById(id);
  const status = text => { $('status').textContent = text; };
  let messages = [], replacements = new Map(), busy = false, store = new auto.RecordStore(), controller = null;
  let collection = null, sourceURL = location.origin + location.pathname, lastCapture = 0, assetSequence = 0;
  const unchecked = new Set();
  function sameConversation() {
    if (location.origin + location.pathname !== sourceURL) throw Error('已切换对话，请点击刷新消息开始新的归档');
    if(document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"]'))throw Error('回复仍在生成，请完成后再归档');
  }
  function renderList() {
    $('list').replaceChildren();
    for (const [index,m] of store.values().entries()) {
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type='checkbox'; checkbox.checked=!unchecked.has(m.id); checkbox.dataset.index=index; checkbox.dataset.messageId=m.id;
      checkbox.onchange=()=>{ if(checkbox.checked)unchecked.delete(m.id);else unchecked.add(m.id); };
      label.append(checkbox, ` ${m.role==='user'?'我':'ChatGPT'}${m.md!==undefined?' ✓':''} · ${m.summary}`); $('list').append(label);
    }
  }
  function scan() { sameConversation(); messages=core.discover(document); store.observe(messages); return messages; }
  function refresh() {
    if(busy)return;
    if(location.origin+location.pathname!==sourceURL){store=new auto.RecordStore();replacements.clear();unchecked.clear();collection=null;sourceURL=location.origin+location.pathname;}
    try{scan(); renderList(); status(`当前加载 ${messages.length} 条，归档列表 ${store.ids.length} 条。✓ 表示已缓存，滚动卸载后仍可导出。`);}catch(e){status(e.message);}
  }
  $('refresh').onclick = refresh; $('all').onclick = () => {unchecked.clear();renderList();};
  $('none').onclick = () => {store.ids.forEach(id=>unchecked.add(id));renderList();};
  $('close').onclick = () => host.hidden = true;
  async function send(message) { const r = await chrome.runtime.sendMessage(message); if (r?.error) throw Error(r.error); return r; }
  async function captureData() {
    sameConversation(); auto.check(controller?.signal);
    await auto.pause(Math.max(0,720-(Date.now()-lastCapture)));
    auto.check(controller?.signal); const result=await send({type:'archive:capture'}); lastCapture=Date.now(); return result.data;
  }
  function selectedIDs() { return [...shadow.querySelectorAll('#list input:checked')].map(n=>n.dataset.messageId); }
  async function processMessage(id, force=false) {
    sameConversation(); auto.check(controller?.signal);
    const old=store.records.get(id); if(old?.md!==undefined && !force)return old;
    const message=scan().find(m=>m.id===id);
    if(!message)throw Error('待处理消息已卸载，请用“收集整段对话”重新加载');
    const warnings=[],assets=[],failures=[],codeMetadata=[],codeResults=new Map();
    for(const root of message.roots)for(const surface of root.querySelectorAll('[data-markdown-copy="code-block"]')){
      const result=await auto.collectCode(surface,{signal:controller?.signal});if(result)codeResults.set(surface,result);
    }
    let savedBytes=0;
    const addAsset=(blob,ext,meta)=>{
      savedBytes+=blob.size; if(savedBytes>100*1024*1024)throw Error('单条消息资产超过 100 MB');
      const path=`assets/asset-${String(++assetSequence).padStart(6,'0')}.${ext}`;
      assets.push({blob,path,meta:{...meta,path,messageId:id}}); return path;
    };
    const liveReplacements = new Map();
    for (const [el, shot] of replacements) {
      if (!message.roots.some(r => r === el || r.contains(el))) continue;
      liveReplacements.set(el, shot.path); assets.push({blob:shot.blob,path:shot.path,meta:shot.meta});
    }
    const snap=async(el,reason)=>{
      const result=await auto.captureElement(el,{signal:controller?.signal,capture:captureData,hide:()=>host.hidden=true,show:()=>host.hidden=false});
      return addAsset(result.blob,'png',{method:'automatic-screenshot',reason,nodePath:core.nodePath(message,el),width:result.width,height:result.height,tiles:result.tiles,capturedAt:new Date().toISOString()});
    };
    for(const block of core.planBlocks(message)) {
      if([...liveReplacements.keys()].some(el=>el===block.el || el.contains(block.el) || block.el.contains(el)))continue;
      status(`正在处理：${old?.summary || id}\n自动截图：${block.label}`);
      try { liveReplacements.set(block.el,await snap(block.el,block.reason)); }
      catch(e){ if(e.name==='AbortError')throw e; const warning=`${id}: 自动截图失败（${block.label}）：${e.message}`;warnings.push(warning);failures.push(warning); }
    }
    const asset = async (el, message) => {
      auto.check(controller?.signal);
      try {
      let blob, extension;
      if (el.tagName.toLowerCase() === 'svg') { blob = new Blob([core.serializeSVG(el)], {type: 'image/svg+xml'}); extension = 'svg'; }
      else {
        const src = el.currentSrc || el.src; if (!src) throw Error('图片没有可用地址');
        const url = new URL(src, location.href);
        if (!['https:','http:','data:','blob:'].includes(url.protocol)) throw Error('不支持该图片地址');
        const response = await fetch(url.href, {credentials: url.origin === location.origin ? 'same-origin' : 'omit', signal: AbortSignal.timeout(12000)});
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        blob = await response.blob(); if (blob.size > 30 * 1024 * 1024) throw Error('图片超过 30 MB');
        const types = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif'};
        extension = types[blob.type.split(';')[0]]; if (!extension) throw Error('响应不是支持的图片格式');
        if (extension === 'svg') {
          const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
          if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw Error('SVG 解析失败');
          blob = new Blob([core.serializeSVG(doc.documentElement)], {type:'image/svg+xml'});
        }
      }
      return addAsset(blob,extension,{method:extension==='svg'?'svg':'original-image',nodePath:core.nodePath(message,el)});
      } catch(e) { if(e.name==='AbortError' && controller?.signal.aborted)throw e; return snap(el,'asset-download-failed: '+e.message); }
    };
    const md=await core.convert(message,{asset,replacements:liveReplacements,warnings,codeResults,codeMetadata,headingOffset:2}); auto.check(controller?.signal); sameConversation();
    if(!md.trim())throw Error('消息正文尚未加载或已卸载，未将空回复标记为成功，请重新收集');
    const totalBytes=store.values().filter(r=>r.id!==id).reduce((sum,r)=>sum+(r.assets||[]).reduce((s,a)=>s+a.blob.size,0),0)+assets.reduce((sum,a)=>sum+a.blob.size,0);
    if(totalBytes>256*1024*1024)throw Error('已缓存资产达到 256 MB 上限，请先导出已完成部分');
    const record={id,conversationId:message.conversationId,role:message.role,order:message.order,stable:message.stable,summary:old?.summary || message.roots.map(r=>r.textContent).join(' ').slice(0,80),md,assets,warnings,failures,codeMetadata,capturedAt:new Date().toISOString()};
    store.save(record); return record;
  }
  async function build() {
    const ids=selectedIDs(); if(!ids.length)throw Error('请先选择至少一条消息');
    for(const id of ids)await processMessage(id);
    const selected=ids.map(id=>store.records.get(id)),zip=new JSZip(),warnings=selected.flatMap(m=>m.warnings),assets=[];
    if(collection && !collection.complete)warnings.push('长对话收集未完成，当前仅导出已成功缓存的所选消息。');
    let md=`# ${document.title.replace(/[\r\n]/g,' ')}\n\n来源：${sourceURL}\n\n导出时间：${new Date().toISOString()}\n\n> 导出范围：${collection?.complete?'已遍历页面顶部至底部后的所选消息（不含其他分支）':'所选已加载或已缓存消息，未确认覆盖整段历史'}；交互内容仅保存静态状态。\n\n`;
    for(const m of selected){md+=`## ${m.role==='user'?'我':'ChatGPT'}\n\n${m.md}\n\n---\n\n`;for(const asset of m.assets){zip.file(asset.path,asset.blob);assets.push(asset.meta);}}
    if (warnings.length) md += '## 未完整保存的内容\n\n' + [...new Set(warnings)].map(w => '- ' + w).join('\n') + '\n';
    zip.file('conversation.md', md);
    zip.file('manifest.json', JSON.stringify({version:2,extensionVersion,converterVersion:4,url:sourceURL,exportedAt:new Date().toISOString(),scope:'selected-cached-messages',collection,messages:selected.map(({id,role,order,codeMetadata},index)=>({id,role,order,index,codeBlocks:codeMetadata})),assets,warnings:[...new Set(warnings)]},null,2));
    return {zip, md, warnings};
  }
  async function run(download) {
    if (busy) return; setBusy(true); status('正在自动处理正文、图片与交互卡片……');
    try {
      const result = await build(); $('output').hidden = false; $('output').value = result.md;
      if (download) {
        const blob = await result.zip.generateAsync({type:'blob'}), url = URL.createObjectURL(blob);
        try { await send({type:'archive:download',url}); } finally { setTimeout(() => URL.revokeObjectURL(url), 300000); }
      }
      status(`已生成 Markdown 和资产包。${result.warnings.length ? '\n有未完整保存的区域，请检查文末提示并补截图。' : ''}`);
    } catch(e) { status(e.message); }
    finally { setBusy(false);renderList(); }
  }
  $('preview').onclick = () => run(false); $('export').onclick = () => run(true);
  function setBusy(value) {
    busy=value; if(value)controller=new AbortController();
    for(const id of ['export','preview','refresh','all','none','collect','auto','pick','close'])$(id).disabled=value;
    $('stop').disabled=!value; shadow.querySelectorAll('#list input').forEach(n=>n.disabled=value);
  }
  $('stop').onclick=()=>controller?.abort();
  // Escape works even while the extension panel is hidden for a screenshot.
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && busy)controller?.abort();},true);
  $('auto').onclick=async()=>{
    if(busy)return;const ids=selectedIDs();setBusy(true);
    try{for(const id of ids)await processMessage(id,true);status('所选消息已自动处理并缓存。可以预览或导出。');}
    catch(e){status(e.message);}finally{setBusy(false);renderList();}
  };
  $('collect').onclick=async()=>{
    if(busy)return;setBusy(true);collection={complete:false,startedAt:new Date().toISOString()};
    try {
      const initial=scan();if(!initial.length)throw Error('未找到对话消息');
      const scroller=auto.scrollerFor(initial[0].el);
      const result=await auto.collect({signal:controller.signal,adapter:{position:()=>auto.position(scroller),range:()=>auto.range(scroller),height:()=>scroller.clientHeight,move:top=>auto.move(scroller,top),settle:()=>auto.pause(650),scan},process:m=>processMessage(m.id,true),progress:info=>status(`正在收集整段对话，已缓存 ${info.messages} 条。按 Esc 可停止并保留已完成部分。`)});
      collection={...collection,...result,finishedAt:new Date().toISOString()};
      status(result.complete?`已从页面顶部遍历至底部，共缓存 ${result.messages} 条消息。请预览并检查文末缺失提示。`:'已到遍历上限，保留已完成部分；未确认覆盖整段历史。');
    }catch(e){collection.error=e.message;status(e.message);}finally{
      // A stopped traversal must remain exportable without revisiting unloaded, unfinished rows.
      for(const record of store.values())if(record.md===undefined)unchecked.add(record.id);
      setBusy(false);renderList();
    }
  };
  let target = null, rect = null, locked = false;
  const main = shadow.querySelector('main');
  function belongs(el) { return messages.some(m => m.roots.some(r => r === el || r.contains(el))); }
  function outline() {
    if (!rect) return;
    Object.assign($('outline').style, {left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});
    $('coords').replaceChildren();
    for (const key of ['x','y','width','height']) {
      const label = document.createElement('label'); label.style.display = 'inline'; label.textContent = key + ' ';
      const input = document.createElement('input'); input.type = 'number'; input.value = Math.round(rect[key]);
      input.onchange = () => { rect[key] = Number(input.value); Object.assign($('outline').style, {left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'}); };
      label.append(input); $('coords').append(label);
    }
  }
  function choose(el) { target = el; const r = el.getBoundingClientRect(); rect = {x:r.x,y:r.y,width:r.width,height:r.height}; outline(); }
  function endPick() { $('picker').style.display = 'none'; main.style.display = ''; }
  $('pick').onclick = () => { locked = false; target = null; rect = null; $('outline').style.width = '0'; main.style.display = 'none'; $('picker').style.display = 'block'; $('pickStatus').textContent = ''; };
  $('picker').onpointermove = e => {
    if (locked || e.composedPath().includes($('tools'))) return;
    host.style.pointerEvents = 'none'; let el = document.elementFromPoint(e.clientX,e.clientY); host.style.pointerEvents = '';
    if (!el || !belongs(el)) return;
    el = el.closest('iframe,canvas,svg,img,pre,table,p,[data-d-component="box"],section,div') || el;
    if (belongs(el)) choose(el);
  };
  $('picker').onclick = e => { if (!e.composedPath().includes($('tools')) && target) locked = true; };
  $('parent').onclick = () => { if (target?.parentElement && belongs(target.parentElement)) { choose(target.parentElement); locked = true; } };
  $('child').onclick = () => { const child = target?.firstElementChild; if (child) { choose(child); locked = true; } };
  $('unlock').onclick = () => locked = false; $('cancel').onclick = endPick;
  $('capture').onclick = async () => {
    if (!target || !rect || busy) return;
    if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > innerWidth || rect.y + rect.height > innerHeight) { $('pickStatus').textContent = '区域必须完整位于窗口内，请滚动、缩小范围或调整浏览器缩放。'; return; }
    busy = true; const selectedTarget = target, bounds = {...rect}, before = target.getBoundingClientRect();
    host.hidden = true;
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const data = await captureData();
      const after = selectedTarget.getBoundingClientRect();
      if (!selectedTarget.isConnected || ['x','y','width','height'].some(k => Math.abs(before[k]-after[k]) > 1)) throw Error('截图期间内容发生移动，请重试');
      const img = new Image(); img.src = data; await img.decode();
      const sx = img.width / innerWidth, sy = img.height / innerHeight, canvas = document.createElement('canvas');
      canvas.width = Math.round(bounds.width*sx); canvas.height = Math.round(bounds.height*sy);
      canvas.getContext('2d').drawImage(img, bounds.x*sx,bounds.y*sy,bounds.width*sx,bounds.height*sy,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw Error('截图编码失败');
      const path = `assets/capture-${Date.now()}.png`, m = messages.find(m => m.roots.some(r => r === selectedTarget || r.contains(selectedTarget)));
      for (const el of replacements.keys()) if (el.contains(selectedTarget) || selectedTarget.contains(el)) replacements.delete(el);
      replacements.set(selectedTarget, {path,blob,meta:{path,method:'viewport-screenshot',messageId:m.id,bounds,capturedAt:new Date().toISOString()}});
      const cached=store.records.get(m.id); if(cached){delete cached.md;delete cached.assets;}
      endPick(); status('截图已保存到内存，导出时将替换所选内容块。请在刷新页面前导出。');
    } catch(e) { $('pickStatus').textContent = e.message; }
    finally { host.hidden = false; busy = false; }
  };
  refresh();
})();
