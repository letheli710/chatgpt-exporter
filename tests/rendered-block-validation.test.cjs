const test=require('node:test'),assert=require('node:assert/strict');
const {compare}=require('../scripts/compare-rendered-blocks.cjs');
const message=blocks=>({sourceUrl:'https://chatgpt.com/c/6acd9282-acbc-83e9-bbb4-51aace07323c',messages:[{id:'m1',role:'assistant',round:'R07',blocks}]});
const section=body=>'<section data-message-id="m1" data-role="assistant">'+body+'</section>';
test('rendered table comparison rejects residual duplicated rows even when T01 is intact',()=>{
 const source=message([{kind:'table',blockIndex:0,text:'T01竖线字符Solar \\| Battery',rows:[['编号','内容','值'],['T01','竖线字符','Solar \\| Battery']]}]);
 const good='<table><tr><th>编号</th><th>内容</th><th>值</th></tr><tr><td>T01</td><td>竖线字符</td><td>Solar \\| Battery</td></tr></table>';
 assert.equal(compare(source,section(good)).results[0].blocks[0].status,'exact-table-cells');
 const bad=good.replace('</table>','<tr><td>T01</td><td>竖线字符</td><td>Solar \\| Battery</td></tr></table>');
 assert.equal(compare(source,section(bad)).results[0].blocks[0].status,'table-different-or-missing');
});
test('rendered formula matching accounts for occurrences and never promotes partial code to full verification',()=>{
 const source=message([{kind:'formula',blockIndex:0,text:'E=P\\times t'},{kind:'formula',blockIndex:1,text:'E=P\\times t'},{kind:'code',blockIndex:2,text:'first\nlast',partial:true}]);
 const html=section('<span class="katex"><annotation encoding="application/x-tex">E=P\\times t</annotation></span><pre><code>first\nmiddle\nlast</code></pre>');
 const report=compare(source,html),blocks=report.results[0].blocks;
 assert.equal(blocks[0].status,'exact-rendered-formula');assert.equal(blocks[1].status,'missing-rendered-formula');
 assert.equal(blocks[2].status,'visible-lines-match-source-incomplete');assert.equal(blocks[2].sourceComplete,false);assert.equal(report.completeAcceptancePassed,false);
});
test('numbered source code requires every source line and rejects conflicting observations',()=>{
 const {attach}=require('../scripts/attach-numbered-source-code.cjs');
 const make=()=>message([{kind:'code',blockIndex:0,text:'first',partial:true}]);
 const evidence={url:make().sourceUrl,messageId:'m1',codeIndex:0,totalLines:3,lines:[{number:1,text:'first'},{number:2,text:''},{number:3,text:'last'}]};
 assert.equal(attach(make(),evidence).messages[0].blocks[0].text,'first\n\nlast');
 assert.throws(()=>attach(make(),{...evidence,lines:evidence.lines.slice(0,2)}),/incomplete/);
 assert.throws(()=>attach(make(),{...evidence,lines:[...evidence.lines,{number:1,text:'changed'}]}),/Conflicting/);
});
test('complete-code comparison preserves leading and interior blank lines in rendered DOM',()=>{
 const source=message([{kind:'code',blockIndex:0,text:'\nfirst\n\nlast\n',partial:false}]);
 const result=compare(source,section('<pre><code>first\nlast\n</code></pre>')).results[0].blocks[0];
 assert.equal(result.status,'code-blank-lines-different');
 assert.deepEqual(result.lineDiff.missingSourceLines,[{number:1,text:''},{number:3,text:''}]);
 assert.equal(result.lineDiff.extraRenderedLines.length,0);
});
test('image presence alone never certifies missing text and reviewed coverage is bound to exact artifacts',()=>{
 const crypto=require('node:crypto');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 // A tiny PNG is solely a unit-test transport fixture, never real visual evidence.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=','base64');
 const source=message([{kind:'ui-text',blockIndex:0,text:'metric value',sha256:hash('metricvalue')}]);
 const html=section('<img data-asset-path="assets/card.png" src="data:image/png;base64,'+png.toString('base64')+'">');
 assert.equal(compare(source,html).results[0].blocks[0].status,'text-different-or-missing');
 const proof={sourceUrl:source.sourceUrl,renderedHTMLSha256:hash(html),sourceLedgerSemanticSHA256:hash(JSON.stringify(source)),regions:[{messageId:'m1',regionIndex:1,reviewed:true,assetRef:'assets/card.png',assetSha256:hash(png),blockMappings:[{blockIndex:0,sourceHash:hash('metricvalue')}]}]};
 assert.equal(compare(source,html,{imageCoverage:proof}).results[0].blocks[0].status,'verified-image-covered-text-intentionally-omitted');
 assert.throws(()=>compare(source,html+' ',{imageCoverage:proof}),/different source or rendered artifact/);
 assert.throws(()=>compare(source,html,{imageCoverage:{...proof,regions:[{...proof.regions[0],assetSha256:'bad'}]}}),/bytes changed/);
 const formula=message([{kind:'formula',blockIndex:0,text:'metric value',sha256:hash('metricvalue')}]);
 const formulaProof={...proof,sourceLedgerSemanticSHA256:hash(JSON.stringify(formula))};
 assert.equal(compare(formula,html,{imageCoverage:formulaProof}).results[0].blocks[0].status,'missing-rendered-formula');
});
