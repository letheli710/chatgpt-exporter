# Data-first Exporter 0.7.0

分支 `data-first-export`，基于 `mege-Exporter`（0.6.3）。目标是让含图片和 Intelligent UI 的导出不再依赖滚动和截图。

## 变化

- **ZIP 默认只走数据**：不滚动、不截图，也不要求标签页保持在前台。
  - 正文：会话接口，与之前相同。
  - 原图：`image_asset_pointer`（`file-service://` / `sediment://`）先调用 `/backend-api/files/download/{id}`，404 时改用 `/backend-api/files/{id}/download`，拿到 `download_url` 后并发下载，默认 6 路。
  - Intelligent UI：消息上的 `model_dil_v2` 原样写入 `ui/msg-<id>.json`；正文使用 `fallbackMarkdown`，并附上 `[!chatgpt-ui]` 链接。`appData`/`constants` 里的图片 URL 一并下载，映射记录在 `localAssets` 中。
- **页面补充改为可选**：勾选“从页面补充当前状态与截图”后，走原来 0.6.3 的路径，包括 DOM 补全当前状态、截图和选框补截图。
- **调试：导出原始 JSON**：原样下载会话接口的响应，用来核对 `model_dil_v2` 与图片字段。文件不含登录凭据，但包含对话全文。

## 未验证

- 文件下载接口的路径和返回字段来自公开资料与经验，**尚未在真实账户上验证**。下载失败会在导出文末逐张提示，可以勾选页面补充作为回退。
- `model_dil_v2` 除 `fallbackMarkdown` 以外的字段是否每条都有，需要先用“导出原始 JSON”实际确认。
- 第三方 CDN 图片可能被 CORS 拦截，失败时保留原地址。

## 测试

运行 `node --test tests/*.test.cjs`。新增 `tests/data-first.test.cjs`，共 3 项。完整套件 105 项：70 项通过、33 项失败、2 项跳过，失败的全部是缺少本地私有夹具的那批（与基线相同）。
