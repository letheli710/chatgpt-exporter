// Independent acceptance checker for the user's real R01–R09 conversation.
// Usage: node scripts/validate-fast-export.cjs <download.md|download.zip> <report.json|report.md>
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');
const { marked } = require('marked');
const JSZip = require('../extension/jszip.min.js');
const core = require('../extension/core');
const root = path.resolve(__dirname, '..');
const sourceUrl = 'https://chatgpt.com/c/6acd9282-acbc-83e9-bbb4-51aace07323c';
const norm = text => text.replace(/\s+/g, '');

function messages(markdown) {
  const matches = [...markdown.matchAll(/^## (我|ChatGPT|用户|助手|User|Assistant)\s*$/gm)];
  return matches.map((m, i) => ({ role: /^(我|用户|User)$/.test(m[1]) ? 'user' : 'assistant', body: markdown.slice(m.index + m[0].length, matches[i + 1]?.index ?? markdown.length) }));
}

function pngInfo(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid PNG signature');
  let width, height, bitDepth, colorType, interlace;
  const data = []; let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (end > bytes.length) throw new Error('Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    if (type === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); bitDepth = chunk[8]; colorType = chunk[9]; interlace = chunk[12]; }
    if (type === 'IDAT') data.push(chunk);
    if (type === 'IEND') { ended = true; break; }
    offset = end;
  }
  if (!ended || !width || !height || !data.length) throw new Error('Incomplete PNG');
  const pixels = zlib.inflateSync(Buffer.concat(data));
  const channels = {0:1,2:3,3:1,4:2,6:4}[colorType];
  if (!channels) throw new Error('Unknown PNG color type');
  if (!interlace) {
    const stride = Math.ceil(width * channels * bitDepth / 8) + 1;
    if (pixels.length !== stride * height) throw new Error('PNG pixel length mismatch');
    for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) throw new Error('Invalid PNG row filter');
  }
  return { width, height, bitDepth, colorType, decodedBytes: pixels.length };
}

async function validate(input, options = {}) {
  const started = performance.now(), checks = [], assets = [];
  const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });
  const inputPath = path.resolve(input);
  let markdown, markdownPath, readAsset, manifest = null;
  if (/\.zip$/i.test(inputPath)) {
    const zip = await JSZip.loadAsync(fs.readFileSync(inputPath));
    const manifestFile = zip.file('manifest.json');
    if (manifestFile) manifest = JSON.parse(await manifestFile.async('string'));
    check('ZIP manifest exists', Boolean(manifest));
    if (manifest) {
      check('Manifest correct source and 18 message IDs', manifest.source === sourceUrl && manifest.messages?.length === 18, { source: manifest.source, messages: manifest.messages?.length, version: manifest.version });
      check('Manifest no unresolved warnings', manifest.warnings?.length === 0, manifest.warnings);
    }
    const files = Object.keys(zip.files).filter(name => /\.md$/i.test(name) && !zip.files[name].dir);
    // Select the conversation by its source, never by arbitrary first entry.
    for (const file of files) {
      const text = await zip.file(file).async('string');
      if (text.includes(sourceUrl) && text.includes('R01-BEGIN')) { markdown = text; markdownPath = file; break; }
    }
    if (!markdown) throw new Error('ZIP has no Markdown for the target conversation');
    readAsset = async ref => {
      const name = path.posix.normalize(path.posix.join(path.posix.dirname(markdownPath), decodeURIComponent(ref)));
      const file = zip.file(name);
      if (!file) throw new Error('Missing ZIP asset: ' + name);
      return { name, bytes: await file.async('nodebuffer') };
    };
  } else {
    markdownPath = inputPath; markdown = fs.readFileSync(inputPath, 'utf8');
    readAsset = async ref => { const name = path.resolve(path.dirname(inputPath), decodeURIComponent(ref)); return { name, bytes: fs.readFileSync(name) }; };
  }
  check('Correct source URL', markdown.includes(sourceUrl), sourceUrl);
  const blocks = messages(markdown);
  check('18 alternating messages', blocks.length === 18 && blocks.every((b, i) => b.role === (i % 2 ? 'assistant' : 'user')), blocks.map(b => b.role));
  for (let r = 1; r <= 9; r++) {
    const tag = 'R' + String(r).padStart(2, '0'), user = blocks[(r-1)*2], reply = blocks[(r-1)*2+1];
    check(tag + ' correct message and markers', user?.body.includes('导出验收 ' + tag) && reply?.body.includes(tag+'-BEGIN') && reply?.body.includes(r === 9 ? 'LONG-MIXED-END' : tag+'-END'), reply?.body.length);
  }
  check('LONG-MIXED-END', blocks[17]?.body.includes('LONG-MIXED-END'));
  check('No internal PUA markers', !/[\uE000-\uF8FF]|\uDB80[\uDC00-\uDFFF]|\uDBFF[\uDC00-\uDFFF]/u.test(markdown));
  check('No unavailable placeholder', !/Current selection unavailable/i.test(markdown));
  const baseline = messages(fs.readFileSync(path.join(root, 'Output - test 1/V0.5-1-项目分析撰写.md'), 'utf8'));
  const code = body => [...body.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm)].map(m => m[2].trim());
  const expectedCode = code(baseline[13].body), actualCode = code(blocks[13]?.body || '');
  check('R07 four complete code blocks', expectedCode.length === 4 && expectedCode.every(c => actualCode.some(a => a.replace(/\n\s*\n/g, '\n') === c.replace(/\n\s*\n/g, '\n'))), { expected: expectedCode.map(c => c.length), actual: actualCode.map(c => c.length) });
  const renderedR07 = new JSDOM(marked.parse(blocks[13]?.body || '')).window.document;
  const t01 = [...renderedR07.querySelectorAll('tr')].find(row => row.cells[0]?.textContent.trim() === 'T01');
  const cells = t01 ? [...t01.cells].map(c => c.textContent) : [];
  check('R07 T01 renders three intact cells', cells.length === 3 && cells[1].includes('竖线字符') && /Solar\s*\\?\|\s*Battery/.test(cells[2]), cells);
  const fixture = JSON.parse(fs.readFileSync(path.join(root, 'research/2026-10-12/LONG-R06.json')));
  if (fixture.url !== sourceUrl) throw new Error('Wrong R06 fixture source');
  const doc = new JSDOM(fixture.html, { url: fixture.url }).window.document;
  const reply = core.discover(doc).filter(m => m.role === 'assistant').at(-1);
  const items = reply.roots.flatMap(n => [...n.querySelectorAll('[role="checkbox"],input[type="checkbox"]')]).map(n => ({ label: n.parentElement.querySelector('label')?.textContent || '', text: n.parentElement.parentElement.textContent }));
  const r06Text = norm(new JSDOM(marked.parse(blocks[11]?.body || '')).window.document.body.textContent);
  const missingItems = items.filter(item => !r06Text.includes(norm(item.text)));
  check('R06 all 24 labels and descriptions', items.length === 24 && missingItems.length === 0, { expected: items.length, missing: missingItems });
  const requiredShots = new Set([2,3,4,5,6,8]);
  for (let i = 0; i < blocks.length; i++) {
    const document = new JSDOM(marked.parse(blocks[i].body)).window.document;
    const refs = [...document.querySelectorAll('img')].map(img => img.getAttribute('src'));
    let pngCount = 0;
    for (const ref of refs) {
      try {
        if (/^(https?:|data:)/i.test(ref)) throw new Error('Image is not a local archive asset');
        const asset = await readAsset(ref);
        if (manifest) {
          const meta = manifest.assets?.find(entry => entry.path === ref);
          check('Manifest asset belongs to correct message: ' + ref, meta?.messageId === manifest.messages[i], { actual: meta?.messageId, expected: manifest.messages[i] });
          if (/\.png$/i.test(ref) && meta) {
            const info = pngInfo(asset.bytes);
            // captureElement records CSS dimensions while canvas holds device pixels.
            const scaleX = info.width / meta.width, scaleY = info.height / meta.height;
            check('Manifest dimensions match PNG aspect ratio: ' + ref, Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX >= 0.5 && scaleY >= 0.5 && Math.abs(scaleX-scaleY) < 0.02, { cssDimensions: [meta.width, meta.height], pixelDimensions: [info.width, info.height], scale: [scaleX, scaleY], tiles: meta.tiles });
          }
        }
        // Compact metric cards legitimately measure 251×84 or 380×74 pixels.
        // Decode and structural validation establish PNG validity; visual QA
        // establishes content completeness, without an arbitrary minimum height.
        if (/\.png$/i.test(ref)) { const info = pngInfo(asset.bytes); assets.push({ message: i+1, round: Math.ceil((i+1)/2), ref, ...info }); pngCount++; check('PNG decoded: ' + ref, info.width > 0 && info.height > 0, info); }
        else check('Asset exists: ' + ref, asset.bytes.length > 0, asset.bytes.length);
      } catch (error) { check('Asset readable: ' + ref, false, error.message); }
    }
    const round = Math.ceil((i+1)/2);
    if (i % 2 && requiredShots.has(round)) check('R'+String(round).padStart(2,'0')+' screenshot in correct assistant message', pngCount > 0, refs);
  }
  if (manifest) check('Manifest every asset referenced in Markdown', manifest.assets?.every(asset => markdown.includes('](' + asset.path + ')')), manifest.assets?.map(asset => asset.path));
  if (manifest && options.sourceLedger) {
    if (options.sourceLedger.sourceUrl !== sourceUrl) throw Error('Screenshot inventory uses wrong source conversation');
    for (const message of options.sourceLedger.messages.filter(message => message.role === 'assistant' && message.uiRegions > 0)) {
      const count = manifest.assets.filter(asset => asset.messageId === message.id && asset.kind === 'screenshot').length;
      // This inventory check applies to this automatic one-screenshot-per-region
      // run. A manually expanded whole-message image needs separate visual proof.
      check(message.round + ' automatic screenshots cover all source UI regions', count >= message.uiRegions, { sourceRegions: message.uiRegions, screenshots: count, messageId: message.id });
    }
  }
  return { input: inputPath, sourceUrl, markdownPath, manifest, passed: checks.every(c => c.passed), elapsedMs: Math.round(performance.now()-started), checks, assets, limitation: 'PNG 解码与尺寸检查不能替代人工视觉核对；代码真值来自用户原始导出（原始主 Python 代码比页面复制少一条空行）。' };
}

if (require.main === module) {
  const [input, output, sourceLedgerPath] = process.argv.slice(2);
  if (!input || !output) { console.error('Usage: node scripts/validate-fast-export.cjs <download.md|download.zip> <report.json|report.md>'); process.exitCode = 2; }
  else validate(input, { sourceLedger: sourceLedgerPath ? JSON.parse(fs.readFileSync(sourceLedgerPath, 'utf8')) : null }).then(report => {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    const text = /\.md$/i.test(output) ? '# 真实下载独立验收\n\n' + `输入：${report.input}\n\n结果：${report.passed ? '通过' : '失败'}；验收耗时 ${report.elapsedMs} 毫秒。\n\n` + report.checks.map(c => `- ${c.passed ? '通过' : '失败'}：${c.name}。${c.detail === undefined ? '' : JSON.stringify(c.detail)}`).join('\n') + '\n\n' + report.limitation + '\n' : JSON.stringify(report, null, 2);
    fs.writeFileSync(output, text);
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.checks.filter(c => !c.passed).map(c => c.name), elapsedMs: report.elapsedMs, report: path.resolve(output) }, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  }).catch(error => { console.error(error.stack); process.exitCode = 2; });
}
module.exports = { validate, messages, pngInfo };
