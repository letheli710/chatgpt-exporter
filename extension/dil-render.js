(function(root) {
  'use strict';
  // Static rendering of Intelligent UI (model_dil_v2.code) at its default state.
  // The compiled code is only executed inside the extension sandbox page;
  // this module builds the stub runtime and turns the element tree into Markdown.
  const noop = () => {};
  const inert = () => new Proxy(noop, {get:(_, key) => key === Symbol.toPrimitive ? () => '' : inert(), apply:() => undefined});
  const plain = value => {
    if (value == null || ['string','number','boolean'].includes(typeof value)) return value;
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    try {return JSON.parse(JSON.stringify(value));} catch {return undefined;}
  };
  // execute(code, scope) runs the compiled program with the given globals.
  function evaluate(dil, execute) {
    if (typeof dil?.code !== 'string' || !dil.code) throw Error('界面数据没有可执行的 code');
    const Fragment = 'Fragment';
    const jsx = (type, props, ...children) => {
      const all = {...(props || {})};
      if (typeof type === 'function') return type({...all, children});
      const out = {type:String(type), props:{}, children:children.flat(Infinity)};
      for (const [key, value] of Object.entries(all)) {const v = plain(value);if (v !== undefined) out.props[key] = v;}
      return out;
    };
    let tree = null;
    const known = {
      render:value => { tree = value; },
      useState:initial => [typeof initial === 'function' ? initial() : initial, noop],
      useConstants:() => dil.constants || {},
      useAppData:select => typeof select === 'function' ? select(dil.appData || {}) : dil.appData || {},
      useMemo:fn => fn(), useCallback:fn => fn, useRef:value => ({current:value}), useEffect:noop, useLayoutEffect:noop
    };
    // Hooks this stub does not know yet still run instead of throwing.
    const DIL = new Proxy(known, {get:(target, key) => key in target ? target[key] : inert()});
    execute(dil.code, {DIL, __dil:{jsx, Fragment}, GenUI:inert()});
    if (!tree) throw Error('界面程序没有调用 DIL.render');
    return plain(tree);
  }
  const inlineTypes = new Set(['bold','italic','code','link','strike','math']);
  function toMarkdown(tree, {widget = id => `〔嵌入应用 ${id}〕`} = {}) {
    const inline = node => walk(node, true), block = text => `\n\n${text.trim()}\n\n`;
    function walk(node, isInline = false) {
      if (node == null || node === false || node === true) return '';
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(n => walk(n, isInline)).join('');
      const kids = () => walk(node.children, isInline), p = node.props || {};
      switch (node.type) {
        case 'bold': return `**${inline(node.children)}**`;
        case 'italic': return `*${inline(node.children)}*`;
        case 'strike': return `~~${inline(node.children)}~~`;
        case 'code': return `\`${inline(node.children)}\``;
        case 'link': return `[${inline(node.children)}](${p.href || p.url || ''})`;
        case 'math': return `$${p.value ?? inline(node.children)}$`;
        case 'title': return `\n\n${'#'.repeat(p.size === 'sm' ? 4 : 3)} ${inline(node.children)}\n\n`;
        case 'text': return isInline ? inline(node.children) : block(inline(node.children));
        case 'checkbox': return `\n- [${p.checked ? 'x' : ' '}] ${inline(node.children)}\n`;
        case 'divider': return '\n\n---\n\n';
        case 'image': return p.src ? block(`![${p.alt || ''}](${p.src})`) : '';
        case '__chatgptClientDefinedWidget': return block(widget(p.invocationId));
        default: return inlineTypes.has(node.type) || isInline ? kids() : walk(node.children, false);
      }
    }
    return walk(tree).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // AppBlocks are stored as content_references and linked from the program by
  // invocation id -> clientDefinedWidgets[id].refIndex.
  function appBlocks(dil, contentReferences) {
    const refs = Array.isArray(contentReferences) ? contentReferences : [];
    return Object.entries(dil?.clientDefinedWidgets || {}).map(([invocationId, widget]) => {
      const data = refs[widget?.refIndex]?.data;
      if (!data || data.widget_type !== 'app_block' || typeof data.content !== 'string') return null;
      return {invocationId, id:String(data.app_block_id || invocationId), title:data.title || '嵌入应用', language:data.language, content:data.content};
    }).filter(Boolean);
  }
  const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  function standaloneHtml(block) {
    if (/<html[\s>]/i.test(block.content)) return block.content;
    return `<!doctype html>\n<html lang="zh">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(block.title)}</title>\n</head>\n<body>\n${block.content}\n</body>\n</html>\n`;
  }
  // Content-script side: evaluates through the sandbox page over a private port.
  function sandboxClient(doc, src, {timeout = 4000} = {}) {
    const frame = doc.createElement('iframe');
    frame.src = src;frame.hidden = true;frame.dataset.archiveOwned = 'dil-sandbox';
    const ready = new Promise((resolve, reject) => {
      frame.addEventListener('load', resolve, {once:true});
      setTimeout(() => reject(Error('界面渲染沙箱未能加载')), timeout);
    });
    ready.catch(noop);
    doc.documentElement.append(frame);
    const evaluateRemote = async dil => {
      await ready;
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel(), timer = setTimeout(() => {channel.port1.close();reject(Error('界面渲染超时'));}, timeout);
        channel.port1.onmessage = event => {clearTimeout(timer);channel.port1.close();event.data?.error ? reject(Error(event.data.error)) : resolve(event.data?.tree);};
        frame.contentWindow.postMessage({type:'dil:evaluate', dil:{code:dil.code, constants:dil.constants, appData:dil.appData}}, '*', [channel.port2]);
      });
    };
    evaluateRemote.close = () => frame.remove();
    return evaluateRemote;
  }
  const api = {evaluate, toMarkdown, appBlocks, standaloneHtml, sandboxClient};
  root.ChatExportDilRender = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
