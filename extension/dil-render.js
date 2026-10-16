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
  // Top-level prose stays Markdown; every other top-level component (box,
  // card, ...) becomes its own card segment that is drawn as an image.
  const proseTypes = new Set(['text','title','divider','bold','italic','strike','code','link','math','__chatgptClientDefinedWidget']);
  function segments(tree) {
    const flat = [], out = [];
    const add = node => {
      if (node == null || node === false || node === true || node === '') return;
      if (Array.isArray(node)) return node.forEach(add);
      if (node.type === 'Fragment') return node.children.forEach(add);
      flat.push(node);
    };
    add(tree);
    for (const node of flat) {
      const prose = typeof node !== 'object' || proseTypes.has(node.type);
      if (prose && out.at(-1)?.kind === 'md') out.at(-1).tree.children.push(node);
      else out.push(prose ? {kind:'md', tree:{type:'Fragment', props:{}, children:[node]}} : {kind:'card', tree:node});
    }
    return out;
  }
  // Approximates ChatGPT's look; it is not a pixel copy of their components.
  const CARD_CSS = `.dil-root{display:block;width:700px;padding:10px;box-sizing:border-box;font:14px/1.55 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#0d0d0d;background:#fff}
.dil-root *{box-sizing:border-box}.card{display:flex;flex-direction:column;gap:8px;border:1px solid #e3e3e3;border-radius:16px;padding:16px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.box{display:flex;flex-direction:column}.t{margin:0}.title{font-weight:600;font-size:16px;line-height:1.35}.title-lg{font-size:18px}.title-sm{font-size:14px}
.cb{display:flex;align-items:center;gap:8px}.cb-box{flex:none;width:16px;height:16px;border:1.5px solid #8f8f8f;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#fff}.cb-box.on{background:#0d0d0d;border-color:#0d0d0d}
.hr{border:0;border-top:1px solid #ececec;margin:4px 0;width:100%}code{font-family:ui-monospace,Consolas,monospace;background:#f3f3f3;border-radius:4px;padding:0 4px}
.link{color:#2964aa;text-decoration:underline}.muted{color:#5d5d5d}.small{font-size:12px}.widget,.img{border:1px dashed #c9c9c9;border-radius:10px;padding:10px 12px;color:#5d5d5d;font-size:13px}`;
  const cssLength = value => typeof value === 'number' ? `${value * 4}px` : /^[\d.]+(px|%|rem|em)?$/.test(String(value)) ? String(value) : null;
  function boxStyle(p) {
    const s = [];
    for (const [prop, css] of [['maxWidth','max-width'],['width','width'],['minWidth','min-width']]) {const v = p[prop] != null && cssLength(p[prop]);if (v) s.push(`${css}:${v}`);}
    if (typeof p.gap === 'number') s.push(`gap:${p.gap * 4}px`);
    if (typeof p.padding === 'number') s.push(`padding:${p.padding * 4}px`);
    else if (p.padding && typeof p.padding === 'object') s.push(`padding:${(p.padding.y ?? 0) * 4}px ${(p.padding.x ?? 0) * 4}px`);
    return s.length ? ` style="${s.join(';')}"` : '';
  }
  // Well-formed XHTML, so it can be embedded in an SVG foreignObject.
  function toHtml(tree) {
    const inline = node => walk(node, true);
    function walk(node, isInline = false) {
      if (node == null || node === false || node === true) return '';
      if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
      if (Array.isArray(node)) return node.map(n => walk(n, isInline)).join('');
      const p = node.props || {}, kids = () => walk(node.children, isInline);
      switch (node.type) {
        case 'bold': return `<strong>${inline(node.children)}</strong>`;
        case 'italic': return `<em>${inline(node.children)}</em>`;
        case 'strike': return `<s>${inline(node.children)}</s>`;
        case 'code': return `<code>${inline(node.children)}</code>`;
        case 'link': return `<span class="link">${inline(node.children)}</span>`;
        case 'math': return `<span>${escapeHtml(p.value ?? '')}${inline(node.children)}</span>`;
        case 'title': return `<div class="title title-${escapeHtml(p.size || 'md')}">${inline(node.children)}</div>`;
        case 'text': {
          const cls = `${p.color === 'secondary' ? ' muted' : ''}${p.size === 'sm' ? ' small' : ''}`;
          return isInline ? `<span class="${cls.trim()}">${inline(node.children)}</span>` : `<p class="t${cls}">${inline(node.children)}</p>`;
        }
        case 'checkbox': return `<div class="cb"><span class="cb-box${p.checked ? ' on' : ''}">${p.checked ? '✓' : ''}</span><span>${inline(node.children)}</span></div>`;
        case 'divider': return '<hr class="hr"/>';
        case 'card': return `<div class="card"${boxStyle(p)}>${walk(node.children)}</div>`;
        case 'box': return `<div class="box"${boxStyle(p)}>${walk(node.children)}</div>`;
        case 'image': return `<div class="img">图片${p.alt ? `：${escapeHtml(p.alt)}` : ''}</div>`;
        case '__chatgptClientDefinedWidget': return '<div class="widget">嵌入应用（已另存为独立 HTML）</div>';
        default: return isInline || inlineTypes.has(node.type) ? kids() : `<div>${walk(node.children)}</div>`;
      }
    }
    return walk(tree);
  }
  // Browser only (sandbox page): lays the card out offscreen and rasterizes it
  // through an SVG foreignObject. The ChatGPT page is never scrolled or captured.
  async function snapshotPng(tree, doc, {scale = 2, waitFonts = true} = {}) {
    const now = () => doc.defaultView.performance.now(), started = now();
    const html = `<div class="dil-root">${toHtml(tree)}</div>`;
    const host = doc.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:720px';
    host.innerHTML = `<style>${CARD_CSS}</style>${html}`;
    doc.body.append(host);
    try {
      if (waitFonts) await doc.fonts?.ready;
      // Lay out at ChatGPT's column width (so width="100%" stays wide), then
      // crop the empty space right of narrower cards such as maxWidth="260px".
      const rootNode = host.querySelector('.dil-root'), rect = rootNode.getBoundingClientRect();
      const right = Math.max(0, ...[...rootNode.children].map(child => child.getBoundingClientRect().right - rect.left));
      // A background tab may not lay the frame out at all; never emit a blank image.
      if (!(rect.width > 0 && rect.height > 0)) throw Error('卡片排版失败（导出时请保持标签页在前台）');
      const width = Math.min(Math.ceil(rect.width), Math.ceil(right) + 10), height = Math.ceil(rect.height);
      const laidOut = now();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml"><style>${CARD_CSS}</style>${html}</div></foreignObject></svg>`;
      // onload rather than image.decode(): decode() waits for a rendering
      // opportunity, which an embedded frame on a busy page may not get soon.
      const image = new doc.defaultView.Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;image.onerror = () => reject(Error('卡片 SVG 无法加载'));
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      const decoded = now();
      const canvas = doc.createElement('canvas');
      canvas.width = width * scale;canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);ctx.fillStyle = '#fff';ctx.fillRect(0, 0, width, height);ctx.drawImage(image, 0, 0);
      const drawn = now();
      // Synchronous encode: canvas.toBlob() waits for browser idle time, which a
      // busy page such as chatgpt.com rarely gives (seen: several seconds).
      const base64 = canvas.toDataURL('image/png').split(',')[1] || '';
      if (!base64) throw Error('卡片图像生成失败');
      const binary = doc.defaultView.atob(base64), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const png = bytes.buffer, done = now(), round = Math.round;
      return {png, width, height, layoutMs:round(laidOut - started), rasterMs:round(done - laidOut), decodeMs:round(decoded - laidOut), drawMs:round(drawn - decoded), encodeMs:round(done - drawn)};
    } finally {host.remove();}
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
  function sandboxClient(doc, src, {timeout = 8000} = {}) {
    const frame = doc.createElement('iframe'), created = performance.now(), stats = {loadMs:null};
    // Offscreen at full size rather than hidden or tiny: cards need real layout
    // to be measured.
    frame.src = src;frame.dataset.archiveOwned = 'dil-sandbox';frame.setAttribute('aria-hidden', 'true');frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;height:600px;border:0;opacity:0;pointer-events:none';
    const ready = new Promise((resolve, reject) => {
      frame.addEventListener('load', () => {stats.loadMs = Math.round(performance.now() - created);resolve();}, {once:true});
      setTimeout(() => reject(Error('界面渲染沙箱未能加载')), timeout);
    });
    ready.catch(noop);
    doc.documentElement.append(frame);
    const request = async (type, dil) => {
      await ready;
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel(), timer = setTimeout(() => {channel.port1.close();reject(Error('界面渲染超时'));}, timeout);
        channel.port1.onmessage = event => {clearTimeout(timer);channel.port1.close();event.data?.error ? reject(Error(event.data.error)) : resolve(event.data);};
        frame.contentWindow.postMessage({type, dil:dil && {code:dil.code, constants:dil.constants, appData:dil.appData}}, '*', [channel.port2]);
      });
    };
    const evaluateRemote = async dil => (await request('dil:evaluate', dil)).tree;
    // Returns {segments:[{kind:'md',tree} | {kind:'card',tree,png,width,height}], timings}.
    evaluateRemote.snapshot = dil => request('dil:snapshot', dil);
    // Loads fonts and draws a tiny card once, while the conversation is still being read.
    evaluateRemote.warmup = () => request('dil:warmup', null);
    evaluateRemote.stats = stats;
    evaluateRemote.close = () => frame.remove();
    return evaluateRemote;
  }
  const api = {evaluate, toMarkdown, segments, toHtml, CARD_CSS, snapshotPng, appBlocks, standaloneHtml, sandboxClient};
  root.ChatExportDilRender = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
