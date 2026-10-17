// Fixture-backed text check, never a replacement for browser download acceptance.
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../extension/core');
const fast = require('../extension/fast-text');
const visual = require('../extension/fast-visual');
const { messages, validate } = require('./validate-fast-export.cjs');
const root = path.resolve(__dirname, '..');
const sourceUrl = 'https://chatgpt.com/c/6acd9282-acbc-83e9-bbb4-51aace07323c';
(async () => {
  const started = performance.now(), rounds = [], records = [];
  const blocks = messages(fs.readFileSync(path.join(root, 'archive/Output - test 1/V0.5-1-项目分析撰写.md'), 'utf8'));
  for (let i = 0; i < blocks.length; i++) {
    const round = 'R' + String(Math.ceil((i+1)/2)).padStart(2,'0');
    const text = blocks[i].body.replace(/\n---\s*$/, '').trim();
    const normalized = fast.normalizeText(text);
    if (i % 2) {
      const fixture = JSON.parse(fs.readFileSync(path.join(root, `research/2026-10-12/LONG-${round}.json`)));
      if (fixture.url !== sourceUrl) throw Error('Wrong source fixture ' + round);
      const dom = new JSDOM(fixture.html, { url: fixture.url });
      const target = core.discover(dom.window.document).filter(m => m.role === 'assistant').at(-1);
      if (!target?.roots.some(r => r.textContent.includes(round+'-BEGIN'))) throw Error('Wrong message ' + round);
      const result = await visual.enrich({ id: target.id, ...normalized }, { doc: dom.window.document, screenshot: false });
      rounds.push({ round, messageId: target.id, fixture: fixture.url, uiBlocks: visual.uiBlocks(target).length, normalizedUIReasons: normalized.uiReasons, ...result.timings, warnings: result.warnings });
      records.push({ id: target.id, role: 'assistant', md: result.md });
      dom.window.close();
    } else records.push({ id: 'fixture-user-' + round, role: 'user', md: normalized.md });
  }
  const output = path.join(root, 'archive/Output - test 1/0.6.0/离线验收/Swift-Archive-offline-text.md');
  const markdown = fast.markdown({ title: '项目分析撰写（离线真实输入文字验收；未截图）', messages: records, warnings: [] }, records.map(m => m.id), sourceUrl);
  fs.writeFileSync(output, markdown);
  const report = await validate(output);
  report.mode = 'offline-existing-user-export-plus-real-DOM-fixtures';
  report.browserDownloaded = false;
  report.screenshotsAttempted = false;
  report.generationElapsedMs = Math.round(performance.now()-started-report.elapsedMs);
  report.rounds = rounds;
  report.textChecksPassed = report.checks.filter(c => !c.name.includes('screenshot in correct assistant message')).every(c => c.passed);
  fs.writeFileSync(path.join(root, 'research/2026-10-14/SWIFT-OFFLINE-TEXT-VALIDATION.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, mode: report.mode, textChecksPassed: report.textChecksPassed, fullAcceptancePassed: report.passed, generationElapsedMs: report.generationElapsedMs, verificationElapsedMs: report.elapsedMs, failures: report.checks.filter(c => !c.passed).map(c => c.name), rounds }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
