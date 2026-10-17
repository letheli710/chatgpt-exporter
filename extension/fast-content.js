(() => {
  const version='0.8.14';
  if(globalThis.__fastTextPanel?.dataset.version===version){globalThis.__fastTextPanel.hidden=!globalThis.__fastTextPanel.hidden;return;}
  globalThis.__fastTextPanel?.remove();
  // Reloading the extension resets its isolated world but can leave the old
  // panel DOM behind. Remove it before creating the current panel.
  document.querySelectorAll('[data-archive-owned="fast-text"]').forEach(n=>n.remove());
  const dilRender=globalThis.ChatExportDilRender,api=globalThis.FastTextExporter;
  const host=document.createElement('div');host.dataset.archiveOwned='fast-text';host.dataset.version=version;
  globalThis.__fastTextPanel=host;document.documentElement.append(host);
  const ui=host.attachShadow({mode:'open'});
  ui.innerHTML=`<style>:host{all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font:14px/1.5 system-ui;color:#172330}main{width:400px;max-height:90vh;overflow:auto;background:#fff;border:1px solid #aab;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0003}h2{margin:0 0 8px;font-size:19px}button{padding:8px;margin:3px;border:1px solid #aab;border-radius:6px;cursor:pointer}button:disabled{opacity:.5}#list{max-height:34vh;overflow:auto}label{display:block;padding:7px;border-bottom:1px solid #ddd}#status{white-space:pre-wrap;margin:10px 0}textarea{width:100%;height:180px}#archive{background:#155c54;color:white}</style><main><h2>Fast Speed Exporter · Swift Archive</h2><p>正文、原图与交互界面数据直接从会话接口读取，不滚动、不截图。</p><button id="reload">重新读取</button><button id="all">全选</button><button id="none">清空</button><button id="close">收起</button><div id="status" role="status"></div><div id="list"></div><label><input id="saveAs" type="checkbox"> 下载时选择保存位置</label><button id="preview">预览文字</button><button id="download">下载 Markdown</button><button id="archive">下载 ZIP（原图 + 界面数据）</button><button id="raw">调试：导出原始 JSON</button><button id="stop" disabled>停止</button><textarea id="output" hidden readonly aria-label="Markdown 预览"></textarea></main>`;
  const $=id=>ui.getElementById(id),route=()=>location.origin+location.pathname;
  let state=null,busyFlag=false,generation=0,controller;
  const lastMessage=()=>[...document.querySelectorAll('[data-message-id]')].filter(n=>!n.closest('[hidden],[aria-hidden="true"]')).at(-1)?.getAttribute('data-message-id');
  const streaming=()=>document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  function busy(value){busyFlag=value;for(const id of ['reload','all','none','preview','download','archive','raw'])$(id).disabled=value;$('stop').disabled=!value;ui.querySelectorAll('#list input').forEach(n=>n.disabled=value);}
  function assertCurrent(){if(!state||state.url!==route())throw Error('已切换对话，请重新读取');if(streaming())throw Error('回复仍在生成，请完成后重新读取');const leaf=lastMessage();if(leaf&&state.leaf&&leaf!==state.leaf&&!state.messages.some(m=>m.id===leaf))throw Error('消息或分支已变化，请重新读取');controller?.signal.throwIfAborted();}
  function ids(){return [...ui.querySelectorAll('#list input:checked')].map(n=>n.dataset.messageId);}
  async function load(){controller?.abort();controller=new AbortController();const current=++generation,url=route(),leaf=lastMessage();state=null;busy(true);$('list').replaceChildren();$('output').hidden=true;$('status').textContent='正在读取完整正文……';const start=performance.now(),sandbox=startSandbox();try{
    if(streaming())throw Error('回复仍在生成，请完成后重新读取');
    const data=await api.loadConversation({id:location.pathname.match(/\/c\/([^/]+)/)?.[1],leafId:leaf,fetch:window.fetch.bind(window),signal:controller.signal,onProgress:p=>$('status').textContent=`正在读取历史 ${p.messages} 条，${p.pages} 页……`});
    if(current!==generation||url!==route())throw Error('读取期间切换了对话，请重新读取');
    state={...data,url,leaf,timings:{readMs:performance.now()-start}};
    state.timings.render=await renderStatic(data.messages,sandbox);state.timings.renderMs=performance.now()-start-state.timings.readMs;
    for(const m of data.messages){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=true;box.dataset.messageId=m.id;label.append(box,` ${m.role==='user'?'我':'ChatGPT'} · ${m.summary}`);$('list').append(label);}
    $('status').textContent=`已读取 ${data.messages.length} 条正文，耗时 ${(state.timings.readMs/1000).toFixed(2)} 秒。${staleNotice()}`;
  }catch(e){if(current===generation)$('status').textContent=e.message;}finally{sandbox?.client.close();if(current===generation)busy(false);}}
  // Created before the conversation is read so the sandbox page, fonts and
  // canvas are ready by the time the cards are drawn.
  function startSandbox(){if(!dilRender||globalThis.ChatExportDilEvaluate)return null;try{
    const client=dilRender.sandboxClient(document,chrome.runtime.getURL('sandbox.html'));
    return {client,warm:client.warmup().catch(e=>({error:e.message}))};
  }catch{return null;}}
  // Executes each message's compiled UI program in the sandbox page at its
  // default state, recovering text that fallbackMarkdown omits ({#each}, values).
  async function renderStatic(messages,sandbox){const started=performance.now(),targets=messages.filter(m=>m.dil?.code),round=v=>Math.round(v);
    if(!targets.length||!dilRender)return {uiMessages:targets.length};
    $('status').textContent=`正在渲染 ${targets.length} 个交互界面……`;
    const client=sandbox?.client,evaluate=globalThis.ChatExportDilEvaluate||client,snapshot=globalThis.ChatExportDilSnapshot||client?.snapshot,preview=globalThis.ChatExportAppBlockPreview||client?.appblock,toMd=tree=>dilRender.toMarkdown(tree,{widget:id=>`\u0000APPBLOCK:${id}\u0000`});
    // All messages go to the sandbox at once; cards within a message are also drawn in parallel.
    await Promise.all(targets.map(async m=>{const sent=performance.now();
      // Widgets (code blocks, charts) resolve from the message's content references.
      const dil={...m.dil,contentReferences:m.contentReferences};
      // Cards are drawn to PNG in the sandbox; if that fails, text alone is kept.
      const cards=(async()=>{try{const result=await snapshot(dil);m.segments=result.segments.map(s=>({kind:s.kind,md:toMd(s.tree),png:s.png,width:s.width,height:s.height,error:s.error}));m.staticMd=m.segments.map(s=>s.md).filter(Boolean).join('\n\n');m.renderTimings={...result.timings,roundTripMs:round(performance.now()-sent)};}
      catch{try{m.staticMd=toMd(await evaluate(dil));}catch(e){m.renderError=e.message;}}})();
      // Each AppBlock runs briefly in its own sandboxed frame and is drawn to a preview PNG.
      const shots=Promise.all((preview?dilRender.appBlocks(m.dil,m.contentReferences):[]).map(async b=>{const t=performance.now();try{return [b.invocationId,{...await preview(b),ms:round(performance.now()-t)}];}catch(e){return [b.invocationId,{error:e.message,ms:round(performance.now()-t)}];}}));
      const [,previews]=await Promise.all([cards,shots]);m.appPreviews=Object.fromEntries(previews);
      if(previews.length&&m.renderTimings)m.renderTimings.appBlocks=previews.map(([id,p])=>({id,ms:p.ms,...(p.error?{error:p.error}:{width:p.width,height:p.height})}));
    }));
    return {uiMessages:targets.length,wallMs:round(performance.now()-started),sandboxLoadMs:client?.stats.loadMs??null,warmup:sandbox?await sandbox.warm:null,
      messages:targets.map(m=>({id:m.id,...(m.renderTimings||{}),...(m.renderError?{error:m.renderError}:{})}))};}
  const safeName=id=>String(id).replace(/[^\w-]/g,'_');
  // Each card becomes an image, with its text folded underneath (searchable, not duplicated on screen).
  function cardMarkdown(m,assets,warnings){let n=0;return m.segments.map(s=>{
    if(s.kind!=='card'||!s.png){if(s.error)warnings.push(`${m.id}: 卡片图像生成失败（${s.error}），已保留文字`);return s.md;}
    const path=`assets/card-${safeName(m.id)}-${++n}.png`;
    assets.push({path,blob:new Blob([s.png],{type:'image/png'}),messageId:m.id,width:s.width,height:s.height,kind:'card-image'});
    const text=s.md.trim()?`\n\n> [!note]- 卡片文字\n${s.md.split('\n').map(l=>l?`> ${l}`:'>').join('\n')}`:'';
    return `![交互卡片](${path})${text}`;
  }).filter(Boolean).join('\n\n');}
  const blocksOf=m=>dilRender&&m.dil?dilRender.appBlocks(m.dil,m.contentReferences):[];
  const widgetToken=/\u0000APPBLOCK:([^\u0000]*)\u0000/g,sandboxLink=/\]\((sandbox:\/[^)\s]+)\)/g;
  // The panel is injected from the files on disk at every click, but the background worker and
  // permissions only change when the extension is reloaded; a version mismatch means it was not.
  function staleNotice(){let loaded=null;try{loaded=chrome.runtime.getManifest?.().version;}catch{}return loaded&&loaded!==version?`\n⚠ 插件后台仍是 ${loaded}，面板是 ${version}：请在 chrome://extensions 点击本插件的“重新加载”，否则部分功能（如搜索图片下载）不可用。`:'';}
  // Search images (images.openai.com) are fetched by the background worker, which may cross origins.
  async function fetchImage(url){const r=await send({type:'archive:image',url});const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));return new Blob([bytes],{type:r.type});}
  async function send(message){const response=await chrome.runtime.sendMessage(message);if(response?.error)throw Error(response.error);return response;}
  // Recorded in the manifest so an export shows whether the tab went to the background.
  let hiddenDuringExport=false;document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')hiddenDuringExport=true;});
  async function build(zip){assertCurrent();const selected=ids();if(!selected.length)throw Error('请至少选择一条消息');hiddenDuringExport=document.visibilityState==='hidden';const started=performance.now(),messages=[],assets=[],warnings=[];
    for(const original of state.messages){if(!selected.includes(original.id))continue;
      const md=original.staticMd?(zip&&original.segments?cardMarkdown(original,assets,warnings):original.staticMd):original.md;
      if(original.dil?.code&&!original.staticMd&&original.renderError)warnings.push(`${original.id}: 交互界面静态渲染失败（${original.renderError}），已使用官方降级文字`);
      messages.push({...original,md:md.replace(/!\[[^\]]*\]\(assets\/(?!card-)[^)]+\)/g,'')});
    }
    if(zip)await attachData(messages,assets,warnings);
    else for(const m of messages)m.md=m.md.replace(/!\[[^\]]*\]\(asset:[\w-]+\)/g,'〔图片：下载 ZIP 可获取原图〕').replace(/\[([^\]]*)\]\(sandbox:\/[^)\s]+\)/g,'$1（代码生成的文件：下载 ZIP 可获取）').replace(widgetToken,(_,id)=>`〔嵌入应用：${blocksOf(m).find(b=>b.invocationId===id)?.title||id}（下载 ZIP 可获取独立 HTML）〕`);
    const data={...state,messages,warnings:[...new Set([...state.warnings.filter(w=>selected.some(id=>w.startsWith(`${id}:`))),...warnings])]};
    const md=api.markdown(data,selected,state.url);state.timings.prepareMs=performance.now()-started;
    return {md,assets,warnings:data.warnings,messages:selected};
  }
  // Data-first archive: original images via the files API and Intelligent UI
  // data as stored on the message, all in parallel and without the page.
  async function attachData(messages,assets,warnings){
    const signal=controller.signal,request=window.fetch.bind(window),safe=id=>String(id).replace(/[^\w-]/g,'_');
    const fileIds=messages.flatMap(m=>(m.images||[]).map(i=>i.fileId));
    if(fileIds.length)$('status').textContent=`正在下载 ${fileIds.length} 张原图……`;
    const conversationId=location.pathname.match(/\/c\/([^/]+)/)?.[1];
    // Files the code interpreter wrote, linked as sandbox:/mnt/data/... in the answer.
    const sandboxItems=conversationId?messages.flatMap(m=>[...new Set([...m.md.matchAll(sandboxLink)].map(x=>x[1]))].map(link=>({messageId:m.id,link,path:decodeURIComponent(link.slice(8))}))):[];
    const [files,uiData,codeFiles]=await Promise.all([
      api.downloadFiles({ids:fileIds,conversationId,fetch:request,signal,onProgress:p=>$('status').textContent=`正在下载原图 ${p.done}/${p.total}……`}),
      Promise.all(messages.filter(m=>m.dil).map(async m=>({m,images:await api.downloadUrls({urls:api.dilImageUrls(m.dil),fetch:request,fetchImage,signal,prefix:`assets/ui-${safe(m.id)}-`})}))),
      api.downloadSandboxFiles({items:sandboxItems,conversationId,fetch:request,signal})
    ]);
    for(const f of codeFiles){const m=messages.find(x=>x.id===f.messageId),item=sandboxItems.find(x=>x.messageId===f.messageId&&x.path===f.path);
      if(f.blob)assets.push({path:f.localPath,blob:f.blob,messageId:f.messageId,kind:'code-file'});else warnings.push(`${f.messageId}: 代码文件 ${f.path} 下载失败（${f.error}），已保留原链接`);
      if(f.blob)m.md=m.md.split(`](${item.link})`).join(`](${f.localPath})`);}
    const byId=new Map(files.map(f=>[f.fileId,f]));
    for(const f of files)if(f.blob)assets.push({path:f.path,blob:f.blob,messageId:messages.find(m=>(m.images||[]).some(i=>i.fileId===f.fileId))?.id,kind:'original-image'});
    for(const m of messages)m.md=m.md.replace(/!\[([^\]]*)\]\(asset:([\w-]+)\)/g,(_,alt,id)=>{const f=byId.get(id);if(f?.blob)return `![${alt}](${f.path})`;warnings.push(`${m.id}: 原图 ${id} 下载失败（${f?.error||'未知错误'}）`);return `〔原图 ${id} 下载失败〕`;});
    for(const {m,images} of uiData){
      const path=`ui/msg-${safe(m.id)}.json`,localAssets={};
      for(const image of images){if(image.blob){localAssets[image.url]=image.path;assets.push({path:image.path,blob:image.blob,messageId:m.id,kind:'ui-image'});m.md=m.md.split(`](${image.url})`).join(`](${image.path})`);}else warnings.push(`${m.id}: 界面图片未下载（${image.error}），已保留原地址`);}
      const blocks=blocksOf(m).map(b=>({...b,path:`ui/appblock-${safe(m.id)}-${safe(b.id)}.html`})),linked=new Set();
      for(const b of blocks)assets.push({path:b.path,blob:new Blob([dilRender.standaloneHtml(b)],{type:'text/html'}),messageId:m.id,kind:'appblock'});
      // The preview image goes above the link; inside a folded card note each new line keeps the quote prefix.
      m.md=m.md.replace(/^([> ]*)(.*?)\u0000APPBLOCK:([^\u0000]*)\u0000/gm,(_,quote,before,id)=>{const b=blocks.find(x=>x.invocationId===id);if(!b)return `${quote}${before}〔嵌入应用 ${id} 未找到〕`;linked.add(b.path);
        const shot=m.appPreviews?.[id],lines=[];
        if(shot?.png){const png=b.path.replace(/^ui\//,'assets/').replace(/\.html$/,'.png');assets.push({path:png,blob:new Blob([shot.png],{type:'image/png'}),messageId:m.id,width:shot.width,height:shot.height,kind:'appblock-preview'});lines.push(`![嵌入应用预览：${b.title}](${png})`,'');}
        else if(shot?.error)warnings.push(`${m.id}: 嵌入应用「${b.title}」预览未生成（${shot.error}），已保留独立 HTML`);
        lines.push(`> [!chatgpt-appblock] ${b.title}：[${b.path}](${b.path})`);
        return `${quote}${before}${lines.join(`\n${quote}`)}`;});
      // AppBlocks hidden in the default state (e.g. behind a checkbox) are still listed.
      const hidden=blocks.filter(b=>!linked.has(b.path)).map(b=>`\n> - 默认状态未显示的嵌入应用「${b.title}」：[${b.path}](${b.path})`).join('');
      const record={messageId:m.id,format:'model_dil_v2',source:m.dilSource,staticMarkdown:m.staticMd??null,renderError:m.renderError??null,appBlocks:blocks.map(({id,invocationId,title,path})=>({id,invocationId,title,path})),localAssets,dil:m.dil,contentReferences:m.contentReferences};
      assets.push({path,blob:new Blob([JSON.stringify(record,null,2)],{type:'application/json'}),messageId:m.id,kind:'ui-data'});
      // Replies that compiled to plain prose need no pointer in the note; their JSON is still saved.
      if(m.segments?.some(s=>s.kind==='card')||blocks.length||!m.staticMd)m.md+=`\n\n> [!chatgpt-ui] 交互界面原始数据：[${path}](${path})${hidden}\n`;
    }
  }
  function filename(ext){return `${state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90)||'ChatGPT'}-swift-${version}.${ext}`;}
  async function run(mode){if(busyFlag)return;controller=new AbortController();busy(true);const started=performance.now();try{
    const result=await build(mode==='zip');$('output').value=result.md;$('output').hidden=false;
    if(mode!=='preview'){let blob;if(mode==='zip'){
      const zip=new JSZip();zip.file('conversation.md',result.md);for(const asset of result.assets)zip.file(asset.path,asset.blob);
      const manifest={version,loadedVersion:(()=>{try{return chrome.runtime.getManifest?.().version??null;}catch{return null;}})(),source:state.url,visibility:{hiddenDuringExport,atEnd:document.visibilityState},messages:result.messages,warnings:result.warnings,timings:{...state.timings,exportPrepareMs:performance.now()-started},assets:result.assets.map(({path,messageId,width,height,tiles,kind})=>({path,messageId,width,height,tiles,kind})),exportedAt:new Date().toISOString()};
      zip.file('manifest.json',JSON.stringify(manifest,null,2));blob=await zip.generateAsync({type:'blob'});
    }else blob=new Blob([result.md],{type:'text/markdown;charset=utf-8'});
    assertCurrent();const url=URL.createObjectURL(blob);try{await send({type:'archive:download',url,filename:filename(mode==='zip'?'zip':'md'),saveAs:$('saveAs').checked});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}}
    $('status').textContent=`读取 ${(state.timings.readMs/1000).toFixed(2)} 秒；本次${mode==='preview'?'预览':'导出'}处理 ${((performance.now()-started)/1000).toFixed(2)} 秒。保存 ${result.assets.filter(a=>a.kind==='original-image').length} 张原图、${result.assets.filter(a=>a.kind==='ui-data').length} 份界面数据、${result.assets.filter(a=>a.kind==='card-image').length} 张卡片图、${result.assets.filter(a=>a.kind==='appblock').length} 个嵌入应用${result.assets.some(a=>a.kind==='appblock-preview')?`（${result.assets.filter(a=>a.kind==='appblock-preview').length} 张预览）`:''}${result.assets.some(a=>a.kind==='code-file')?`、${result.assets.filter(a=>a.kind==='code-file').length} 个代码文件`:''}。${result.warnings.length?`\n还有 ${result.warnings.length} 处提示，请检查导出文末。`:''}`;
  }catch(e){$('status').textContent=e.message;}finally{busy(false);}}
  $('reload').onclick=load;
  // Debug: the unmodified API response, to inspect model_dil_v2 and image fields.
  $('raw').onclick=async()=>{if(busyFlag)return;try{assertCurrent();const url=URL.createObjectURL(new Blob([JSON.stringify(state.raw,null,2)],{type:'application/json'}));try{await send({type:'archive:download',url,filename:filename('raw.json'),saveAs:$('saveAs').checked});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}$('status').textContent='已导出原始会话 JSON（含对话全文，请勿公开分享）。';}catch(e){$('status').textContent=e.message;}};$('preview').onclick=()=>run('preview');$('download').onclick=()=>run('md');$('archive').onclick=()=>run('zip');
  $('all').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=true);$('none').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=false);$('close').onclick=()=>host.hidden=true;
  $('stop').onclick=()=>controller?.abort();document.addEventListener('keydown',e=>{if(e.key==='Escape'&&busyFlag)controller?.abort();});
  load();
})();
