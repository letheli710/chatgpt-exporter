# Data-first Exporter 0.7.0

分支 `data-first-export`，基于 `mege-Exporter`（0.6.3）。目标是让含图片和 Intelligent UI 的导出不再依赖滚动和截图。

## 变化

- **ZIP 默认只走数据**：不滚动、不截图，也不要求标签页保持在前台。
  - 正文：会话接口，与之前相同。
  - 原图：`image_asset_pointer`（`file-service://` / `sediment://`）先调用 `/backend-api/files/download/{id}`，404 时改用 `/backend-api/files/{id}/download`，拿到 `download_url` 后并发下载，默认 6 路。
  - Intelligent UI：消息上的 `model_dil_v2` 原样写入 `ui/msg-<id>.json`；正文使用 `fallbackMarkdown`，并附上 `[!chatgpt-ui]` 链接。`appData`/`constants` 里的图片 URL 一并下载，映射记录在 `localAssets` 中。
- **页面补充改为可选**：勾选“从页面补充当前状态与截图”后，走原来 0.6.3 的路径，包括 DOM 补全当前状态、截图和选框补截图。
- **调试：导出原始 JSON**：原样下载会话接口的响应，用来核对 `model_dil_v2` 与图片字段。文件不含登录凭据，但包含对话全文。

## 0.7.0 续：静态渲染与 AppBlock

用真实导出 `tests/fixtures/dil-checkbox-longcard-appblock.raw.json` 核对过以下字段：每条 UI 消息都有 `model_dil_v2.code`/`constants`/`appData`；`content.parts` 里是模型写的 DIL 源码；AppBlock 的 HTML 存放在 `metadata.content_references[]`，由 `clientDefinedWidgets[id].refIndex` 关联；`view_state` 为空，说明服务器不保存交互状态。

- **静态渲染**（`dil-render.js` + `sandbox.html`/`sandbox.js`）：读取会话后，在扩展的 sandbox 页面里按默认状态执行 `code`，把组件树转成 Markdown，替换会丢内容的 `fallbackMarkdown`。真实样本中，`{#each}` 生成的 30 行和“当前值：**关**”都能还原。sandbox 页面是不透明源，拿不到 ChatGPT 的 cookie，也调用不了扩展 API。遇到不认识的组件只保留其中的文字；渲染失败时退回 `fallbackMarkdown`，并在文末提示。勾选“页面补充”时仍走 0.6.3 的路径。
- **AppBlock**：每个嵌入应用另存为 `ui/appblock-<消息>-<id>.html`，可以直接打开交互。正文里在它出现的位置放链接；默认状态下不显示的（例如藏在复选框后面），列在 `[!chatgpt-ui]` 提示块里。
- **ui/msg-*.json** 现在包含：`source`（DIL 源码）、`staticMarkdown`、`renderError`、`appBlocks`、`dil`（完整 `model_dil_v2`）、`contentReferences`、`localAssets`。

## 未验证

- 文件下载接口的路径和返回字段来自公开资料与经验，**尚未在真实账户上验证**。下载失败会在导出文末逐张提示，可以勾选页面补充作为回退。
- sandbox iframe 能否在 chatgpt.com 页面里加载（页面 CSP），尚未在真实浏览器中验证；加载失败时退回 fallbackMarkdown。
- 第三方 CDN 图片可能被 CORS 拦截，失败时保留原地址。

## 测试

运行 `node --test tests/*.test.cjs`。新增 `tests/data-first.test.cjs`（3 项）和 `tests/dil-render.test.cjs`（6 项，基于真实夹具）。完整套件 111 项：76 项通过、33 项失败、2 项跳过，失败的全部是缺少本地私有夹具的那批（与基线相同）。
