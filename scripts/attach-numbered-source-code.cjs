// Usage: node scripts/attach-numbered-source-code.cjs <ledger.json> <numbered-source-code.json> <new-ledger.json>
// Requires native UI evidence of an editor's final line number and all numbered lines.
const fs=require('node:fs'),crypto=require('node:crypto');
const {normalize}=require('./build-source-block-ledger.cjs');
function attach(ledger,evidence){
 if(evidence.url!==ledger.sourceUrl)throw Error('Wrong source conversation URL');
 if(!Number.isInteger(evidence.totalLines)||evidence.totalLines<1||!Array.isArray(evidence.lines))throw Error('Missing final line count or numbered source lines');
 const lines=new Map();
 for(const line of evidence.lines){if(!Number.isInteger(line.number)||line.number<1||typeof line.text!=='string')throw Error('Invalid numbered source line');if(lines.has(line.number)&&lines.get(line.number)!==line.text)throw Error('Conflicting repeated source line '+line.number);lines.set(line.number,line.text);}
 if(lines.size!==evidence.totalLines)throw Error('Source line inventory incomplete');
 const complete=[];for(let i=1;i<=evidence.totalLines;i++){if(!lines.has(i))throw Error('Missing source line '+i);complete.push(lines.get(i));}
 const message=ledger.messages.find(m=>m.id===evidence.messageId);if(!message)throw Error('Source message ID not found');
 const block=message.blocks.filter(b=>b.kind==='code')[evidence.codeIndex??0];if(!block)throw Error('Source code block not found');
 const text=complete.join('\n');Object.assign(block,{text,normalized:normalize(text),sha256:crypto.createHash('sha256').update(normalize(text)).digest('hex'),partial:false,sourceLineCount:evidence.totalLines,numberedLinesVerified:true,sourceCodeEvidence:{mode:evidence.method||'native-UI-numbered-editor-lines',capturedAt:evidence.capturedAt||null,evidenceFile:evidence.evidenceFile||null}});
 return ledger;
}
if(require.main===module){const [source,evidence,out]=process.argv.slice(2);if(!out)throw Error('Usage: attach-numbered-source-code.cjs <ledger.json> <numbered-source-code.json> <new-ledger.json>');const data=JSON.parse(fs.readFileSync(evidence));data.evidenceFile=evidence;const updated=attach(JSON.parse(fs.readFileSync(source)),data);fs.writeFileSync(out,JSON.stringify(updated,null,2));console.log(JSON.stringify({sourceCodeLines:data.totalLines,output:out}));}
module.exports={attach};
