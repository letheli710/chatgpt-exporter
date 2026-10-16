// Runs only in sandbox.html: an opaque origin with no access to ChatGPT pages,
// cookies or extension APIs, where executing the compiled UI code is allowed.
(function(root) {
  'use strict';
  const execute = (code, scope) => Function(...Object.keys(scope), code)(...Object.values(scope));
  function handle(request) {
    try {return {tree:root.ChatExportDilRender.evaluate(request.dil, execute)};}
    catch (e) {return {error:String(e?.message || e)};}
  }
  root.ChatExportDilSandbox = {handle, execute};
  root.addEventListener?.('message', event => {
    if (event.data?.type !== 'dil:evaluate' || !event.ports?.[0]) return;
    event.ports[0].postMessage(handle(event.data));
  });
})(globalThis);
