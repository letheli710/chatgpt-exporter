// Usage: node scripts/compare-rendered-blocks.cjs <source-ledger.json> <rendered.html> <report.json>
// Only rendered HTML is accepted; this script never parses Markdown input.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const {logicalText,normalize}=require('./build-source-block-ledger.cjs');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
function sameRows(a,b){return a.length===b.length&&a.every((row,i)=>row.length===b[i].length&&row.every((cell,j)=>normalize(cell)===normalize(b[i][j])));}
function lineDiff(source,rendered){
 const a=source.split('\n'),b=rendered.split('\n'),dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
 for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
 const missingSourceLines=[],extraRenderedLines=[];let i=0,j=0;
 while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;}else if(i<a.length&&(j===b.length||dp[i+1][j]>=dp[i][j+1])){missingSourceLines.push({number:i+1,text:a[i++]});}else{extraRenderedLines.push({number:j+1,text:b[j++]});}}
 return {sourceLineCount:a.length,renderedLineCount:b.length,missingSourceLines,extraRenderedLines};
}
function compare(ledger,html,options={}){
  const started=performance.now(),document=new JSDOM(html).window.document;
  const coverage=options.imageCoverage;
  if(coverage&&(coverage.sourceUrl!==ledger.sourceUrl||coverage.renderedHTMLSha256!==sha(html)||coverage.sourceLedgerSemanticSHA256!==sha(JSON.stringify(ledger))))throw Error('Image coverage evidence belongs to a different source or rendered artifact');
  const sections=[...document.querySelectorAll('section[data-message-id][data-role]')],results=[];
  for(const message of ledger.messages){
    const section=sections.find(n=>n.getAttribute('data-message-id')===message.id);
    if(!section){results.push({messageId:message.id,round:message.round,role:message.role,missingRenderedMessage:true,blocks:[]});continue;}
    const texts=[...section.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote')].filter(n=>!n.closest('table,pre,.katex')&&!(n.matches('li,blockquote')&&n.querySelector('p,li'))).map(n=>normalize(logicalText(n)));
    const whole=normalize(logicalText(section)),formulas=[...section.querySelectorAll('annotation[encoding="application/x-tex"]')].map(n=>normalize(n.textContent));
    const tables=[...section.querySelectorAll('table')].map(t=>[...t.rows].map(row=>[...row.cells].map(logicalText)));
    const renderedTotals={formula:formulas.length,table:tables.length};
    const codes=[...section.querySelectorAll('pre code')].map(n=>n.textContent.replace(/\r\n/g,'\n'));let codeIndex=0;
    renderedTotals.code=codes.length;
    const blocks=message.blocks.map(block=>{
      const result={kind:block.kind,index:block.blockIndex,source:block.text,sourceHash:block.sha256};
      let verifiedImage=null;
      if(coverage&&['ui-text','accessible-alt'].includes(block.kind)){
        const proof=coverage.regions?.find(region=>region.messageId===message.id&&region.reviewed===true&&region.blockMappings?.some(mapping=>mapping.blockIndex===block.blockIndex&&mapping.sourceHash===block.sha256));
        if(proof){
          const image=[...section.querySelectorAll('img[data-asset-path]')].find(image=>image.getAttribute('data-asset-path')===proof.assetRef);
          const src=image?.getAttribute('src')||'',match=/^data:image\/png;base64,([\s\S]+)$/.exec(src);
          if(!match)throw Error('Reviewed image is missing from rendered message: '+proof.assetRef);
          const bytes=Buffer.from(match[1],'base64'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
          if(hash!==proof.assetSha256)throw Error('Reviewed image bytes changed: '+proof.assetRef);
          require('./validate-fast-export.cjs').pngInfo(bytes);
          verifiedImage={assetRef:proof.assetRef,assetSha256:hash,regionIndex:proof.regionIndex,reviewEvidence:proof.reviewEvidence};
        }
      }
      if(block.kind==='formula'){const index=formulas.indexOf(normalize(block.text));result.status=index>=0?'exact-rendered-formula':'missing-rendered-formula';if(index>=0)formulas.splice(index,1);}
      else if(block.kind==='table'||block.kind==='ui-table'){
        const index=tables.findIndex(rows=>sameRows(block.rows,rows));result.status=index>=0?'exact-table-cells':'table-different-or-missing';
        if(index>=0)tables.splice(index,1);else result.renderedCandidateRows=tables.filter(rows=>rows[0]?.map(normalize).join('|')===block.rows[0]?.map(normalize).join('|'));
        result.sourceRows=block.rows;
      }else if(block.kind==='code'){
        const actual=codes[codeIndex++];result.rendered=actual;result.sourceComplete=!block.partial;
        if(block.partial){const visible=block.text.split('\n').filter(line=>line.trim());let cursor=0;const actualLines=(actual||'').split('\n');const match=visible.every(line=>{const index=actualLines.indexOf(line,cursor);if(index<0)return false;cursor=index+1;return true;});result.status=match?'visible-lines-match-source-incomplete':'visible-code-lines-differ-source-incomplete';}
        else {
          result.lineDiff=lineDiff(block.text,actual||'');
          result.status=actual===block.text?'exact-complete-code':actual===block.text+'\n'?'renderer-terminal-newline-only':actual?.split('\n').filter(line=>line.trim()).join('\n')===block.text.split('\n').filter(line=>line.trim()).join('\n')?'code-blank-lines-different':'code-different-or-missing';
        }
      }else if(block.kind==='ui-control'){
        const state=block.checked==='true'||block.checked===true?'[x]':block.checked==='false'||block.checked===false?'[ ]':null;
        const readableState=state==='[x]'?'☑ 已勾选':state==='[ ]'?'☐ 未勾选':null;
        result.status=state&&(whole.includes(normalize(state+block.text))||whole.includes(normalize(readableState+block.text)))?'control-label-and-state-found':'control-requires-live-visual-check';result.expectedState={checked:block.checked,value:block.value};
      }else{
        const index=texts.indexOf(normalize(block.text));result.status=index>=0?'exact-rendered-block':whole.includes(normalize(block.text))?'text-preserved-block-boundary-different':'text-different-or-missing';if(index>=0)texts.splice(index,1);
      }
      if(verifiedImage){
        result.imageCoverage=verifiedImage;
        // Keep an explicit distinction: a verified PNG does not make omitted
        // text searchable or byte-equivalent to a source text block.
        if(result.status==='text-different-or-missing')result.status='verified-image-covered-text-intentionally-omitted';
        else result.duplicateGraphicTextStillPresent=true;
      }
      return result;
    });
    results.push({messageId:message.id,round:message.round,role:message.role,renderedRole:section.getAttribute('data-role'),roleMatches:section.getAttribute('data-role')===message.role,renderedTotals,unmatchedRenderedFormulas:formulas,unmatchedRenderedTables:tables,unmatchedRenderedTextBlocks:texts,unmatchedRenderedCode:codes.slice(codeIndex),blocks});
  }
  const counts={};for(const message of results)for(const block of message.blocks){const category=counts[block.kind]||(counts[block.kind]={total:0,status:{}});category.total++;category.status[block.status]=(category.status[block.status]||0)+1;}
  const unverified=results.flatMap(message=>message.blocks.filter(block=>!block.status.startsWith('exact')&&block.status!=='control-label-and-state-found'&&block.status!=='verified-image-covered-text-intentionally-omitted').map(block=>({messageId:message.messageId,round:message.round,...block})));
  return {mode:'rendered-HTML-DOM-against-source-browser-DOM-blocks',sourceUrl:ledger.sourceUrl,renderedHTMLSha256:sha(html),createdAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),renderedMessages:sections.length,sourceMessages:ledger.messages.length,messageOrderMatches:sections.length===ledger.messages.length&&sections.every((section,i)=>section.getAttribute('data-message-id')===ledger.messages[i].id),rolesMatch:results.every(message=>message.roleMatches),counts,results,unverified,completeAcceptancePassed:false,limitations:['本报告比较实际渲染HTML而非Markdown源码；不自动宣称PDF分页或PNG排版通过。','源DOM捕获时间见source ledger；历史UI状态不能充当本轮现场状态真值。','partial代码即使可见行一致仍未全量核对，必须补足完整页面Copy code证据。','文字跨块保留和控件状态找到属于较弱证据，需源页面/渲染分页进一步人工核对。']};
}
if(require.main===module){const [source,rendered,output,coverageFile]=process.argv.slice(2);if(!output)throw Error('Usage: compare-rendered-blocks.cjs <ledger.json> <rendered.html> <report.json> [reviewed-image-coverage.json]');const report=compare(JSON.parse(fs.readFileSync(source)),fs.readFileSync(rendered,'utf8'),{imageCoverage:coverageFile?JSON.parse(fs.readFileSync(coverageFile)):null});fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({sourceMessages:report.sourceMessages,renderedMessages:report.renderedMessages,counts:report.counts,unverified:report.unverified.length,elapsedMs:report.elapsedMs,output:path.resolve(output)},null,2));}
module.exports={compare,sameRows,lineDiff};
