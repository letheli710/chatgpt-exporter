const allowed = url => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url || '');
chrome.action.onClicked.addListener(async tab => {
  if (!allowed(tab.url)) return;
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['jszip.min.js', 'fast-text.js', 'dil-render.js', 'fast-content.js']});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !allowed(sender.url)) return;
  (async () => {
    if (message.type === 'archive:download') {
      if (!message.url?.startsWith('blob:' + new URL(sender.url).origin + '/')) throw Error('无效的下载地址');
      const filename=typeof message.filename==='string' && !/[\\/<>:"|?*\x00-\x1f]/.test(message.filename) && /\.(zip|md|json)$/.test(message.filename) ? message.filename : 'conversation-archive.zip';
      return {id: await chrome.downloads.download({url: message.url, filename, saveAs: message.saveAs === true})};
    }
    // Images the server resolved for search results live on images.openai.com,
    // which the page cannot fetch cross-origin; only that host is allowed here.
    if (message.type === 'archive:image') {
      const url = new URL(message.url);
      if (url.protocol !== 'https:' || url.hostname !== 'images.openai.com') throw Error('不支持的图片地址');
      const response = await fetch(url, {credentials: 'omit'});
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw Error('图片过大');
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {type: response.headers.get('content-type') || '', data: btoa(binary)};
    }
    throw Error('未知操作');
  })().then(result => reply(result), error => reply({error: error.message}));
  return true;
});
