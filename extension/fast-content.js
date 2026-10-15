(() => {
  const version='0.6.3';
  if(globalThis.__fastTextPanel?.dataset.version===version){globalThis.__fastTextPanel.hidden=!globalThis.__fastTextPanel.hidden;return;}
  globalThis.__fastTextPanel?.remove();
  // Reloading the extension resets its isolated world but can leave the old
  // panel DOM behind. Remove it before creating the current panel.
  document.querySelectorAll('[data-archive-owned="fast-text"]').forEach(n=>n.remove());
  const api=globalThis.FastTextExporter,visual=globalThis.ChatExportFastVisual,auto=globalThis.ChatExportAutomation;
  const host=document.createElement('div');host.dataset.archiveOwned='fast-text';host.dataset.version=version;
  globalThis.__fastTextPanel=host;document.documentElement.append(host);
  const ui=host.attachShadow({mode:'open'});
  ui.innerHTML=`<style>:host{all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font:14px/1.5 system-ui;color:#172330}main{width:400px;max-height:90vh;overflow:auto;background:#fff;border:1px solid #aab;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0003}h2{margin:0 0 8px;font-size:19px}button{padding:8px;margin:3px;border:1px solid #aab;border-radius:6px;cursor:pointer}button:disabled{opacity:.5}#list{max-height:34vh;overflow:auto}label{display:block;padding:7px;border-bottom:1px solid #ddd}#status{white-space:pre-wrap;margin:10px 0}textarea{width:100%;height:180px}#archive{background:#155c54;color:white}#picker{display:none;position:fixed;inset:0;cursor:crosshair}#outline{position:fixed;border:3px solid #13ba98;background:#13ba9819;pointer-events:none}#tools{position:fixed;left:12px;top:12px;background:white;border:1px solid #aaa;padding:12px;max-width:520px;cursor:default}</style><main><h2>Fast Speed Exporter · Swift Archive</h2><p>正文直接读取；交互内容补充当前文字和截图。截图期间请保持标签页在前台。</p><button id="reload">重新读取</button><button id="all">全选</button><button id="none">清空</button><button id="close">收起</button><div id="status" role="status"></div><div id="list"></div><label><input id="saveAs" type="checkbox"> 下载时选择保存位置</label><button id="preview">预览文字</button><button id="download">下载 Markdown</button><button id="archive">下载文字与截图 ZIP</button><button id="pick">选框补截图</button><button id="stop" disabled>停止</button><textarea id="output" hidden readonly aria-label="Markdown 预览"></textarea></main><div id="picker"><div id="outline"></div><div id="tools">移动到内容块，点击锁定；可逐层扩大至本轮消息。<br><button id="parent">扩大到父级</button><button id="child">缩小到子级</button><button id="unlock">重新选择</button><button id="capture">保存所选截图</button><button id="cancel">取消</button><div id="pickStatus"></div></div></div>`;
  const $=id=>ui.getElementById(id),route=()=>location.origin+location.pathname;
  let state=null,busyFlag=false,generation=0,controller,lastCapture=0,manualSequence=0;
  const cache=new Map(),cacheSignatures=new Map(),manual=new Map();
  const lastMessage=()=>[...document.querySelectorAll('[data-message-id]')].filter(n=>!n.closest('[hidden],[aria-hidden="true"]')).at(-1)?.getAttribute('data-message-id');
  const streaming=()=>document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  function busy(value){busyFlag=value;for(const id of ['reload','all','none','preview','download','archive','pick'])$(id).disabled=value;$('stop').disabled=!value;ui.querySelectorAll('#list input').forEach(n=>n.disabled=value);}
  function assertCurrent(){if(!state||state.url!==route())throw Error('已切换对话，请重新读取');if(streaming())throw Error('回复仍在生成，请完成后重新读取');const leaf=lastMessage();if(leaf&&state.leaf&&leaf!==state.leaf&&!state.messages.some(m=>m.id===leaf))throw Error('消息或分支已变化，请重新读取');controller?.signal.throwIfAborted();}
  function ids(){return [...ui.querySelectorAll('#list input:checked')].map(n=>n.dataset.messageId);}
  async function load(){controller?.abort();controller=new AbortController();const current=++generation,url=route(),leaf=lastMessage();state=null;cache.clear();cacheSignatures.clear();manual.clear();busy(true);$('list').replaceChildren();$('output').hidden=true;$('status').textContent='正在读取完整正文……';const start=performance.now();try{
    if(streaming())throw Error('回复仍在生成，请完成后重新读取');
    const data=await api.loadConversation({id:location.pathname.match(/\/c\/([^/]+)/)?.[1],leafId:leaf,fetch:window.fetch.bind(window),signal:controller.signal,onProgress:p=>$('status').textContent=`正在读取历史 ${p.messages} 条，${p.pages} 页……`});
    if(current!==generation||url!==route())throw Error('读取期间切换了对话，请重新读取');
    state={...data,url,leaf,timings:{readMs:performance.now()-start}};
    for(const m of data.messages){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=true;box.dataset.messageId=m.id;label.append(box,` ${m.role==='user'?'我':'ChatGPT'} · ${m.summary}`);$('list').append(label);}
    $('status').textContent=`已读取 ${data.messages.length} 条正文，耗时 ${(state.timings.readMs/1000).toFixed(2)} 秒。预览可补齐交互文字，ZIP 可自动保存画面。`;
  }catch(e){if(current===generation)$('status').textContent=e.message;}finally{if(current===generation)busy(false);}}
  async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);return response;}
  async function captureData(){assertCurrent();await auto.pause(Math.max(0,720-(Date.now()-lastCapture)));controller.signal.throwIfAborted();const response=await send({type:'archive:capture'});lastCapture=Date.now();return response.data;}
  const captureOptions=()=>({doc:document,signal:controller.signal,capture:captureData,hide:()=>host.hidden=true,show:()=>host.hidden=false});
  async function build(screenshot){assertCurrent();const selected=ids();if(!selected.length)throw Error('请至少选择一条消息');const started=performance.now(),messages=[],assets=[],warnings=[],completed=new Set();
    const prepare=async()=>{for(const original of state.messages){if(!selected.includes(original.id))continue;assertCurrent();let result=cache.get(original.id);const shots=manual.get(original.id)||[];
      const requiresVisual=visual&&(original.needsUI||original.needsTableUI||(screenshot&&original.needsAssets)||visual.hasUI?.(original,document));
      const signature=requiresVisual?visual.signature?.(original,document):null;
      if(result&&signature!==cacheSignatures.get(original.id)){cache.delete(original.id);result=null;}
      if(requiresVisual&&(!result||(screenshot&&!result.captureComplete&&!shots.length))){
        $('status').textContent=`正在补齐：${original.summary}`;
        result=await visual.enrich(original,{...captureOptions(),messages:state.messages,screenshot:screenshot&&!shots.length,onProgress:p=>$('status').textContent=p.phase==='locate-ui'?'正在定位并加载交互界面……':p.phase==='settle-ui'?'正在等待交互界面加载稳定……':`正在${p.phase==='screenshot'?'截图':'补齐文字'}，内容块 ${p.block}/${p.total}……`});
        assertCurrent();cache.set(original.id,result);cacheSignatures.set(original.id,visual.signature?.(original,document));
      }
      let md=(!screenshot && result?.textMd) || result?.md || original.md;
      if(!screenshot)md=md.replace(/!\[[^\]]*\]\(assets\/[^)]+\)/g,'');
      if(result){if(screenshot)assets.push(...result.assets);warnings.push(...result.warnings);if(result.textSupplemented&&(!screenshot||result.captureComplete||shots.length))completed.add(original.id);}
      if(screenshot)for(const shot of shots){md+=`\n\n![手动选择内容的当前画面](${shot.path})\n`;assets.push(shot);}
      messages.push({...original,md});
    }};
    if(visual?.withScrollRestore)await visual.withScrollRestore(document,prepare);else await prepare();
    const data={...state,messages,warnings:[...new Set([...state.warnings.filter(w=>selected.some(id=>w.startsWith(`${id}:`))&&![...completed].some(id=>w.startsWith(`${id}:`))),...warnings])]};
    const md=api.markdown(data,selected,state.url);state.timings.prepareMs=performance.now()-started;
    return {md,assets,warnings:data.warnings,messages:selected};
  }
  function filename(ext){return `${state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90)||'ChatGPT'}-swift-0.6.3.${ext}`;}
  async function run(mode){if(busyFlag)return;controller=new AbortController();busy(true);const started=performance.now();try{
    const result=await build(mode==='zip');$('output').value=result.md;$('output').hidden=false;
    if(mode!=='preview'){let blob;if(mode==='zip'){
      const zip=new JSZip();zip.file('conversation.md',result.md);for(const asset of result.assets)zip.file(asset.path,asset.blob);
      const manifest={version,source:state.url,messages:result.messages,warnings:result.warnings,timings:{...state.timings,exportPrepareMs:performance.now()-started},assets:result.assets.map(({path,messageId,width,height,tiles,kind})=>({path,messageId,width,height,tiles,kind})),exportedAt:new Date().toISOString()};
      zip.file('manifest.json',JSON.stringify(manifest,null,2));blob=await zip.generateAsync({type:'blob'});
    }else blob=new Blob([result.md],{type:'text/markdown;charset=utf-8'});
    assertCurrent();const url=URL.createObjectURL(blob);try{await send({type:'archive:download',url,filename:filename(mode==='zip'?'zip':'md'),saveAs:$('saveAs').checked});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}}
    $('status').textContent=`读取 ${(state.timings.readMs/1000).toFixed(2)} 秒；本次${mode==='preview'?'预览':'导出'}处理 ${((performance.now()-started)/1000).toFixed(2)} 秒。保存 ${result.assets.length} 张截图。${result.warnings.length?`\n还有 ${result.warnings.length} 处提示，请检查导出文末。`:''}`;
  }catch(e){$('status').textContent=e.message;}finally{host.hidden=false;busy(false);}}
  $('reload').onclick=load;$('preview').onclick=()=>run('preview');$('download').onclick=()=>run('md');$('archive').onclick=()=>run('zip');
  $('all').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=true);$('none').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=false);$('close').onclick=()=>host.hidden=true;
  $('stop').onclick=()=>controller?.abort();document.addEventListener('keydown',e=>{if(e.key==='Escape'&&busyFlag)controller?.abort();});
  let target=null,locked=false;
  function choose(el){target=el;const r=el.getBoundingClientRect();Object.assign($('outline').style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});$('pickStatus').textContent='已选内容块，可扩大到本轮消息后保存跨屏截图。';}
  function endPick(){$('picker').style.display='none';ui.querySelector('main').style.display='';}
  $('pick').onclick=()=>{try{assertCurrent();if(!visual||!auto)throw Error('请重新加载扩展以启用截图');locked=false;target=null;$('outline').style.width='0';ui.querySelector('main').style.display='none';$('picker').style.display='block';$('pickStatus').textContent='移动并点击需要保存的内容。';}catch(e){$('status').textContent=e.message;}};
  $('picker').onpointermove=e=>{if(locked||e.composedPath().includes($('tools')))return;host.style.pointerEvents='none';const el=document.elementFromPoint(e.clientX,e.clientY);host.style.pointerEvents='';if(el&&visual.boundaryOf(el,document))choose(el.closest('iframe,canvas,svg,img,pre,table,p,[data-d-component="box"],section,div')||el);};
  $('picker').onclick=e=>{if(!e.composedPath().includes($('tools'))&&target)locked=true;};
  $('parent').onclick=()=>{if(target){choose(visual.parentBoundary(target,document));locked=true;}};
  $('child').onclick=()=>{if(target?.firstElementChild){choose(target.firstElementChild);locked=true;}};$('unlock').onclick=()=>locked=false;$('cancel').onclick=endPick;
  $('capture').onclick=async()=>{if(!target||busyFlag)return;controller=new AbortController();busy(true);const started=performance.now();try{
    assertCurrent();const dom=visual.boundaryOf(target,document),message=state.messages.find(m=>dom.id.split(/\s+/).includes(m.id));if(!message)throw Error('区域无法对应当前分支消息');
    const shot=await visual.captureTarget(target,message,{...captureOptions(),path:`assets/manual-${++manualSequence}.png`});assertCurrent();
    const entries=manual.get(message.id)||[];entries.push(shot);manual.set(message.id,entries);cache.delete(message.id);
    endPick();$('status').textContent=`所选内容截图已保存，耗时 ${((performance.now()-started)/1000).toFixed(2)} 秒。下载 ZIP 时会放入所属消息。`;
  }catch(e){$('pickStatus').textContent=e.message;}finally{host.hidden=false;busy(false);}};
  load();
})();
