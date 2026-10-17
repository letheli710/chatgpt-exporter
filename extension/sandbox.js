// Runs only in sandbox.html: an opaque origin with no access to ChatGPT pages,
// cookies or extension APIs, where executing the compiled UI code is allowed.
(function(root) {
  'use strict';
  const execute = (code, scope) => Function(...Object.keys(scope), code)(...Object.values(scope));
  function handle(request) {
    try {return {tree:root.ChatExportDilRender.evaluate(request.dil, execute)};}
    catch (e) {return {error:String(e?.message || e)};}
  }
  // Fonts are awaited once per sandbox, not once per card.
  const fontsReady = new WeakMap();
  const fonts = doc => {if (!fontsReady.has(doc)) fontsReady.set(doc, Promise.resolve(doc.fonts?.ready).then(noop, noop));return fontsReady.get(doc);};
  const noop = () => {};
  const ms = value => Math.round(value);
  async function warmup(doc = root.document) {
    const started = performance.now();
    try {
      await fonts(doc);
      await root.ChatExportDilRender.snapshotPng({type:'card', props:{}, children:[{type:'text', props:{}, children:['预热 Aa 0']}]}, doc, {waitFonts:false});
      return {warmupMs:ms(performance.now() - started)};
    } catch (e) {return {error:String(e?.message || e)};}
  }
  // Each top-level card is drawn offscreen into a PNG, all cards in parallel;
  // prose stays as a tree.
  async function snapshot(request, doc = root.document) {
    try {
      const started = performance.now(), render = root.ChatExportDilRender, tree = render.evaluate(request.dil, execute), evaluated = performance.now();
      await fonts(doc);
      const fontsDone = performance.now();
      const segments = await Promise.all(render.segments(tree).map(async segment => {
        if (segment.kind !== 'card') return segment;
        try {return {...segment, ...await render.snapshotPng(segment.tree, doc, {waitFonts:false})};}
        catch (e) {return {...segment, error:String(e?.message || e)};}
      }));
      const cards = segments.filter(s => s.kind === 'card');
      return {segments, timings:{evaluateMs:ms(evaluated - started), fontsMs:ms(fontsDone - evaluated), cardsMs:ms(performance.now() - fontsDone), cards:cards.length, layoutMs:cards.reduce((t, s) => t + (s.layoutMs || 0), 0), rasterMs:cards.reduce((t, s) => t + (s.rasterMs || 0), 0), decodeMs:cards.reduce((t, s) => t + (s.decodeMs || 0), 0), drawMs:cards.reduce((t, s) => t + (s.drawMs || 0), 0), encodeMs:cards.reduce((t, s) => t + (s.encodeMs || 0), 0), totalMs:ms(performance.now() - started)}};
    } catch (e) {return {error:String(e?.message || e)};}
  }
  root.ChatExportDilSandbox = {handle, snapshot, warmup, execute};
  root.addEventListener?.('message', async event => {
    const port = event.ports?.[0];
    if (!port) return;
    if (event.data?.type === 'dil:evaluate') port.postMessage(handle(event.data));
    else if (event.data?.type === 'dil:warmup') port.postMessage(await warmup());
    else if (event.data?.type === 'dil:snapshot') {
      const result = await snapshot(event.data);
      port.postMessage(result, (result.segments || []).map(s => s.png).filter(Boolean));
    }
  });
})(globalThis);
