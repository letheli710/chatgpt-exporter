(function(root) {
  'use strict';
  const error = message => { throw Error(message); };
  const fence = text => '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
  function textOf(message, warnings) {
    const content = message.content || {};
    const fallback = message.metadata?.model_dil_v2?.fallbackMarkdown;
    if (typeof fallback === 'string' && fallback.trim()) return fallback;
    if (['user_editable_context','model_editable_context'].includes(content.content_type)) return '';
    const parts = content.parts || (typeof content.text === 'string' ? [content.text] : []);
    const text = parts.map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      warnings.push(`${message.id}: 未导出非文字内容（${part?.content_type || 'unknown'}）`);
      return '';
    }).filter(Boolean).join('\n');
    if (!text && content.content_type && !['text','multimodal_text','code'].includes(content.content_type)) warnings.push(`${message.id}: 内容类型 ${content.content_type} 没有可读取的文字`);
    if (content.content_type === 'code' && text) return `${fence(text)}${/^[\w+-]+$/.test(content.language || '') ? content.language : ''}\n${text}\n${fence(text)}`;
    return text;
  }
  function records(messages) {
    const warnings = [], result = [], seen = new Set();
    for (const message of messages) {
      if (!message) continue;
      const role = message.author?.role;
      if (!['user','assistant'].includes(role) || message.metadata?.is_visually_hidden_from_conversation) continue;
      // Analysis/tool plumbing is not the displayed answer.
      if (message.channel && !['final','commentary'].includes(message.channel)) continue;
      if (message.recipient && message.recipient !== 'all') continue;
      if (!message.id || seen.has(message.id)) error('消息标识缺失或重复，无法确认正文完整性');
      seen.add(message.id);
      const md = textOf(message, warnings);
      if (md.trim()) result.push({id:message.id, role, md, summary:md.replace(/\s+/g,' ').slice(0,100)});
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
      if (data.mapping) return {...parseTree(data,leafId),pages,source:'conversation-tree'};
      error('会话接口返回未知格式');
    }
    if (legacy.status !== 404) error(`会话读取失败（HTTP ${legacy.status}），请稍后重试`);
    let cursor = null, collected = [], title = '', seenCursors = new Set();
    do {
      const suffix = cursor ? `&before=${encodeURIComponent(cursor)}` : '';
      const response = await get(`/backend-api/conversations/${encodeURIComponent(id)}?include_has_versions=true&num_turns=100${suffix}`,headers);
      if (!response.ok) error(`历史消息读取失败（HTTP ${response.status}），未生成不完整导出`);
      data = await response.json();
      if (data.conversation_id && data.conversation_id !== id) error('接口返回了不同对话，已停止');
      if (data.mapping && !cursor) return {...parseTree(data,leafId),pages,source:'conversation-tree'};
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
    return {...records(unique),title,pages,source:'paginated-conversation'};
  }
  function markdown(conversation, ids, url) {
    const selected = new Set(ids);
    const body = conversation.messages.filter(m => selected.has(m.id)).map(m => `## ${m.role === 'user' ? '我' : 'ChatGPT'}\n\n${m.md}`).join('\n\n---\n\n');
    if (!body) error('请至少选择一条消息');
    const warnings=(conversation.warnings||[]).filter(w=>[...selected].some(id=>w.startsWith(`${id}:`)));
    const note=warnings.length ? `\n\n## 未包含的非文字内容\n\n${warnings.map(w=>`- ${w}`).join('\n')}\n` : '';
    return `# ${conversation.title.replace(/[\r\n]/g,' ')}\n\n来源：${url}\n\n${body}\n${note}`;
  }
  const api = {textOf,records,parseTree,loadConversation,markdown};
  root.FastTextExporter = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
