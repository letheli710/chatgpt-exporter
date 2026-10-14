const allowed = url => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url || '');
chrome.action.onClicked.addListener(async tab => {
  if (!allowed(tab.url)) return;
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['jszip.min.js', 'core.js', 'automation.js', 'content.js']});
});
let lastCapture = 0;
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !allowed(sender.url)) return;
  (async () => {
    if (message.type === 'archive:capture') {
      if (Date.now() - lastCapture < 600) throw Error('请稍等一秒再截图');
      lastCapture = Date.now();
      const active = await chrome.tabs.query({active: true, windowId: sender.tab.windowId});
      if (active[0]?.id !== sender.tab.id) throw Error('截图时请保持当前标签页处于前台');
      const data = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {format: 'png'});
      const after = await chrome.tabs.query({active: true, windowId: sender.tab.windowId});
      if (after[0]?.id !== sender.tab.id) throw Error('截图期间标签页发生了切换，请重试');
      return {data};
    }
    if (message.type === 'archive:download') {
      if (!message.url?.startsWith('blob:' + new URL(sender.url).origin + '/')) throw Error('无效的下载地址');
      return {id: await chrome.downloads.download({url: message.url, filename: 'conversation-archive.zip', saveAs: true})};
    }
    throw Error('未知操作');
  })().then(result => reply(result), error => reply({error: error.message}));
  return true;
});
