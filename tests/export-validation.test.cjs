const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { validate, pngInfo } = require('../scripts/validate-fast-export.cjs');

test('acceptance checker detects the real 0.5 omissions while preserving successful text evidence', async () => {
  const report = await validate(path.join(__dirname, '../Output - test 1/V0.5-1-项目分析撰写.md'));
  const results = new Map(report.checks.map(check => [check.name, check.passed]));
  assert.equal(report.passed, false);
  assert.equal(results.get('18 alternating messages'), true);
  assert.equal(results.get('R09 correct message and markers'), true);
  assert.equal(results.get('R07 four complete code blocks'), true);
  assert.equal(results.get('R07 T01 renders three intact cells'), false);
  assert.equal(results.get('R06 all 24 labels and descriptions'), false);
  assert.equal(results.get('No internal PUA markers'), false);
  assert.equal(results.get('No unavailable placeholder'), false);
});

test('PNG verification inflates actual archived screenshot pixel data', async () => {
  const JSZip = require('../extension/jszip.min.js');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '../Output - test 1/conversation-archive-v8.zip')));
  const bytes = await zip.file('assets/asset-000009.png').async('nodebuffer');
  const info = pngInfo(bytes);
  assert.ok(info.width > 100 && info.height > 100 && info.decodedBytes > 1000);
  assert.throws(() => pngInfo(bytes.subarray(0, bytes.length / 2)), /Truncated|Incomplete/);
  const broken = Buffer.from(bytes);
  // Alter the zlib header of IDAT rather than just the (unchecked) PNG CRC.
  const idat = broken.indexOf(Buffer.from('IDAT'));
  broken[idat + 4] = 0;
  assert.throws(() => pngInfo(broken));
});
