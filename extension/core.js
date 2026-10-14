/* Markdown fence and KaTeX extraction approaches informed by otaliptus/chatgpt-markdown-exporter (MIT). */
(function (root) {
  'use strict';
  const clean = s => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  const fence = s => '`'.repeat(Math.max(3, ...[...s.matchAll(/`+/g)].map(m => m[0].length + 1)));
  const transient = '[role="tooltip"],.recharts-tooltip-wrapper,.recharts-tooltip-cursor,.recharts-active-dot,[data-d-component="tooltip"]';
  const codeSurface = '[data-markdown-copy="code-block"]';
  const choice = '[role="radio"],[role="checkbox"],input[type="radio"],input[type="checkbox"]';
  const cardSelector = '[data-d-component="box"][data-d-has-border],form,[role="application"],[data-archive-widget]';
  const skip = `script,style,noscript,button,[aria-hidden="true"],[hidden],[data-archive-owned],.sr-only,${transient}`;
  const checked = n => n.checked || n.getAttribute('aria-checked') === 'true';
  function choiceLabel(n) {
    return n.closest('label') || [...n.ownerDocument.querySelectorAll('label[for]')].find(l=>l.htmlFor===n.id && n.id);
  }
  function semanticChoices(n) {
    const controls=[...n.querySelectorAll(choice)];
    return controls.length>0 && controls.every(choiceLabel) && !n.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]),select,textarea,canvas,iframe,[role="slider"],[role="switch"],[role="tablist"]');
  }
  function answeredQuiz(n) {return [...n.querySelectorAll('[role="radio"],input[type="radio"]')].some(checked);}
  function visualCard(img, boundary) {
    for(let p=img.parentElement;p && p!==boundary;p=p.parentElement){
      if(p.matches(cardSelector + ',figure')){
        const copy=p.cloneNode(true);copy.querySelectorAll('img,svg,button,'+transient).forEach(n=>n.remove());
        return clean(copy.textContent) ? p : null;
      }
    }
    return null;
  }
  function cssGraphic(n){
    return n.matches('[data-d-component][data-d-has-height]') && /^\d+(?:\.\d+)?px$/.test(n.style.height) && parseFloat(n.style.height)<=32 && n.children.length>0 && !clean(n.textContent) && [...n.children].every(c=>c.style.backgroundColor && (parseFloat(c.style.flexGrow)>0 || /%$/.test(c.style.width)));
  }
  function graphicGroup(bar){
    const wrapper=bar.parentElement;
    const group=wrapper?.parentElement;
    if(!group || !wrapper.matches('[data-d-clip]') || wrapper.children.length!==1)return bar;
    const parts=[...group.children];
    const legend=parts.at(-1);
    if(parts.length===3 && parts[1]===wrapper && parts[0].matches('[data-d-component="text"]') && legend.matches('[data-d-component="row"][data-d-justify="between"]') && legend.children.length===2 && [...legend.children].every(n=>n.matches('[data-d-component="text"]')) && !group.querySelector('input,button,canvas,svg,img'))return group;
    return bar;
  }
  function describeBlock(n){
    if(cssGraphic(n) || [...n.querySelectorAll('[data-d-component][data-d-has-height]')].some(bar=>cssGraphic(bar) && graphicGroup(bar)===n))return 'CSS 比例或进度图';
    if(n.querySelector(choice+',input,select,[role="slider"]'))return '交互界面的当前状态';
    if(n.matches('[role="img"]') || n.querySelector('[data-w-component="chart"]'))return '图表快照';
    if(n.querySelector('img[data-d-component="svg"],svg[data-d-component="svg"]'))return '示意图及外围说明';
    return '内容区域截图';
  }
  function isActive(el) {
    for(let p=el;p?.nodeType===1;p=p.parentElement){
      if(p.hidden || p.hasAttribute('inert') || p.getAttribute('aria-hidden')==='true')return false;
      const style=p.ownerDocument.defaultView?.getComputedStyle(p);
      if(style && (style.display==='none' || style.visibility==='hidden' || style.contentVisibility==='hidden'))return false;
    }
    return true;
  }
  const normalizeConversation = id => (id || '').replace(/^local-chatgpt:/,'');
  function conversationScope(doc) {
    const expected=doc.location?.pathname.match(/\/c\/([^/]+)/)?.[1] || null;
    const all=[...doc.querySelectorAll('[data-app-action-timeline-scroll],[role="region"][aria-label="Conversation"]')];
    let regions=all.filter(isActive).filter(n=>!all.some(p=>p!==n && p.contains(n) && isActive(p)));
    const identities=n=>[...new Set([...n.querySelectorAll('[data-chatgpt-selection-conversation-id]')].map(el=>normalizeConversation(el.getAttribute('data-chatgpt-selection-conversation-id'))))];
    if(regions.length>1 && expected)regions=regions.filter(n=>identities(n).includes(expected));
    if(regions.length>1)throw Error('无法唯一识别当前对话区域，已停止以避免混入其他聊天');
    const scope=regions[0] || (all.length ? null : doc);
    const ids=scope?identities(scope):[];
    const localAlias=scope && regions.length===1 && ids.length===1 && [...scope.querySelectorAll('[data-chatgpt-selection-conversation-id]')].every(n=>n.getAttribute('data-chatgpt-selection-conversation-id').startsWith('local-chatgpt:'));
    if(expected && ids.length && !ids.includes(expected) && !localAlias)throw Error('页面内容与当前聊天地址不匹配，请等待加载后重试');
    return {scope,conversationId:localAlias?ids[0]:(expected || (ids.length===1?ids[0]:null))};
  }
  function discover(doc) {
    const {scope,conversationId}=conversationScope(doc);if(!scope)return [];
    let nodes = [...scope.querySelectorAll('[data-chatgpt-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":assistant"],[data-message-author-role],[data-chatgpt-selection-message-id]')].filter(isActive);
    nodes=nodes.filter(n=>{
      const owner=n.closest('[data-chatgpt-selection-conversation-id]') || n.querySelector('[data-chatgpt-selection-conversation-id]');
      return !owner || !conversationId || normalizeConversation(owner.getAttribute('data-chatgpt-selection-conversation-id'))===conversationId;
    });
    nodes = nodes.filter(n => !nodes.some(other => other !== n && other.contains(n)));
    return nodes.map((el, index) => {
      const key = el.getAttribute('data-chatgpt-search-unit-key') || '';
      const role = el.getAttribute('data-message-author-role') || (key.endsWith(':user') ? 'user' : 'assistant');
      const roots = [...el.querySelectorAll(role === 'user' ? '[data-user-message-bubble]' : '.markdown,[data-markdown-text-style="assistant-message"]')];
      const content = roots.filter(n => !roots.some(p => p !== n && p.contains(n)));
      const turn = key || el.closest('[data-content-search-turn-key]')?.getAttribute('data-content-search-turn-key') || el.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid') || '';
      const number = turn.match(/(?:turn-|conversation-turn-)(\d+)/)?.[1];
      const rawId = el.getAttribute('data-chatgpt-search-message-ids') || el.getAttribute('data-message-id') || el.getAttribute('data-chatgpt-selection-message-id') || key;
      const id = rawId ? [...new Set(rawId.trim().split(/\s+/))].join(' ') : (turn ? `${turn}:${role}` : `unstable-${index}`);
      return {el, roots: content.length ? content : [el], role, id, conversationId, stable: !!(rawId || turn), order: number === undefined ? null : Number(number) * 100 + (role === 'user' ? 0 : 50) + Number(key.match(/turn-\d+:(\d+):/)?.[1] || 0), index};
    });
  }
  // A response is an upper boundary, not a screenshot. Each independent card is a candidate.
  function planBlocks(message) {
    if (message.role !== 'assistant') return [];
    const control = 'iframe,canvas,video,audio,input:not([type="hidden"]),select,textarea,[role="slider"],[role="checkbox"],[role="radio"],[role="switch"],[role="tablist"],[role="application"]';
    const card = cardSelector;
    const candidates = [];
    for (const root of message.roots) {
      const seeds = [...root.querySelectorAll(control + ',[data-dil-message-id] button,.DilResponseRoot button')];
      for (const seed of seeds) {
        if (seed.closest(`[aria-hidden="true"],[hidden],pre,code,${codeSurface},${transient}`) || seed.closest('[data-archive-owned]')) continue;
        if(seed.matches('[data-widget-share-button],[aria-label="Chart options"]'))continue;
        const boundary = seed.closest('[data-dil-message-id],.DilResponseRoot') || root;
        if (boundary !== root && !root.contains(boundary)) continue;
        if(seed.closest('[data-w-component="chart"]')){
          const chart=seed.closest('[role="img"]') || seed.closest('[data-w-component="chart"]');
          if(!candidates.includes(chart))candidates.push(chart);
          continue;
        }
        let selected = seed;
        for (let parent = seed.parentElement; parent && parent !== boundary && root.contains(parent); parent = parent.parentElement) {
          if (parent.matches(card)) selected = parent;
        }
        if (selected === seed && boundary.matches('[data-dil-message-id],.DilResponseRoot')) {
          let child = seed;
          while (child.parentElement && child.parentElement !== boundary) child = child.parentElement;
          if (child.matches('[data-d-component="box"]')) selected = child;
        }
        if(semanticChoices(selected) && !answeredQuiz(selected) && !selected.matches(cardSelector))continue;
        if(selected===seed && seed.matches(choice) && choiceLabel(seed) && !seed.matches('[role="radio"],input[type="radio"]'))continue;
        // Never include a message toolbar or the entire prose response by generic ancestor climbing.
        if (!candidates.includes(selected)) candidates.push(selected);
      }
      for(const img of root.querySelectorAll('img[data-d-component="svg"],img[src^="data:image/svg+xml"],svg[data-d-component="svg"]')){
        const card=visualCard(img,img.closest('[data-dil-message-id]') || root);
        if(card && !candidates.includes(card))candidates.push(card);
      }
      for(const bar of root.querySelectorAll('[data-d-component][data-d-has-height]'))if(cssGraphic(bar))candidates.push(graphicGroup(bar));
    }
    return candidates.filter(n => !candidates.some(other => other !== n && other.contains(n))).map(el => ({el, reason:describeBlock(el), path:nodePath(message, el), label:(el.getAttribute('title') || el.textContent || el.tagName).trim().slice(0,80)}));
  }
  function nodePath(message, node) {
    const rootIndex = message.roots.findIndex(r => r === node || r.contains(node));
    if (rootIndex < 0) return null;
    const indexes = []; let current = node;
    while (current !== message.roots[rootIndex]) { indexes.unshift([...current.parentElement.children].indexOf(current)); current = current.parentElement; }
    return [rootIndex, ...indexes].join('.');
  }
  function resolvePath(message, path) {
    const [first, ...rest] = path.split('.').map(Number); let node = message.roots[first];
    for (const index of rest) node = node?.children[index];
    return node || null;
  }
  function safeURL(value, base) {
    try { const u = new URL(value, base); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href.replace(/\)/g, '%29') : ''; } catch { return ''; }
  }
  async function convert(message, ctx) {
    const warnings = ctx.warnings;
    const codeBlocks=[];let codeNumber=0;
    const protectCode=s=>{const token=`\u0000ARCHIVE_CODE_${codeBlocks.length}\u0000`;codeBlocks.push(s);return `\n\n${token}\n\n`;};
    async function visit(n) {
      if (n.nodeType === 3) return n.nodeValue.replace(/([\\`*_[\]])/g, '\\$1');
      if (n.nodeType !== 1) return '';
      if (ctx.replacements?.has(n)) {
        const description=describeBlock(n);
        const labels=description==='CSS 比例或进度图' && !cssGraphic(n) ? '：'+[...n.children].filter(c=>!c.matches('[data-d-clip]')).map(c=>clean(c.textContent)).join('；') : '';
        return `\n\n![${(description+labels).replace(/[\[\]\r\n]/g,' ')}](${ctx.replacements.get(n)})\n\n`;
      }
      if (n.matches(skip)) return '';
      if(n.matches(choice))return '';
      const tag = n.tagName.toLowerCase();
      if(n.matches('[data-d-component="icon"]'))return n.getAttribute('aria-label') || '';
      if(n.matches('[data-d-whitespace="preserve"]'))return n.textContent.replace(/\r?\n/g,'<br>\n');
      if(n.matches(codeSurface)) {
        const blockNumber=++codeNumber;
        const editor=n.querySelector('.cm-content'), code=n.querySelector('pre code,pre,.chatgpt-code-scrollport code');
        const collected=ctx.codeResults?.get(n);
        const s=collected?.text ?? (editor ? [...editor.querySelectorAll('.cm-line')].map(l=>l.textContent).join('\n') : code?.textContent);
        if(s!==undefined){
          const header=n.querySelector('[data-markdown-copy="exclude"]')?.cloneNode(true);
          header?.querySelectorAll('button,svg').forEach(n=>n.remove());
          const raw=editor?.getAttribute('data-language') || code?.className?.match(/language-([\w+-]+)/)?.[1] || clean(header?.textContent).toLowerCase();
          const lang=raw==='plain text'?'text':/^[\w+-]+$/.test(raw)?raw:'';
          const incomplete=collected ? !collected.complete : !!editor?.parentElement.querySelector('.cm-gap');
          const label=`代码块 ${blockNumber}（${lang || 'text'}）`;
          const warning=incomplete?`${label}未完整保存：${collected?.reason || '代码编辑器含未加载区域'}；末个已读行：${s.trimEnd().split('\n').at(-1)}`:'';
          if(warning)warnings.push(`${message.id}: ${warning}`);
          ctx.codeMetadata?.push({blockNumber,language:lang,complete:!incomplete,lineCount:s.split('\n').length,reason:collected?.reason || (incomplete?'存在未加载区域':undefined)});
          const f=fence(s);return (warning?`\n\n> ${warning.replace(/\n/g,' ')}\n\n`:'')+protectCode(`${f}${lang}\n${s.replace(/\n$/, '')}\n${f}`);
        }
        warnings.push(`${message.id}: 代码内容尚未加载，请展开代码后重新导出`);
      }
      if(n.matches('[data-d-component="grid"]')){
        const cells=[...n.children], pairs=cells.map(c=>{
          const box=c.matches(cardSelector)?c:c.querySelector(cardSelector);
          if(!box || box.children.length<2 || box.children.length>3 || box.querySelector('input,button,img,svg'))return null;
          const [label,value,unit]=box.children;
          return value.matches('[data-d-tabular-nums],h1,h2,h3') ? [clean(label.textContent),clean(value.textContent)+(unit?' '+clean(unit.textContent):'')] : null;
        });
        if(pairs.length>=2 && pairs.every(Boolean)){
          const row=a=>'| '+a.map(s=>s.replace(/\|/g,'\\|').replace(/\n/g,'<br>')).join(' | ')+' |';
          return '\n\n'+[row(pairs.map(p=>p[0])),row(pairs.map(()=>'---')),row(pairs.map(p=>p[1]))].join('\n')+'\n\n';
        }
      }
      const task=[...n.children].find(c=>c.matches('[data-has-label]') && c.querySelector('[role="checkbox"]'));
      if(task && n.querySelectorAll(choice).length===1 && n.children.length>1){
        const body=clean(await visit(task)),notes=[];
        for(const c of n.children)if(c!==task){const s=clean(await visit(c));if(s)notes.push(s);}
        return `\n\n${body}\n\n${notes.join('\n\n').split('\n').map(l=>'  '+l).join('\n')}\n\n`;
      }
      if(n.matches('[data-d-component="row"][data-d-justify="between"]') && n.children.length===2 && n.querySelector('[data-d-component="icon"]') && /^\s*\d+\s*\/\s*\d+\s*$/.test(n.lastElementChild.textContent)){
        return '\n\n'+'#'.repeat(Math.min(6,3+(ctx.headingOffset||0)))+' '+clean(n.firstElementChild.textContent)+' · '+clean(n.lastElementChild.textContent)+'\n\n';
      }
      const directGroup=[...n.children].find(c=>c.matches('[role="radiogroup"]'));
      if(directGroup){
        let out='';for(const child of n.children){const text=clean(await visit(child));out+=child===directGroup || child.tagName!=='P' ? `\n\n${text}\n\n` : `\n\n| ${text.replace(/\|/g,'\\|').replace(/\n/g,'<br>')} |\n| --- |\n\n`;}
        return out;
      }
      if(n.matches('label,[data-has-label],[data-d-component="radio"]')){
        const controls=[...n.querySelectorAll(choice)];
        if(controls.length===1 && choiceLabel(controls[0])){
          let text='';
          for(const child of choiceLabel(controls[0]).childNodes)text+=await visit(child);
          text=clean(text);
          return `\n\n- [${checked(controls[0])?'x':' '}] ${text}\n\n`;
        }
      }
      const annotation = n.matches('.katex,.katex-display') && n.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation) return n.matches('.katex-display') ? `\n\n$$\n${annotation.textContent}\n$$\n\n` : `$${annotation.textContent}$`;
      if (tag === 'pre') { const code = n.querySelector('code') || n; const s = code.textContent; const f = fence(s); const lang = (code.className || '').match(/language-([\w+-]+)/)?.[1] || ''; return protectCode(`${f}${lang}\n${s.replace(/\n$/, '')}\n${f}`); }
      if (tag === 'code') { const s = n.textContent;
        if(n.closest('table') && /[\\|]/.test(s))return '<code>'+s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\/g,'&#92;').replace(/\|/g,'&#124;')+'</code>';
        const f = '`'.repeat(Math.max(1, ...[...s.matchAll(/`+/g)].map(m => m[0].length + 1))); return `${f} ${s} ${f}`; }
      if (tag === 'img' || tag === 'svg') {
        try { const path = await ctx.asset(n, message); return `\n\n![${(n.getAttribute('alt') || '图像').replace(/[\[\]\n]/g, '')}](${path})\n\n`; }
        catch (e) { warnings.push(`${message.id}: 图像未保存：${e.message}`); return '\n\n> [图像未保存，请对该区域截图]\n\n'; }
      }
      if (['iframe','canvas','video','audio','input','select','textarea'].includes(tag)) {
        warnings.push(`${message.id}: ${tag} 需要截图或单独保存`);
        return `\n\n> [${tag} 界面未归档：请使用内容块截图；截图仅保存当前可见状态]\n\n`;
      }
      const children = async () => { let result = ''; for (const child of n.childNodes) result += await visit(child); return result; };
      if (tag === 'table') {
        const rows = [];
        for (const row of n.querySelectorAll('tr')) {
          if (row.closest('table') !== n) continue;
          rows.push(await Promise.all([...row.children].filter(c => /^(TH|TD)$/.test(c.tagName)).map(async c => clean(await visit(c)).replace(/\|/g, '\\|').replace(/\n+/g, '<br>'))));
        }
        if (!rows.length) return '';
        const width = Math.max(...rows.map(r => r.length));
        const format = r => '| ' + Array.from({length: width}, (_, i) => r[i] || '').join(' | ') + ' |';
        return '\n\n' + [format(rows[0]), format(Array(width).fill('---')), ...rows.slice(1).map(format)].join('\n') + '\n\n';
      }
      if (tag === 'ul' || tag === 'ol') {
        const lines = []; let number = Number(n.getAttribute('start')) || 1;
        for (const li of n.children) if (li.tagName === 'LI') {
          const body = clean(await visit(li)); const prefix = tag === 'ol' ? `${number++}. ` : /^- \[[ x]\]/.test(body)?'':'- ';
          lines.push(prefix + body.replace(/\n/g, '\n' + ' '.repeat(prefix.length)));
        }
        return '\n\n' + lines.join('\n') + '\n\n';
      }
      let body = await children();
      if (/^h[1-6]$/.test(tag)) return /^[-+\d.,]+\s*%$/.test(clean(body)) ? `\n\n**${clean(body)}**\n\n` : '\n\n' + '#'.repeat(Math.min(6,Number(tag[1])+(ctx.headingOffset||0))) + ' ' + clean(body) + '\n\n';
      if (tag === 'strong' || tag === 'b' || n.hasAttribute('data-d-default-strong') || n.matches('.font-semibold,.font-bold,[data-d-weight="semibold"],[data-d-weight="bold"]')) {
        const strong=clean(body).startsWith('**') && clean(body).endsWith('**') ? clean(body) : `**${clean(body)}**`;
        return ['p','div'].includes(tag) ? `\n\n${strong}\n\n` : strong;
      }
      if (tag === 'em' || tag === 'i') return `*${body}*`;
      if (tag === 'a') { const url = safeURL(n.getAttribute('href'), n.ownerDocument.baseURI); return url ? `[${clean(body) || url}](${url})` : body; }
      if (tag === 'br') return '\n';
      if (tag === 'hr') return '\n\n---\n\n';
      if (tag === 'blockquote') return '\n\n' + clean(body).split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      if (['p','div','section','article','figure','figcaption'].includes(tag)) return '\n\n' + clean(body) + '\n\n';
      return body;
    }
    const parts = []; for (const node of message.roots) parts.push(await visit(node));
    return clean(parts.join('\n\n')).replace(/\n{3,}/g, '\n\n').replace(/\u0000ARCHIVE_CODE_(\d+)\u0000/g,(_,i)=>codeBlocks[Number(i)]);
  }
  function serializeSVG(el) {
    if (el.querySelector('foreignObject,image') || [...el.querySelectorAll('use')].some(n => !(n.getAttribute('href') || '').startsWith('#'))) throw Error('SVG 包含嵌入内容或外部依赖，需要截图');
    const copy = el.cloneNode(true); copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const originals = [el, ...el.querySelectorAll('*')], clones = [copy, ...copy.querySelectorAll('*')];
    originals.forEach((n, i) => {
      const c = clones[i];
      for (const attr of [...c.attributes]) {
        if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && !attr.value.startsWith('#'))) c.removeAttribute(attr.name);
      }
      if (el.isConnected && el.ownerDocument === root.document && typeof getComputedStyle === 'function') {
        const style = getComputedStyle(n);
        for (const key of ['fill','stroke','color','font-family','font-size','font-weight']) c.style.setProperty(key, style.getPropertyValue(key));
      }
    });
    copy.querySelectorAll('script,foreignObject,style,image,use').forEach(n => { if (n.tagName === 'foreignObject') throw Error('SVG 包含 HTML 内容，需要截图'); if (n.tagName !== 'use' || !n.getAttribute('href')?.startsWith('#')) n.remove(); });
    // DOMParser documents have no Window/defaultView in Chrome.
    const Serializer=root.XMLSerializer || el.ownerDocument.defaultView?.XMLSerializer;
    return Serializer ? new Serializer().serializeToString(copy) : copy.outerHTML;
  }
  const api = {discover, convert, fence, serializeSVG, planBlocks, nodePath, resolvePath, conversationScope,describeBlock};
  root.ChatExportCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
