(function(root) {
  'use strict';
  const error = message => { throw Error(message); };
  // Uploaded and generated images point at the files service, e.g.
  // file-service://file-abc or sediment://file_abc.
  const fileIdOf = pointer => typeof pointer === 'string' ? pointer.match(/^(?:file-service|sediment):\/\/([\w-]+)$/)?.[1] || null : null;
  const fence = text => '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
  function textOf(message, warnings) {
    const content = message.content || {};
    const fallback = message.metadata?.model_dil_v2?.fallbackMarkdown;
    if (content.content_type !== 'code' && typeof fallback === 'string' && fallback.trim()) {
      // Restore original code whitespace only when every nonblank code line is
      // identical. A different program in fallback is never guessed/replaced.
      const raw=(content.parts || []).filter(p=>typeof p==='string').join('\n');
      const blocks=[...raw.matchAll(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?=\n|$))/gm)].map(m=>m[0]);
      const sameLines=value=>value.split('\n').filter(line=>line.trim()).join('\n');
      return fallback.replace(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?=\n|$))/gm,block=>blocks.find(original=>sameLines(original)===sameLines(block)) || block);
    }
    if (['user_editable_context','model_editable_context'].includes(content.content_type)) return '';
    const parts = content.parts || (typeof content.text === 'string' ? [content.text] : []);
    const text = parts.map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      const fileId = fileIdOf(part?.asset_pointer);
      if (fileId) return `![图片](asset:${fileId})`;
      warnings.push(`${message.id}: 未导出非文字内容（${part?.content_type || 'unknown'}）`);
      return '';
    }).filter(Boolean).join('\n');
    if (!text && content.content_type && !['text','multimodal_text','code'].includes(content.content_type)) warnings.push(`${message.id}: 内容类型 ${content.content_type} 没有可读取的文字`);
    if (content.content_type === 'code' && text) return `${fence(text)}${/^[\w+-]+$/.test(content.language || '') ? content.language : ''}\n${text}\n${fence(text)}`;
    return text;
  }
  const cell = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/\r?\n/g,'<br>');
  function normalizeText(text) {
    const uiReasons = new Set(); let needsTableUI = false;
    // Never rewrite literals, code examples, or equations while repairing prose.
    const protectedPattern = /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?=\n|$))|(\\\[[\s\S]*?\\\])|(\$\$[\s\S]*?\$\$)|(\\\([\s\S]*?\\\))|(\$(?!\$)[^\n$]+\$)/gm;
    const prose = part => {
      const literals=[];
      part=part.replace(/(`+)([^`\n]*)\1/g,match=>`\u0000INLINE${literals.push(match)-1}\u0000`);
      part = part.replace(/\uE200genui\uE202([\s\S]*?)\uE201/g, (_, json) => {
        uiReasons.add('structured-ui');
        try {
          const payload=JSON.parse(json), chart=payload.charts_widget_v2?.content;
          if (chart && Array.isArray(chart.data) && Array.isArray(chart.series)) {
            const columns=[{dataKey:chart.xKey,label:chart.xKey},...chart.series];
            return `\n\n${chart.meta?.title || '交互图表'}\n\n${chart.meta?.description || ''}\n\n| ${columns.map(c=>cell(c.label||c.dataKey)).join(' | ')} |\n| ${columns.map(()=>'---').join(' | ')} |\n${chart.data.map(row=>`| ${columns.map(c=>cell(row[c.dataKey]) + cell(c.valueSuffix||'')).join(' | ')} |`).join('\n')}\n\n> 此处为交互图表的结构化数据；当前画面需要从页面补充。\n`;
          }
          const lines=[];
          const walk=(value,path)=>{
            if (typeof value==='string' || typeof value==='number' || typeof value==='boolean') lines.push(`${cell(path)}：${cell(value)}`);
            else if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) walk(item,path ? `${path}.${key}` : key);
          };
          walk(payload,'');
          return `\n\n${lines.join('\n\n')}\n\n> 此处为交互内容的结构化文字；当前画面需要从页面补充。\n`;
        } catch {
          return '\n\n> 此处的交互内容无法从结构化数据解析，需要从页面补充文字及截图。\n';
        }
      });
      part = part.replace(/Current (?:selection|value) unavailable\./g, () => {
        uiReasons.add('live-state');return '〔实时状态未包含在接口文字中，需要从页面补充〕';
      });
      part=part.replace(/\uE200([^\uE201]*?)\uE201/g, (_, marker) => {
        uiReasons.add('internal-marker');
        return `〔内部内容标记未展开，需要从页面核对：${cell(marker.split('\uE202')[0])}〕`;
      });
      part=part.replace(/\u0000INLINE(\d+)\u0000/g,(_,index)=>literals[Number(index)]);
      // Only repair actual table rows, leaving inline code elsewhere untouched.
      const lines=part.split('\n');let repaired=false;
      for(let i=0;i<lines.length;i++) {
        if(!/^\s*\|/.test(lines[i]))continue;
        lines[i]=lines[i].replace(/(`+)([^`\n]*\|[^`\n]*)\1/g,(_,ticks,literal)=>{
          repaired=true;needsTableUI=true;uiReasons.add('table-literal');return `<code>${cell(literal)}</code>`;
        });
        if(repaired && (i===lines.length-1 || !/^\s*\|/.test(lines[i+1]))) {
          lines[i]+='\n\n> 表格代码单元格已保留接口原字符并修复分列；页面显示的转义字符需要核对。';repaired=false;
        }
      }
      part=lines.join('\n');
      return part;
    };
    let md='',last=0;
    for(const match of text.matchAll(protectedPattern)) {
      md+=prose(text.slice(last,match.index))+match[0];last=match.index+match[0].length;
    }
    md+=prose(text.slice(last));
    return {md,needsUI:uiReasons.size>0,needsTableUI,uiReasons:[...uiReasons]};
  }
  // Plain-text replies mark citations, entities and images inline with private-use
  // markers (matched_text); content_references says what each one stands for.
  function applyReferences(text, refs) {
    if (!Array.isArray(refs) || !refs.length || typeof text !== 'string') return text;
    const url = u => String(u).replace(/[()\s<>]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
    const link = (label, u) => `[${String(label).replace(/([[\]])/g, '\\$1')}](${url(u)})`;
    const render = r => {
      const items = Array.isArray(r.items) ? r.items.filter(i => typeof i?.url === 'string') : [];
      if (items.length) return `（${items.map(i => link(i.attribution || i.title || i.url, i.url)).join('、')}）`;
      if (typeof r.alt === 'string' && r.alt.trim()) return r.alt;
      if (typeof r.name === 'string' && r.name.trim()) return r.name;
      return '';
    };
    // Longest markers first, so a marker that contains another is replaced whole.
    for (const r of refs.filter(r => typeof r?.matched_text === 'string' && r.matched_text.trim()).sort((a, b) => b.matched_text.length - a.matched_text.length)) text = text.split(r.matched_text).join(render(r));
    return text;
  }
  function toolImages(message) {
    const title = message.metadata?.image_gen_title, plots = message.metadata?.ada_visualizations;
    const parts = (message.content?.parts || []).filter(p => fileIdOf(p?.asset_pointer)).map(p => ({fileId:fileIdOf(p.asset_pointer), width:p.width, height:p.height, alt:title ? `生成图片：${title}` : '生成图片'}));
    const outputs = (message.metadata?.aggregate_result?.messages || []).filter(m => m?.message_type === 'image' && fileIdOf(m.image_url)).map((m, i) => ({fileId:fileIdOf(m.image_url), width:m.width, height:m.height, alt:`代码运行图表${plots?.[i]?.title ? `：${plots[i].title}` : ''}`}));
    return [...parts, ...outputs].map(i => ({...i, alt:i.alt.replace(/[[\]\r\n]/g, ' ')}));
  }
  function records(messages) {
    const warnings = [], result = [], seen = new Set();
    for (const message of messages) {
      if (!message) continue;
      const role = message.author?.role;
      // Tool output is plumbing, except the images it shows in the conversation:
      // generated images and code-interpreter plots.
      if (role === 'tool') {
        if (message.metadata?.is_visually_hidden_from_conversation || !message.id || seen.has(message.id)) continue;
        const images = toolImages(message);
        if (!images.length) continue;
        seen.add(message.id);
        const md = images.map(i => `![${i.alt}](asset:${i.fileId})`).join('\n\n');
        result.push({id:message.id, role:'assistant', md, needsUI:false, needsTableUI:false, uiReasons:[], needsAssets:false, images, summary:images.map(i => i.alt).join('、').slice(0,100)});
        continue;
      }
      if (!['user','assistant'].includes(role) || message.metadata?.is_visually_hidden_from_conversation) continue;
      // Analysis/tool plumbing is not the displayed answer.
      if (message.channel && !['final','commentary'].includes(message.channel)) continue;
      if (message.recipient && message.recipient !== 'all') continue;
      if (!message.id || seen.has(message.id)) error('消息标识缺失或重复，无法确认正文完整性');
      seen.add(message.id);
      const text = textOf(message, warnings);
      const normalized = normalizeText(message.metadata?.model_dil_v2 ? text : applyReferences(text, message.metadata?.content_references));
      if (message.metadata?.model_dil_v2) {
        normalized.needsUI = true;
        if(!normalized.uiReasons.includes('model-dil'))normalized.uiReasons.push('model-dil');
      }
      // Files-service images are downloaded by id; only other images need the page.
      const images = (message.content?.parts || []).filter(p=>fileIdOf(p?.asset_pointer)).map(p=>({fileId:fileIdOf(p.asset_pointer),width:p.width,height:p.height}));
      const needsAssets = (message.content?.parts || []).some(p=>p && typeof p==='object' && (p.content_type==='image_asset_pointer' || p.asset_pointer) && !fileIdOf(p.asset_pointer)) || /!\[[^\]]*\]\((?!asset:)/.test(normalized.md);
      normalized.needsAssets = needsAssets;normalized.images = images;
      if (message.metadata?.model_dil_v2) {
        // Keep everything needed to re-render the UI: the model-authored DIL
        // source, the compiled program, and embedded widgets (AppBlocks).
        normalized.dil = message.metadata.model_dil_v2;
        normalized.dilSource = (message.content?.parts || []).filter(p=>typeof p==='string').join('\n');
        normalized.contentReferences = message.metadata.content_references || [];
      }
      const md = normalized.md || (needsAssets ? '> 此消息包含图像，ZIP 导出时从页面补充。' : '');
      if (md.trim()) result.push({id:message.id, role, ...normalized, summary:md.replace(/\s+/g,' ').slice(0,100)});
    }
    if (!result.length) error('会话没有可导出的正文');
    return {messages:result,warnings};
  }
  function parseTree(data, leafId) {
    const map = data.mapping;
    if (!map || typeof map !== 'object') error('会话消息树格式不受支持');
    // A DOM message id may differ from the mapping node id.
    const candidate = leafId && (map[leafId] ? leafId : Object.keys(map).find(key => map[key].message?.id === leafId));
    let selectedLeaf = candidate || data.current_node;
    // DOM may expose an older ancestor because later messages are virtualized.
    if (candidate && data.current_node) {
      let at = data.current_node;const visited = new Set();
      while (at && map[at] && !visited.has(at)) {
        if (at === candidate) {selectedLeaf=data.current_node;break;}
        visited.add(at);at=map[at].parent;
      }
    }
    // For an alternate visible branch, finish its unambiguous descendant chain.
    const descendants=new Set();
    while (map[selectedLeaf]?.children?.length) {
      if(descendants.has(selectedLeaf))error('回答分支存在循环');
      descendants.add(selectedLeaf);
      const children=map[selectedLeaf].children;
      if(children.length!==1)error('当前可见消息有多个回答分支，无法确定导出范围');
      selectedLeaf=children[0];
    }
    let cursor = selectedLeaf;
    if (!cursor || !map[cursor]) error('无法确定当前回答分支');
    const reversed = [], seen = new Set();
    while (cursor != null) {
      if (seen.has(cursor) || !map[cursor]) error('消息树存在循环或缺失父节点');
      seen.add(cursor); const node = map[cursor];
      if (node.message) reversed.push(node.message);
      cursor = node.parent;
    }
    return {...records(reversed.reverse()), title:data.title || 'ChatGPT', branch:selectedLeaf};
  }
  async function loadConversation({id,leafId,fetch:request,signal,onProgress}) {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) error('请打开已保存的 ChatGPT 对话');
    async function get(path, headers = {}) {
      signal?.throwIfAborted();
      const response = await request(path,{credentials:'same-origin',headers,signal});
      return response;
    }
    const sessionResponse = await get('/api/auth/session');
    if (!sessionResponse.ok) error(`登录状态读取失败（HTTP ${sessionResponse.status}），请刷新页面后重试`);
    const session = await sessionResponse.json();
    if (!session.accessToken) error('未取得登录状态，请先登录 ChatGPT');
    const headers = {Authorization:`Bearer ${session.accessToken}`};
    // Keep credentials only in this request closure; never return/store/log them.
    const legacy = await get(`/backend-api/conversation/${encodeURIComponent(id)}`, headers);
    let data, pages = 1;
    if (legacy.ok) {
      data = await legacy.json();
      if (data.conversation_id && data.conversation_id !== id) error('接口返回了不同对话，已停止');
      if (data.mapping) return {...parseTree(data,leafId),pages,source:'conversation-tree',raw:data};
      error('会话接口返回未知格式');
    }
    if (legacy.status !== 404) error(`会话读取失败（HTTP ${legacy.status}），请稍后重试`);
    let cursor = null, collected = [], title = '', seenCursors = new Set(), rawPages = [];
    do {
      const suffix = cursor ? `&before=${encodeURIComponent(cursor)}` : '';
      const response = await get(`/backend-api/conversations/${encodeURIComponent(id)}?include_has_versions=true&num_turns=100${suffix}`,headers);
      if (!response.ok) error(`历史消息读取失败（HTTP ${response.status}），未生成不完整导出`);
      data = await response.json();
      if (data.conversation_id && data.conversation_id !== id) error('接口返回了不同对话，已停止');
      if (data.mapping && !cursor) return {...parseTree(data,leafId),pages,source:'conversation-tree',raw:data};
      rawPages.unshift(data);
      if (!Array.isArray(data.messages) || !data.page_info) error('分页接口格式未知，无法确认历史完整性');
      title ||= data.title || 'ChatGPT';
      collected = [...data.messages.map(item => item.message || item),...collected];
      onProgress?.({pages,messages:collected.length});
      if (!data.page_info.has_previous_page) break;
      cursor = data.page_info.start_cursor;
      if (!cursor || seenCursors.has(cursor) || pages >= 1000) error('历史分页未完成或游标重复，已停止');
      seenCursors.add(cursor); pages++;
    } while (true);
    // API pages are chronological, with older pages prepended. Deduplicate overlaps.
    const unique = [], byId = new Map();
    for (const message of collected) {
      if (!message.id) error('分页消息缺少标识');
      if (byId.has(message.id)) {
        if (JSON.stringify(byId.get(message.id)) !== JSON.stringify(message)) error('分页重叠消息发生变化，请刷新后重试');
      } else {byId.set(message.id,message);unique.push(message);}
    }
    if(unique.every(m=>Number.isFinite(m.create_time))) unique.sort((a,b)=>a.create_time-b.create_time);
    return {...records(unique),title,pages,source:'paginated-conversation',raw:{pages:rawPages}};
  }
  const extensionOf = type => ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'})[String(type || '').split(';')[0].trim()] || 'bin';
  // Some file URLs answer without a content type (e.g. code-interpreter plots).
  async function sniffImage(blob) {
    try {
      const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer()), ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
      if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
      if (ascii(0, 4) === 'GIF8') return 'gif';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
    } catch {}
    return 'bin';
  }
  async function pool(items, limit, worker) {
    const results = new Array(items.length);let next = 0;
    await Promise.all(Array.from({length:Math.min(limit,items.length)}, async () => {
      while (next < items.length) {const index = next++;results[index] = await worker(items[index], index);}
    }));
    return results;
  }
  // Downloads original images through the files API, in parallel and without
  // touching the page. Failures are returned per item so the caller can fall back.
  async function downloadFiles({ids, conversationId, fetch:request, signal, concurrency = 6, onProgress}) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const sessionResponse = await request('/api/auth/session',{credentials:'same-origin',signal});
    if (!sessionResponse.ok) error(`登录状态读取失败（HTTP ${sessionResponse.status}）`);
    const token = (await sessionResponse.json()).accessToken;
    if (!token) error('未取得登录状态，请先登录 ChatGPT');
    const headers = {Authorization:`Bearer ${token}`};
    let done = 0;
    return pool(unique, concurrency, async fileId => {
      try {
        signal?.throwIfAborted();
        const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}&inline=false` : '';
        let meta = await request(`/backend-api/files/download/${encodeURIComponent(fileId)}${query}`,{credentials:'same-origin',headers,signal});
        if (meta.status === 404) meta = await request(`/backend-api/files/${encodeURIComponent(fileId)}/download`,{credentials:'same-origin',headers,signal});
        if (!meta.ok) throw Error(`HTTP ${meta.status}`);
        const url = (await meta.json()).download_url;
        if (typeof url !== 'string' || !url) throw Error('接口未返回下载地址');
        const sameOrigin = url.startsWith('/') || url.startsWith(root.location?.origin + '/');
        const file = await request(url,{credentials:sameOrigin ? 'include' : 'omit',signal});
        if (!file.ok) throw Error(`下载 HTTP ${file.status}`);
        const blob = await file.blob();
        let ext = extensionOf(blob.type || file.headers?.get?.('content-type'));
        if (ext === 'bin') ext = await sniffImage(blob);
        return {fileId, blob, path:`assets/${fileId}.${ext}`};
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return {fileId, error:e.message};
      } finally {onProgress?.({done:++done,total:unique.length});}
    });
  }
  // Image URLs the server resolved into Intelligent UI data (AsyncImage etc.).
  function dilImageUrls(dil) {
    const urls = new Set();
    const walk = (value, key) => {
      if (typeof value === 'string') {if (/^https:\/\//.test(value) && /image|img|src|thumb|photo|logo|icon|url/i.test(key || ''))urls.add(value);}
      else if (Array.isArray(value)) value.forEach(item => walk(item, key));
      else if (value && typeof value === 'object') for (const [k, item] of Object.entries(value)) walk(item, k);
    };
    // Server-resolved components: only search images are images (content_url);
    // links, citations and entities point at web pages.
    const results = dil?.appData?.opGenui?.componentResults || {};
    for (const r of Object.values(results)) if (/^AsyncImage/.test(r?.componentName || '')) for (const i of r.state?.images || []) if (typeof i?.content_url === 'string' && /^https:\/\//.test(i.content_url)) urls.add(i.content_url);
    const appData = dil?.appData?.opGenui ? {...dil.appData, opGenui:{...dil.appData.opGenui, modelDataBindings:undefined, modelDataBindingSafeUrls:undefined, componentResults:undefined}} : dil?.appData;
    walk(appData, '');walk(dil?.constants, '');
    return [...urls];
  }
  // Files the code interpreter wrote (sandbox:/mnt/data/...), linked from a message.
  async function downloadSandboxFiles({items, conversationId, fetch:request, signal, concurrency = 4}) {
    if (!items.length) return [];
    const sessionResponse = await request('/api/auth/session',{credentials:'same-origin',signal});
    if (!sessionResponse.ok) error(`登录状态读取失败（HTTP ${sessionResponse.status}）`);
    const token = (await sessionResponse.json()).accessToken;
    if (!token) error('未取得登录状态，请先登录 ChatGPT');
    const headers = {Authorization:`Bearer ${token}`}, names = new Set();
    return pool(items, concurrency, async ({messageId, path}) => {
      try {
        signal?.throwIfAborted();
        const meta = await request(`/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(path)}`,{credentials:'same-origin',headers,signal});
        if (!meta.ok) throw Error(`HTTP ${meta.status}`);
        const url = (await meta.json()).download_url;
        if (typeof url !== 'string' || !url) throw Error('接口未返回下载地址');
        const sameOrigin = url.startsWith('/') || url.startsWith(root.location?.origin + '/');
        const file = await request(url,{credentials:sameOrigin ? 'include' : 'omit',signal});
        if (!file.ok) throw Error(`下载 HTTP ${file.status}`);
        let name = (path.split('/').pop() || 'file').replace(/[^\w.\-一-鿿]/g, '_'), n = 1;
        while (names.has(name)) name = name.replace(/(\.[^.]*)?$/, m => `-${++n}${m}`);
        names.add(name);
        return {messageId, path, blob:await file.blob(), localPath:`files/${name}`};
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return {messageId, path, error:e.message};
      }
    });
  }
  // fetchImage (optional) downloads hosts the page cannot reach cross-origin.
  async function downloadUrls({urls, fetch:request, fetchImage, signal, concurrency = 6, prefix = 'assets/ui-'}) {
    return pool(urls, concurrency, async (url, index) => {
      try {
        signal?.throwIfAborted();
        let blob, type;
        if (fetchImage && /^https:\/\/images\.openai\.com\//.test(url)) {blob = await fetchImage(url);type = blob.type;}
        else {
          const file = await request(url,{credentials:'omit',signal});
          if (!file.ok) throw Error(`HTTP ${file.status}`);
          blob = await file.blob();type = blob.type || file.headers?.get?.('content-type');
        }
        let ext = extensionOf(type);
        if (ext === 'bin') ext = await sniffImage(blob);
        return {url, blob, path:`${prefix}${index + 1}.${ext}`};
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return {url, error:e.message};
      }
    });
  }
  function markdown(conversation, ids, url) {
    const selected = new Set(ids);
    const body = conversation.messages.filter(m => selected.has(m.id)).map(m => `## ${m.role === 'user' ? '我' : 'ChatGPT'}\n\n${m.md}`).join('\n\n---\n\n');
    if (!body) error('请至少选择一条消息');
    const warnings=(conversation.warnings||[]).filter(w=>[...selected].some(id=>w.startsWith(`${id}:`)));
    const note=warnings.length ? `\n\n## 未包含的非文字内容\n\n${warnings.map(w=>`- ${w}`).join('\n')}\n` : '';
    return `# ${conversation.title.replace(/[\r\n]/g,' ')}\n\n来源：${url}\n\n${body}\n${note}`;
  }
  const api = {fileIdOf,textOf,normalizeText,applyReferences,toolImages,records,parseTree,loadConversation,downloadFiles,downloadSandboxFiles,dilImageUrls,downloadUrls,markdown};
  root.FastTextExporter = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
