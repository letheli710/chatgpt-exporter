# Offline exported-conversation rendering

`render-export.cjs` renders the actual ZIP's `conversation.md` and `assets/` into an offline HTML document, a fixed A4 PDF, one PNG for every PDF page, and contact sheets showing twelve numbered pages each. It does not repair or alter the source Markdown. `manifest.messages` IDs map to `section[data-message-id][data-role]` for independent validation.

Install the optional math dependency from the official npm registry, with lifecycle scripts disabled:

```powershell
npm install --prefix tmp/markdown-renderer --no-audit --no-fund --ignore-scripts katex@0.16.22
node scripts/render-export.cjs 'archive/Output - test 1/0.6.1/项目分析撰写-swift-0.6.1.zip' 'archive/Output - test 1/0.6.1/Swift-Archive-0.6.1-rendered'
node --test tests/render-export.test.cjs
```

The script uses the existing project `marked` dependency. `CODEX_RENDER_NODE_MODULES` can override the bundled runtime modules directory containing `jszip`, `playwright`, `pdfjs-dist`, and `@napi-rs/canvas`. `CHROME_EXECUTABLE` can override the system Chrome executable. Chrome runs a separate temporary headless profile; the user's Chrome session is not used. `--no-pdf` generates HTML without launching Chrome or importing PDF rendering dependencies.

Assets, KaTeX CSS, and KaTeX fonts are embedded. The document's CSP blocks scripts and external resources. Math preserves `annotation[encoding="application/x-tex"]`; the redundant MathML accessibility representation is visually hidden. GFM tables, block quotes, headings, lists, and fenced code use the fixed Markdown renderer; LaTeX supports `\\[...\\]`, `\\(...\\)`, `$$...$$`, and `$...$`. `render-report.json` records dependency versions, message count, formula errors, loaded images, page count, and processing time. A missing formula must remain a visible error rather than silently disappearing.

This render is a reproducible presentation of the export, not evidence by itself that the export matches the live Chat. The block-by-block validator must compare it against separately captured source Chat content, including UI state and original copied code.
