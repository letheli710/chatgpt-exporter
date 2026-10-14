(() => {
  if (globalThis.__fastTextPanel) {globalThis.__fastTextPanel.hidden = !globalThis.__fastTextPanel.hidden; return;}
  const api = globalThis.FastTextExporter;
  const host = document.createElement('div');host.dataset.archiveOwned = 'fast-text';
  globalThis.__fastTextPanel = host;document.documentElement.append(host);
  const ui = host.attachShadow({mode:'open'});
  ui.innerHTML = `<style>:host{all:initial;position:fixed;right:18px;top:18px;z-index:2147483647;font:14px/1.5 system-ui;color:#172330}main{width:390px;background:#fff;border:1px solid #aaa;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0003}h2{margin:0 0 8px;font-size:19px}button{padding:8px;margin:3px;border:1px solid #aab;border-radius:6px;cursor:pointer}#list{max-height:40vh;overflow:auto}label{display:block;padding:7px;border-bottom:1px solid #ddd}#status{white-space:pre-wrap;margin:10px 0}textarea{width:100%;height:180px}#download{background:#155c54;color:white}</style><main><h2>Fast Speed Exporter · 0.5.0</h2><p>直接读取完整对话正文，选择消息后导出 Markdown。</p><button id="reload">重新读取</button><button id="all">全选</button><button id="none">清空</button><button id="close">收起</button><div id="status" role="status"></div><div id="list"></div><button id="preview">预览</button><button id="download">下载 Markdown</button><textarea id="output" hidden readonly aria-label="Markdown 预览"></textarea></main>`;
  const $ = id => ui.getElementById(id);
  let state = null, loading = false, generation = 0, controller;
  const route = () => location.origin + location.pathname;
  const lastNode = () => [...document.querySelectorAll('[data-message-id]')].filter(n => !n.closest('[hidden],[aria-hidden="true"]')).at(-1);
  const lastMessage = () => lastNode()?.getAttribute('data-message-id');
  const streaming = () => document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="停止生成"]');
  function busy(value) {loading=value;for(const id of ['reload','all','none','preview','download'])$(id).disabled=value;}
  function assertCurrent() {
    if (!state || state.url !== route()) throw Error('已切换对话，请重新读取');
    if (streaming()) throw Error('回复仍在生成，请完成后重新读取');
    const leaf = lastMessage();
    if (leaf && state.leaf && leaf !== state.leaf) throw Error('页面消息或回答分支已变化，请重新读取');
    if (leaf && leaf === state.leaf && lastNode()?.textContent !== state.leafText) throw Error('页面正文已变化，请重新读取');
  }
  async function load() {
    controller?.abort();controller=new AbortController();const current=++generation;
    const url=route(), leaf=lastMessage(), id=location.pathname.match(/\/c\/([^/]+)/)?.[1];
    state=null;busy(true);$('list').replaceChildren();$('output').hidden=true;$('status').textContent='正在读取完整正文……';
    const started=performance.now();
    try {
      if(streaming())throw Error('回复仍在生成，请完成后重新读取');
      const result=await api.loadConversation({id,leafId:leaf,fetch:window.fetch.bind(window),signal:controller.signal,onProgress:p=>$('status').textContent=`正在读取历史：${p.messages} 条消息，${p.pages} 页……`});
      if(current!==generation || route()!==url)throw Error('读取期间已切换对话，请重新读取');
      state={...result,url,leaf,leafText:lastNode()?.textContent};
      for(const message of result.messages){const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.checked=true;box.dataset.messageId=message.id;label.append(box,` ${message.role==='user'?'我':'ChatGPT'} · ${message.summary}`);$('list').append(label);}
      $('status').textContent=`已读取 ${result.messages.length} 条正文，耗时 ${((performance.now()-started)/1000).toFixed(2)} 秒。\n${result.warnings.length?`有 ${result.warnings.length} 处非文字内容未包含；本版本仅导出文字。`:''}`;
    } catch(e) {if(current===generation)$('status').textContent=e.message;}
    finally {if(current===generation)busy(false);}
  }
  function build() {assertCurrent();return api.markdown(state,[...ui.querySelectorAll('#list input:checked')].map(n=>n.dataset.messageId),state.url);}
  function run(download) {try {const md=build();$('output').value=md;$('output').hidden=false;if(download){const blob=new Blob([md],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${state.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,100)||'ChatGPT'}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}}catch(e){$('status').textContent=e.message;}}
  $('reload').onclick=load;$('preview').onclick=()=>run(false);$('download').onclick=()=>run(true);
  $('all').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=true);
  $('none').onclick=()=>ui.querySelectorAll('#list input').forEach(n=>n.checked=false);
  $('close').onclick=()=>host.hidden=true;
  load();
})();
