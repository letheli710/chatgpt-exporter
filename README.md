# ChatGPT Exporter

把 ChatGPT 对话导出为 Markdown 和本地资源包的 Chrome 扩展（Manifest V3），方便归档到 Obsidian 等笔记软件。当前版本 **0.8.14**。

全程在浏览器本地运行，不调用任何 AI 服务，也不把对话上传到第三方。正文、原图和界面数据直接从 ChatGPT 的会话接口读取，不需要滚动页面或截图，长对话通常一秒内导出完，标签页在后台也能完成。

## 能导出什么

- **正文**：保留为可编辑的 Markdown，包括表格、代码块、公式、引用来源链接。
- **图片**：上传的图片、生成的图片、搜索结果插图，均下载原图到 `assets/`。
- **代码解释器**：输出的图表和生成的文件下载到本地，文件放在 `files/`，正文中的链接改为本地路径。
- **界面卡片**（Intelligent UI）：在扩展的沙箱页里离屏画成 PNG，卡片里的文字同时保留在可折叠的引用块中。
- **嵌入应用**（AppBlock，如 WebGL、canvas、动画演示）：运行约 1 秒后截一张预览图，并保留打开原应用的链接。

可以导出整段对话，也可以只勾选部分消息。

## 安装

1. Chrome 地址栏输入 `chrome://extensions`，打开右上角“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本项目的 `extension` 文件夹。
3. 打开 ChatGPT 的一个对话，点击扩展图标，页面上出现导出面板。

**更新代码后**，要在 `chrome://extensions` 里点该扩展的“重新加载”，再刷新 ChatGPT 页面。面板每次点击都会从磁盘读取最新代码，但后台脚本和权限只在重新加载后才更新；两者版本不一致时，面板会提示。

## 使用

- **全选 / 清空 / 勾选**：选择要导出的消息。
- **预览文字**：先看导出的 Markdown。
- **下载 Markdown**：只要正文。
- **下载 ZIP（原图 + 界面数据）**：完整导出，推荐。

ZIP 解压后：

```
<对话标题>-swift-0.8.14/
├── conversation.md    正文
├── assets/            图片、卡片 PNG、AppBlock 预览图
├── files/             代码解释器生成的文件
├── ui/                每条消息的界面原始数据（JSON）
└── manifest.json      导出版本、消息列表、耗时与警告
```

保持 `conversation.md` 和 `assets/` 相邻，图片才能正常显示。

## 尚不支持

非图片附件、其他回答分支等，见 [TODO](TODO.md)。

## 开发

```bash
npm install
npm test
```

- `extension/`：扩展本体。改动扩展时，同步提升 `manifest.json`、`extension/fast-content.js` 和 `package.json` 中的版本号，`tests/version.test.cjs` 会检查三者一致。
- `tests/`：测试。`tests/fixtures/` 是已检查过不含 token 的 Lab 测试对话数据；另有一部分测试读取本地私有样本（`archive/` 下，不提交），缺少时自动跳过。
- `scripts/package.cjs`：`npm run package` 打包到 `releases/`。
- `archive/`：本地归档（旧版本导出、研究记录、历史文档、0.6 时代的页面截图代码与测试），已加入 `.gitignore`，不会推送。

请勿提交 HAR、cookie、Authorization 头、token、原始会话 JSON 或私人对话截图。
