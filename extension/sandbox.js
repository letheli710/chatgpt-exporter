// Runs only in sandbox.html: an opaque origin with no access to ChatGPT pages,
// cookies or extension APIs, where executing the compiled UI code is allowed.
(function(root) {
  'use strict';
  const execute = (code, scope) => Function(...Object.keys(scope), code)(...Object.values(scope));
  function handle(request) {
    try {return {tree:root.ChatExportDilRender.evaluate(request.dil, execute)};}
    catch (e) {return {error:String(e?.message || e)};}
  }
  // Each top-level card is drawn offscreen into a PNG; prose stays as a tree.
  async function snapshot(request, doc = root.document) {
    try {
      const render = root.ChatExportDilRender, tree = render.evaluate(request.dil, execute), segments = [];
      for (const segment of render.segments(tree)) {
        if (segment.kind !== 'card') {segments.push(segment);continue;}
        try {segments.push({...segment, ...await render.snapshotPng(segment.tree, doc)});}
        catch (e) {segments.push({...segment, error:String(e?.message || e)});}
      }
      return {segments};
    } catch (e) {return {error:String(e?.message || e)};}
  }
  root.ChatExportDilSandbox = {handle, snapshot, execute};
  root.addEventListener?.('message', async event => {
    const port = event.ports?.[0];
    if (!port) return;
    if (event.data?.type === 'dil:evaluate') port.postMessage(handle(event.data));
    else if (event.data?.type === 'dil:snapshot') {
      const result = await snapshot(event.data);
      port.postMessage(result, (result.segments || []).map(s => s.png).filter(Boolean));
    }
  });
})(globalThis);
