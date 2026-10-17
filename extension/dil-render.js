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
    return resolveWidgets(plain(tree), dil);
  }
  // Code blocks and some charts are client-defined widgets whose content lives
  // in content_references (linked by clientDefinedWidgets[id].refIndex).
  // AppBlocks stay as widget nodes; they are exported as standalone HTML.
  function widgetNode(invocationId, dil) {
    const ref = (Array.isArray(dil?.contentReferences) ? dil.contentReferences : [])[dil?.clientDefinedWidgets?.[invocationId]?.refIndex];
    const data = ref?.data, kind = data?.widget_type || ref?.category;
    if (kind === 'code_block' && typeof data?.content === 'string') return {type:'code-block', props:{language:typeof data.language === 'string' ? data.language : '', value:data.content}, children:[]};
    if ((ref?.category === 'visualization' || kind === 'visualization') && data?.content && typeof data.content === 'object') {
      const c = data.content, pie = c.chartType === 'pie', kids = [];
      if (c.meta?.title) kids.push({type:'text', props:{weight:'semibold'}, children:[String(c.meta.title)]});
      if (c.meta?.description) kids.push({type:'text', props:{size:'sm', color:'secondary'}, children:[String(c.meta.description)]});
      kids.push({type:pie ? 'pie-chart' : 'chart', props:{data:c.data, series:c.series, xAxis:pie ? c.nameKey || c.xKey : {dataKey:c.xKey}, showDots:c.chartType === 'line', height:280}, children:[]});
      if (c.meta?.footer) kids.push({type:'text', props:{size:'sm', color:'tertiary'}, children:[String(c.meta.footer)]});
      return {type:'box', props:{border:true, radius:'xl', padding:3, gap:2}, children:kids};
    }
    return null;
  }
  function resolveWidgets(node, dil) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(n => resolveWidgets(n, dil));
    if (node.type === '__chatgptClientDefinedWidget') return widgetNode(node.props?.invocationId, dil) || node;
    return {...node, children:(node.children || []).map(n => resolveWidgets(n, dil))};
  }
  // Markdown-native constructs stay text; everything else is UI drawn as an image.
  const inlineTypes = new Set(['bold','italic','code','link','strike','math','badge','icon']);
  const textOf = node => node == null || node === false || node === true ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : textOf(node.children);
  const isInlineNode = node => node != null && (typeof node !== 'object' || (!Array.isArray(node) && inlineTypes.has(node.type) && !(node.type === 'math' && node.props?.block)));
  const UI_CONTAINERS = new Set(['box','card','row','grid','grid-item']);
  const headingLevel = {'3xl':1, '2xl':1, xl:1, lg:2, md:3, sm:4, xs:5};
  const optionLabel = (options, value) => {const hit = (Array.isArray(options) ? options : []).find(o => (o && typeof o === 'object' ? o.value : o) === value);return hit && typeof hit === 'object' ? hit.label ?? hit.value : hit ?? value ?? '';};
  const formatNumber = value => typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value ?? '');
  function chartModel(p, pie) {
    const rows = Array.isArray(p.data) ? p.data.filter(r => r && typeof r === 'object') : [];
    const xKey = typeof p.xAxis === 'string' ? p.xAxis : p.xAxis?.dataKey || p.nameKey || Object.keys(rows[0] || {})[0];
    let series = (Array.isArray(p.series) ? p.series : []).filter(s => s && s.dataKey);
    if (!series.length && rows[0]) series = Object.keys(rows[0]).filter(k => k !== xKey && typeof rows[0][k] === 'number').map(dataKey => ({dataKey}));
    return {rows, xKey, series:pie ? series.slice(0, 1) : series};
  }
  function toMarkdown(tree, {widget = id => `〔嵌入应用 ${id}〕`} = {}) {
    const cell = s => s.replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, '<br>').trim();
    function inline(node) {
      if (node == null || node === false || node === true) return '';
      if (typeof node !== 'object') return String(node);
      if (Array.isArray(node)) return node.map(inline).join('');
      const p = node.props || {};
      switch (node.type) {
        case 'bold': return `**${inline(node.children)}**`;
        case 'italic': return `*${inline(node.children)}*`;
        case 'strike': return `~~${inline(node.children)}~~`;
        case 'code': return `\`${inline(node.children)}\``;
        case 'link': return `[${inline(node.children)}](${p.href || p.url || ''})`;
        case 'math': return `$${p.value ?? inline(node.children)}$`;
        case 'badge': return `［${inline(node.children)}］`;
        case 'icon': case 'button': return '';
        default: return inline(node.children);
      }
    }
    // Consecutive inline children form one paragraph; block children are separate.
    function blocks(children, depth, ui) {
      const out = [];let run = [];
      const flush = () => {const text = inline(run).trim();if (text) out.push(text);run = [];};
      for (const child of [].concat(children ?? [])) {
        if (isInlineNode(child)) {run.push(child);continue;}
        flush();const text = block(child, depth, ui);if (text && text.trim()) out.push(text.trim());
      }
      flush();
      return out.join('\n\n');
    }
    function table(node) {
      const rows = (node.children || []).filter(r => r?.type === 'table-row').map(r => (r.children || []).filter(c => c?.type === 'table-cell'));
      if (!rows.length) return '';
      const width = Math.max(...rows.map(r => r.length)), hasHeader = rows[0].some(c => c.props?.header);
      const fill = r => {const out = r.map(c => cell(blocks(c.children)));while (out.length < width) out.push('');return out;};
      const body = hasHeader ? rows.slice(1) : rows;
      const aligns = Array.from({length:width}, (_, i) => (body.find(r => r[i]) || rows[0])[i]?.props?.align);
      const line = cells => `| ${cells.join(' | ')} |`;
      return [line(hasHeader ? fill(rows[0]) : Array(width).fill(' ')), line(aligns.map(a => a === 'end' || a === 'right' ? '---:' : a === 'center' ? ':---:' : '---')), ...body.map(r => line(fill(r)))].join('\n');
    }
    function list(node, depth) {
      const numbered = node.props?.marker === 'number';let n = 0;
      return (node.children || []).filter(i => i?.type === 'list-item').map(item => {
        const marker = numbered ? `${++n}.` : '-', pad = ' '.repeat(marker.length + 1);
        const kids = item.children || [], own = blocks(kids.filter(c => c?.type !== 'list'), depth).replace(/\n\n+/g, '\n');
        const nested = kids.filter(c => c?.type === 'list').map(l => list(l, depth + 1).split('\n').map(x => pad + x).join('\n'));
        // A checkbox item is a task-list item, not a bullet holding a checkbox.
        const first = `${marker} ${own.split('\n').join(`\n${pad}`)}`.replace(/^(-|\d+\.) - \[( |x)\] /, (_, m, x) => `${m} [${x}] `);
        return [first, ...nested].join('\n');
      }).join('\n');
    }
    function chartTable(p, pie) {
      const {rows, xKey, series} = chartModel(p, pie);
      if (!rows.length || !series.length) return '〔图表：无数据〕';
      const head = [xKey, ...series.map(s => s.label || s.dataKey)].map(String).map(cell);
      return [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => i ? '---:' : '---').join(' | ')} |`, ...rows.map(r => `| ${[r[xKey], ...series.map(s => `${formatNumber(r[s.dataKey])}${s.valueSuffix || ''}`)].map(v => cell(String(v ?? ''))).join(' | ')} |`)].join('\n');
    }
    // ui: inside a UI container, where titles are emphasis rather than headings.
    function block(node, depth = 0, ui = false) {
      if (node == null || node === false || node === true) return '';
      if (typeof node !== 'object') return String(node);
      if (Array.isArray(node)) return blocks(node, depth, ui);
      const p = node.props || {}, inUi = ui || UI_CONTAINERS.has(node.type);
      switch (node.type) {
        case 'text': case 'caption': return inline(node.children);
        case 'title': return ui ? `**${inline(node.children)}**` : `${'#'.repeat(headingLevel[p.size] || 3)} ${inline(node.children)}`;
        case 'math': return p.block ? `$$\n${p.value ?? ''}\n$$` : `$${p.value ?? ''}$`;
        case 'code-block': {const value = String(p.value ?? '').replace(/^\n+|\n+$/g, ''), fence = '`'.repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), m => m[0].length + 1)));return `${fence}${/^[\w+#.-]+$/.test(p.language) ? p.language : ''}\n${value}\n${fence}`;}
        case 'divider': return '---';
        case 'table': return table(node);
        case 'list': return list(node, depth);
        case 'blockquote': return blocks(node.children, depth, ui).split('\n').map(l => l ? `> ${l}` : '>').join('\n');
        case 'checkbox': return `- [${p.checked ? 'x' : ' '}] ${inline(node.children)}`;
        case 'radio-group': return (node.children || []).filter(r => r?.type === 'radio').map(r => `- ${String(r.props?.value) === String(p.value) ? '(•)' : '( )'} ${inline(r.children)}`).join('\n');
        case 'slider': return `滑块：${formatNumber(p.value)}（${formatNumber(p.min ?? 0)}–${formatNumber(p.max ?? 100)}）`;
        case 'segmented-control': return `选项：${(Array.isArray(p.options) ? p.options : []).map(o => {const label = optionLabel([o], o?.value ?? o);return (o?.value ?? o) === p.value ? `**${label}**` : label;}).join(' / ')}`;
        case 'select': return `下拉选择：${optionLabel(p.options, p.value)}`;
        case 'image': return p.src ? `![${p.alt || ''}](${p.src})` : '';
        case 'chart': return chartTable(p, false);
        case 'pie-chart': return chartTable(p, true);
        case 'svg': {const labels = [];(function collect(n) {if (!n || typeof n !== 'object') return;if (Array.isArray(n)) return n.forEach(collect);if (n.type === 'text' || n.type === 'tspan') {const t = textOf(n).trim();if (t) labels.push(t);return;}collect(n.children);})(node.children);return labels.length ? `〔图示：${labels.join(' · ')}〕` : '〔图示〕';}
        case 'row': {const parts = (node.children || []).map(c => isInlineNode(c) ? inline(c).trim() : block(c, depth, true).trim()).filter(Boolean);return parts.every(x => !x.includes('\n')) ? parts.join(' · ') : parts.join('\n\n');}
        case '__chatgptClientDefinedWidget': return widget(p.invocationId);
        default: return isInlineNode(node) ? inline(node) : blocks(node.children, depth, inUi);
      }
    }
    return block(tree).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Top-level prose and Markdown constructs stay Markdown; every other
  // top-level component (box, card, grid, chart, ...) becomes a card image.
  const proseTypes = new Set(['code-block','text','title','divider','bold','italic','strike','code','link','math','caption','table','list','blockquote','__chatgptClientDefinedWidget']);
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
  // Tokens measured on chatgpt.com (Oct 2026); an approximation, not a pixel copy.
  const CARD_CSS = `.dil-root{display:block;width:700px;padding:10px;box-sizing:border-box;font:16px/26px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#0d0d0d;background:#fff}
.dil-root *{box-sizing:border-box}.dil-root p{margin:0}
.card{display:flex;flex-direction:column;gap:12px;border:1px solid rgba(13,13,13,.1);border-radius:16px;padding:12px;background:#fff}
.box{display:flex;flex-direction:column;min-width:0}.row{display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0}
.grid{display:grid;gap:8px}[data-fill]{align-self:stretch}.grid-item{display:flex;flex-direction:column;min-width:0}.grid-item>*{flex:1 1 auto}
.fs-2xs{font-size:11px;line-height:14px}.fs-xs{font-size:12px;line-height:16px}.fs-sm{font-size:14px;line-height:20px}.fs-md{font-size:16px;line-height:26px}.fs-lg{font-size:18px;line-height:28px}.fs-xl{font-size:20px;line-height:28px}
.fw-regular{font-weight:400}.fw-medium{font-weight:500}.fw-semibold{font-weight:600}.fw-bold{font-weight:700}
.c-secondary{color:#5d5d5d}.c-tertiary{color:#8f8f8f}.c-success{color:#2f8f46}.c-danger{color:#e02e2a}.c-warning{color:#d25e28}.c-accent,.c-info{color:#3a83f7}.tnum{font-variant-numeric:tabular-nums}
.title{font-weight:600}.ts-xs{font-size:12px;line-height:16px}.ts-sm{font-size:14px;line-height:20px}.ts-md{font-size:16px;line-height:26px}.ts-lg{font-size:18px;line-height:28px}.ts-xl{font-size:20px;line-height:28px}.ts-2xl{font-size:24px;line-height:32px}.ts-3xl{font-size:30px;line-height:38px}
.caption{font-size:14px;line-height:18px;color:#5d5d5d}
.cb{display:flex;align-items:center;gap:8px}.cb-box{flex:none;width:16px;height:16px;border:1.5px solid #8f8f8f;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#fff}.cb-box.on{background:#0d0d0d;border-color:#0d0d0d}
.radios{display:flex;flex-direction:column;gap:8px}.radios.dir-row{flex-direction:row;flex-wrap:wrap;gap:16px}.rb{flex:none;width:16px;height:16px;border:1.5px solid #8f8f8f;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}.rb.on{border-color:#0d0d0d}.rb-dot{width:8px;height:8px;border-radius:50%;background:#0d0d0d}
.hr{border:0;border-top:1px solid rgba(13,13,13,.1);margin:4px 0;width:100%}
.tbl{width:100%;border-collapse:collapse;font-size:14px;line-height:20px}.tbl th,.tbl td{padding:8px 8px 8px 0;text-align:left;vertical-align:top;border-bottom:1px solid rgba(13,13,13,.05)}.tbl th{font-weight:600;border-bottom-color:rgba(13,13,13,.1)}.tbl tr:last-child td{border-bottom:0}
.lst{margin:0;padding-left:28px}.lst li{margin:2px 0}.bq{margin:0;padding-left:16px;border-left:3px solid #e3e3e3;color:#5d5d5d}
.badge{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:9999px;font-size:12px;line-height:20px;font-weight:500;background:#f3f3f3;color:#5d5d5d;white-space:nowrap}.b-success{background:rgba(4,184,76,.15);color:#3a843f}.b-danger{background:#fff0f0;color:#e02e2a}.b-warning{background:#fdf5f1;color:#d25e28}.b-info,.b-accent{background:#e8f1fe;color:#2c67c5}
.icon{display:inline-flex;align-items:center;justify-content:center;width:1em;line-height:1}
.btn{display:inline-flex;align-items:center;gap:4px;border-radius:9999px;font-size:14px;line-height:20px;font-weight:500;padding:5px 12px;white-space:nowrap;background:#0d0d0d;color:#fff;border:1px solid transparent}.btn-sm{padding:3px 10px;font-size:13px}.btn-lg{padding:8px 16px}.btn-secondary{background:#f3f3f3;color:#0d0d0d}.btn-outline{background:#fff;color:#0d0d0d;border-color:rgba(13,13,13,.15)}.btn-ghost{background:transparent;color:#0d0d0d}
.slider{position:relative;height:20px;width:100%}.slider-track{position:absolute;left:0;right:0;top:8px;height:4px;border-radius:9999px;background:#e3e3e3}.slider-fill{position:absolute;left:0;top:8px;height:4px;border-radius:9999px;background:#0d0d0d}.slider-thumb{position:absolute;top:2px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:#fff;border:1px solid rgba(13,13,13,.15);box-shadow:0 1px 3px rgba(0,0,0,.2)}
.seg{display:inline-flex;gap:2px;padding:2px 0}.seg-block{display:flex;width:100%}.seg-block .seg-opt{flex:1;text-align:center}.seg-opt{padding:6px 16px;border-radius:9999px;font-size:14px;line-height:20px;font-weight:500;color:#5d5d5d;white-space:nowrap}.seg-opt.on{background:#f3f3f3;color:#0d0d0d}
.select{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px;border:1px solid rgba(13,13,13,.15);border-radius:8px;font-size:14px;background:#fff;white-space:nowrap}
.codeblk{margin:0;padding:10px 12px;background:#f9f9f9;border-radius:10px;overflow:hidden;white-space:pre-wrap;font:13px/1.5 ui-monospace,Consolas,monospace}.codeblk code{background:none;padding:0;font-size:inherit}
.math{font-family:"Cambria Math","Times New Roman",serif;font-style:italic}.math-block{display:block;text-align:center}
code{font-family:ui-monospace,Consolas,monospace;background:#f3f3f3;border-radius:4px;padding:0 4px;font-size:.9em}.link{color:#2964aa;text-decoration:underline}
.widget,.img{border:1px dashed #c9c9c9;border-radius:10px;padding:10px 12px;color:#5d5d5d;font-size:13px}`;
  const RADIUS = {none:'0', xs:'4px', sm:'6px', md:'8px', lg:'10px', xl:'16px', '2xl':'20px', full:'9999px'};
  const BACKGROUND = {surface:'#fff', 'surface-primary':'#fff', 'surface-secondary':'#f9f9f9', 'surface-tertiary':'#f3f3f3', 'surface-elevated':'#fff', success:'#def3e5', danger:'#fff0f0', warning:'#fdf5f1', info:'#e8f1fe'};
  const JUSTIFY = {start:'flex-start', end:'flex-end', center:'center', between:'space-between', around:'space-around', evenly:'space-evenly'};
  const ALIGN = {start:'flex-start', end:'flex-end', center:'center', stretch:'stretch', baseline:'baseline'};
  const safeCss = value => typeof value === 'string' && /^[\w#.,()%\s/+-]+$/.test(value) ? value : null;
  const cssLength = value => typeof value === 'number' ? `${value * 4}px` : /^[\d.]+(px|%|rem|em)?$/.test(String(value)) ? String(value) : null;
  function boxStyle(p) {
    const s = [], length = v => typeof v === 'number' ? `${v * 4}px` : safeCss(v);
    for (const [prop, css] of [['maxWidth','max-width'],['width','width'],['minWidth','min-width'],['height','height'],['maxHeight','max-height'],['minHeight','min-height']]) {const v = p[prop] != null && (typeof p[prop] === 'number' ? `${p[prop]}px` : safeCss(p[prop]));if (v) s.push(`${css}:${v}`);}
    if (p.gap != null && length(p.gap)) s.push(`gap:${length(p.gap)}`);
    if (typeof p.padding === 'number' || typeof p.padding === 'string') {const v = length(p.padding);if (v) s.push(`padding:${v}`);}
    else if (p.padding && typeof p.padding === 'object') s.push(`padding:${(p.padding.y ?? p.padding.top ?? 0) * 4}px ${(p.padding.x ?? p.padding.right ?? 0) * 4}px`);
    if (p.radius != null) {const v = RADIUS[p.radius] ?? (p.radius === true ? RADIUS.md : cssLength(p.radius));if (v) s.push(`border-radius:${v}`);}
    if (p.border) s.push('border:1px solid rgba(13,13,13,.1)');
    if (p.background != null) {const v = BACKGROUND[p.background] ?? safeCss(p.background);if (v) s.push(`background:${v}`);}
    if (p.align && ALIGN[p.align]) s.push(`align-items:${ALIGN[p.align]}`);
    if (p.justify && JUSTIFY[p.justify]) s.push(`justify-content:${JUSTIFY[p.justify]}`);
    if (p.clip) s.push('overflow:hidden');
    if (p.wrap) s.push('flex-wrap:wrap');
    if (p.flex != null) {const n = Number(p.flex);if (Number.isFinite(n)) s.push(`flex:${n} 1 0%;min-width:0`);}
    if (typeof p.columns === 'number') s.push(`grid-template-columns:repeat(${Math.max(1, Math.min(12, Math.round(p.columns)))},minmax(0,1fr))`);
    if (p.textAlign && ['left','right','center','start','end'].includes(p.textAlign)) s.push(`text-align:${p.textAlign}`);
    return s.length ? ` style="${s.join(';')}"` : '';
  }
  const textClasses = (p, base) => {
    const c = [base];
    if (p.size) c.push(`${base === 'title' ? 'ts' : 'fs'}-${String(p.size).replace(/[^\w-]/g, '')}`);
    if (p.weight) c.push(`fw-${String(p.weight).replace(/[^\w-]/g, '')}`);
    const color = p.color ?? (p.secondary ? 'secondary' : p.success ? 'success' : p.danger ? 'danger' : null);
    if (color && /^[a-z-]+$/.test(color)) c.push(`c-${color}`);
    if (p.tabularNums) c.push('tnum');
    return c.filter(Boolean).join(' ');
  };
  const textStyle = p => {const s = [];if (p.color && !/^[a-z-]+$/.test(p.color) && safeCss(p.color)) s.push(`color:${p.color}`);if (p.textAlign && ['left','right','center','start','end'].includes(p.textAlign)) s.push(`text-align:${p.textAlign}`);if (p.preserveWhitespace) s.push('white-space:pre-wrap');return s.length ? ` style="${s.join(';')}"` : '';};
  const ICONS = {'rotate-ccw':'↺', 'refresh-cw':'↻', check:'✓', 'check-circle':'✓', 'circle-check':'✓', x:'✕', 'x-circle':'✕', 'circle-x':'✕', 'alert-triangle':'⚠', 'alert-circle':'!', info:'ⓘ', 'arrow-right':'→', 'arrow-left':'←', 'arrow-up':'↑', 'arrow-down':'↓', plus:'+', minus:'−', star:'★', sun:'☀', zap:'⚡', battery:'▭', clock:'◷'};
  // SVG elements and attributes that are written camelCase in SVG itself.
  const SVG_TAGS = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','defs','marker','linearGradient','radialGradient','stop','clipPath','pattern','use','title']);
  const SVG_CAMEL = new Set(['viewBox','markerWidth','markerHeight','refX','refY','preserveAspectRatio','gradientUnits','gradientTransform','patternUnits','patternContentUnits','markerUnits','startOffset','textLength','lengthAdjust','clipPathUnits']);
  function svgAttrs(p, isRoot) {
    const out = [];
    for (const [key, value] of Object.entries(p)) {
      if (['key','xmlns','children','style'].includes(key) || value == null || typeof value === 'object') continue;
      const name = key === 'className' ? 'class' : SVG_CAMEL.has(key) ? key : key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
      if (!/^[a-z][\w:-]*$/i.test(name)) continue;
      out.push(` ${name}="${escapeHtml(value)}"`);
    }
    if (isRoot) out.push(' xmlns="http://www.w3.org/2000/svg" style="display:block;max-width:100%;height:auto"');
    return out.join('');
  }
  const PALETTE = ['#3a83f7','#53b559','#ee7c37','#924ff7','#cf6194','#d2a02b'];
  function chartSvg(p, pie) {
    const {rows, xKey, series} = chartModel(p, pie), W = 640, H = Math.max(180, Math.min(480, Number(p.height) || 280));
    const color = (s, i) => safeCss(s?.color) || safeCss(s?.fill) || PALETTE[i % PALETTE.length];
    const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="display:block;height:auto" font-size="12" fill="#5d5d5d">${body}</svg>`;
    if (!rows.length || !series.length) return '<div class="widget">图表（无数据）</div>';
    if (pie) {
      const s = series[0], values = rows.map(r => Math.max(0, Number(r[s.dataKey]) || 0)), total = values.reduce((a, b) => a + b, 0) || 1;
      const cx = H / 2, cy = H / 2, r = H / 2 - 16;let angle = -Math.PI / 2, out = '';
      values.forEach((v, i) => {
        const next = angle + v / total * Math.PI * 2, large = next - angle > Math.PI ? 1 : 0;
        const [x1, y1, x2, y2] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle), cx + r * Math.cos(next), cy + r * Math.sin(next)];
        out += v >= total ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % PALETTE.length]}"/>` : `<path d="M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#fff" stroke-width="2"/>`;
        angle = next;
      });
      rows.forEach((row, i) => {out += `<rect x="${H + 24}" y="${24 + i * 22}" width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="${H + 40}" y="${33 + i * 22}" fill="#0d0d0d">${escapeHtml(row[xKey])}：${escapeHtml(formatNumber(values[i]))}${escapeHtml(s.valueSuffix || '')}（${Math.round(values[i] / total * 100)}%）</text>`;});
      return svg(out);
    }
    const line = p.showDots === true || series.some(s => s.type === 'line' || s.chartType === 'line');
    const values = rows.flatMap(r => series.map(s => Number(r[s.dataKey]))).filter(Number.isFinite);
    let min = Math.min(0, ...values), max = Math.max(0, ...values);if (max === min) max = min + 1;
    const rough = (max - min) / 4, mag = 10 ** Math.floor(Math.log10(rough)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= rough);
    min = Math.floor(min / step) * step;max = Math.ceil(max / step) * step;
    const L = 48, R = 12, T = 30, B = 30, plotW = W - L - R, plotH = H - T - B, y = v => T + (max - v) / (max - min) * plotH, band = plotW / rows.length;
    let out = '';
    for (let v = min; v <= max + step / 2; v += step) out += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(13,13,13,${Math.abs(v) < step / 1e6 ? '.25' : '.08'})"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(formatNumber(v))}</text>`;
    const every = Math.ceil(rows.length / 12);
    rows.forEach((row, i) => {if (i % every === 0) out += `<text x="${(L + band * (i + .5)).toFixed(1)}" y="${H - 10}" text-anchor="middle">${escapeHtml(String(row[xKey] ?? ''))}</text>`;});
    series.forEach((s, si) => {
      if (line) {
        const pts = rows.map((row, i) => [L + band * (i + .5), y(Number(row[s.dataKey]) || 0)]);
        out += `<polyline points="${pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')}" fill="none" stroke="${color(s, si)}" stroke-width="2"/>`;
        if (rows.length <= 40) out += pts.map(([a, b]) => `<circle cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="3" fill="${color(s, si)}"/>`).join('');
      } else {
        const group = band * .7, w = group / series.length;
        rows.forEach((row, i) => {const v = Number(row[s.dataKey]) || 0, top = y(Math.max(v, 0)), bottom = y(Math.min(v, 0));out += `<rect x="${(L + band * i + (band - group) / 2 + w * si).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, w - 2).toFixed(1)}" height="${Math.max(1, bottom - top).toFixed(1)}" rx="2" fill="${color(s, si)}"/>`;});
      }
      out += `<rect x="${L + si * 120}" y="6" width="10" height="10" rx="2" fill="${color(s, si)}"/><text x="${L + si * 120 + 16}" y="15" fill="#0d0d0d">${escapeHtml(s.label || s.dataKey)}</text>`;
    });
    return svg(out);
  }
  // Well-formed XHTML, so it can be embedded in an SVG foreignObject.
  function toHtml(tree) {
    function walk(node, ctx = {}) {
      if (node == null || node === false || node === true) return '';
      if (typeof node !== 'object') return escapeHtml(node);
      if (Array.isArray(node)) return node.map(n => walk(n, ctx)).join('');
      const p = node.props || {}, kids = (c = ctx) => walk(node.children, c), inline = () => walk(node.children, {...ctx, inline:true});
      if (ctx.svg) {
        if (!SVG_TAGS.has(node.type)) return kids();
        return `<${node.type}${svgAttrs(p, false)}>${kids()}</${node.type}>`;
      }
      switch (node.type) {
        case 'svg': return `<svg${svgAttrs(p, true)}>${kids({svg:true})}</svg>`;
        case 'bold': return `<strong>${inline()}</strong>`;
        case 'italic': return `<em>${inline()}</em>`;
        case 'strike': return `<s>${inline()}</s>`;
        case 'code': return `<code>${inline()}</code>`;
        case 'link': return `<span class="link">${inline()}</span>`;
        case 'math': return p.block ? `<div class="math math-block">${escapeHtml(p.value ?? '')}</div>` : `<span class="math">${escapeHtml(p.value ?? '')}${inline()}</span>`;
        case 'title': return `<div class="${textClasses(p, 'title')}"${textStyle(p)}>${inline()}</div>`;
        case 'text': return ctx.inline || p.inline ? `<span class="${textClasses(p, 't')}"${textStyle(p)}>${inline()}</span>` : `<p class="${textClasses(p, 't')}"${textStyle(p)}>${inline()}</p>`;
        case 'caption': return ctx.inline ? `<span class="caption">${inline()}</span>` : `<p class="caption"${textStyle(p)}>${inline()}</p>`;
        case 'checkbox': return `<div class="cb"><span class="cb-box${p.checked ? ' on' : ''}">${p.checked ? '✓' : ''}</span><span>${inline()}</span></div>`;
        case 'radio-group': return `<div class="radios${p.direction === 'row' ? ' dir-row' : ''}">${kids({...ctx, radio:String(p.value ?? '')})}</div>`;
        case 'radio': {const on = ctx.radio !== undefined && String(p.value) === ctx.radio;return `<div class="cb"><span class="rb${on ? ' on' : ''}">${on ? '<span class="rb-dot"></span>' : ''}</span><span>${inline()}</span></div>`;}
        case 'divider': return '<hr class="hr"/>';
        case 'code-block': return `<pre class="codeblk"><code>${escapeHtml(String(p.value ?? '').replace(/^\n+|\n+$/g, ''))}</code></pre>`;
        case 'card': return `<div class="card"${boxStyle(p)}>${kids()}</div>`;
        case 'box': case 'row': case 'grid': case 'grid-item': {
          // An empty box is a bar segment or swatch: fill the row's height.
          const fill = !(node.children || []).some(c => c != null && c !== false && c !== '') && p.height == null ? ' data-fill="1"' : '';
          return `<div class="${node.type}"${fill}${boxStyle(p)}>${kids({...ctx, inline:false})}</div>`;
        }
        case 'table': return `<table class="tbl"><tbody>${kids()}</tbody></table>`;
        case 'table-row': return `<tr>${kids()}</tr>`;
        case 'table-cell': {const tag = p.header ? 'th' : 'td', align = p.align === 'end' || p.align === 'right' ? 'right' : p.align === 'center' ? 'center' : null;return `<${tag}${align ? ` style="text-align:${align}"` : ''}>${kids({...ctx, inline:false})}</${tag}>`;}
        case 'list': {const tag = p.marker === 'number' ? 'ol' : 'ul';return `<${tag} class="lst">${kids()}</${tag}>`;}
        case 'list-item': return `<li>${kids({...ctx, inline:false})}</li>`;
        case 'blockquote': return `<blockquote class="bq">${kids()}</blockquote>`;
        case 'badge': return `<span class="badge b-${String(p.color || 'default').replace(/[^\w-]/g, '')}">${inline()}</span>`;
        case 'icon': return `<span class="icon${p.color ? ` c-${String(p.color).replace(/[^\w-]/g, '')}` : ''}">${ICONS[p.name] || '•'}</span>`;
        case 'button': return `<span class="btn btn-${String(p.size || 'md').replace(/[^\w-]/g, '')} btn-${String(p.variant === 'outline' || p.variant === 'ghost' ? p.variant : p.color || 'primary').replace(/[^\w-]/g, '')}">${inline()}</span>`;
        case 'slider': {const min = Number(p.min ?? 0), max = Number(p.max ?? 100), pct = max > min ? Math.max(0, Math.min(100, (Number(p.value ?? min) - min) / (max - min) * 100)) : 0;return `<div class="slider"><div class="slider-track"></div><div class="slider-fill" style="width:${pct.toFixed(2)}%"></div><div class="slider-thumb" style="left:${pct.toFixed(2)}%"></div></div>`;}
        case 'segmented-control': return `<div class="seg${p.block ? ' seg-block' : ''}">${(Array.isArray(p.options) ? p.options : []).map(o => {const value = o && typeof o === 'object' ? o.value : o;return `<span class="seg-opt${value === p.value ? ' on' : ''}">${escapeHtml(optionLabel([o], value))}</span>`;}).join('')}</div>`;
        case 'select': return `<span class="select"><span>${escapeHtml(optionLabel(p.options, p.value))}</span><span class="c-secondary">▾</span></span>`;
        case 'chart': return chartSvg(p, false);
        case 'pie-chart': return chartSvg(p, true);
        case 'image': return `<div class="img">图片${p.alt ? `：${escapeHtml(p.alt)}` : ''}</div>`;
        case '__chatgptClientDefinedWidget': return '<div class="widget">嵌入应用（已另存为独立 HTML）</div>';
        default: return ctx.inline || inlineTypes.has(node.type) ? inline() : `<div>${kids()}</div>`;
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
        frame.contentWindow.postMessage({type, dil:dil && {code:dil.code, constants:dil.constants, appData:dil.appData, clientDefinedWidgets:dil.clientDefinedWidgets, contentReferences:dil.contentReferences}}, '*', [channel.port2]);
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
