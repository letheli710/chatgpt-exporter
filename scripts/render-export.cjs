// Offline, deterministic GFM + LaTeX rendering for an exported ZIP.
// Setup: npm install --prefix tmp/markdown-renderer --ignore-scripts katex@0.16.22
// Run: node scripts/render-export.cjs INPUT.zip OUTPUT_DIR [--no-pdf]
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const bundle=process.env.CODEX_RENDER_NODE_MODULES || 'C:/Users/chenr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const dependency=name=>require(path.join(bundle,name));
const {Marked}=require('marked');
const katex=require('../tmp/markdown-renderer/node_modules/katex');
const katexRoot=path.resolve(__dirname,'../tmp/markdown-renderer/node_modules/katex/dist');
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function parseMessages(md,ids) {
 const headings=[];let cursor=0;
 // Block tokens distinguish a message boundary from an example inside code.
 for(const token of new Marked().lexer(md)) {
  if(token.type==='heading'&&token.depth===2&&['我','ChatGPT'].includes(token.text))headings.push(Object.assign([token.raw,token.text],{index:cursor}));
  cursor+=token.raw.length;
 }
 if(headings.length!==ids.length)throw Error(`Message boundary mismatch: ${headings.length} headings, ${ids.length} IDs`);
 return {header:md.slice(0,headings[0]?.index||md.length),messages:headings.map((m,i)=>({id:ids[i],role:m[1]==='我'?'user':'assistant',label:m[1],md:md.slice(m.index+m[0].length,headings[i+1]?.index||md.length).replace(/\n\n---\s*$/,'').trim()}))};
}
function parser(report) {
 const marked=new Marked({gfm:true,breaks:false});
 const render=(tex,display)=>{
  report.formulas++;
  try{return katex.renderToString(tex,{displayMode:display,throwOnError:true,strict:'ignore',output:'htmlAndMathml',trust:false});}
  catch(error){report.mathErrors.push({tex,error:error.message});return `<span class="math-error">${escape(tex)}</span>`;}
 };
 marked.use({extensions:[
  {name:'displayMath',level:'block',start:src=>src.search(/(?:^|\n)[ \t]*(?:\\\[|\$\$)/),tokenizer(src){const m=/^[ \t]*(?:\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$)[ \t]*(?:\n|$)/.exec(src);if(m)return {type:'displayMath',raw:m[0],tex:m[1]??m[2]};},renderer:token=>render(token.tex,true)},
  {name:'inlineMath',level:'inline',start:src=>src.search(/\\\(|\$(?!\$)/),tokenizer(src){const m=/^(?:\\\(([\s\S]*?)\\\)|\$(?!\$)([^\n$]+?)\$)/.exec(src);if(m)return {type:'inlineMath',raw:m[0],tex:m[1]??m[2]};},renderer:token=>render(token.tex,false)}
 ]});
 return marked;
}
async function renderZip(input,out,{pdf=true}={}) {
 const start=performance.now();
 const inputBytes=await fs.readFile(input),sha256=value=>createHash('sha256').update(value).digest('hex');
 const JSZip=dependency('jszip'),zip=await JSZip.loadAsync(inputBytes);
 const md=await zip.file('conversation.md')?.async('string');if(!md)throw Error('Missing conversation.md');
 const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
 const report={input:path.resolve(input),inputSha256:sha256(inputBytes),markdownSha256:sha256(md),startedAt:new Date().toISOString(),dependencies:{marked:require('marked/package.json').version,katex:katex.version},formulas:0,mathErrors:[],assets:[],messages:manifest.messages.length};
 const parsed=parseMessages(md,manifest.messages),marked=parser(report);
 let body=marked.parse(parsed.header)+parsed.messages.map(m=>`<section data-message-id="${escape(m.id)}" data-role="${m.role}"><h2 class="role">${m.label}</h2>${marked.parse(m.md)}</section>`).join('\n');
 body=await replaceAssets(body,zip,report);
 let css=await fs.readFile(path.join(katexRoot,'katex.min.css'),'utf8');
 const fonts=[...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1]))];
 for(const font of fonts){const bytes=await fs.readFile(path.join(katexRoot,font));const mime=font.endsWith('.woff2')?'font/woff2':font.endsWith('.woff')?'font/woff':'font/ttf';css=css.split(`url(${font})`).join(`url(data:${mime};base64,${bytes.toString('base64')})`);}
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><title>${escape(path.basename(input,'.zip'))}</title><style>${css}
 *{box-sizing:border-box}body{margin:0 auto;padding:32px;max-width:900px;font:16px/1.8 "Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#17202a;background:white}section{border-top:1px solid #dce2e8;padding-top:20px;margin-top:28px}h1,h2,h3{line-height:1.4;color:#152839}h1{font-size:26px}h2{font-size:22px}h3{font-size:19px}.role{font-size:18px;color:#516272}p,li{overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:14px;margin:18px 0}td,th{border:1px solid #cdd5de;padding:8px;vertical-align:top}th{background:#f0f4f7}tr{break-inside:avoid}pre{background:#f5f7fa;border:1px solid #dce2e8;border-radius:6px;padding:14px;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 Consolas,monospace}code{font-family:Consolas,monospace}blockquote{border-left:3px solid #a9bdcf;padding-left:15px;color:#4e5964}img{display:block;max-width:100%;height:auto;margin:18px auto;break-inside:avoid}.katex-display{overflow-wrap:normal;max-width:100%;font-size:.95em}.katex-mathml{position:absolute!important;clip:rect(1px,1px,1px,1px)!important;width:1px!important;height:1px!important;overflow:hidden!important}.math-error{color:#b00020}a{color:#276194;text-decoration:none}@page{size:A4;margin:16mm 14mm 18mm}@media print{body{max-width:none;padding:0;font-size:10pt;line-height:1.7}h1{font-size:18pt}h2{font-size:15pt}h3{font-size:12pt}table{font-size:9pt}pre{font-size:8pt}h1,h2,h3{break-after:avoid}img{max-height:235mm;object-fit:contain}section{padding-top:10px;margin-top:15px}}
 </style></head><body>${body}</body></html>`;
 await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'conversation.html'),html);
 await fs.writeFile(path.join(out,'conversation.md'),md);await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 if(pdf){
  const {chromium}=dependency('playwright');
  const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{const page=await browser.newPage({viewport:{width:1000,height:1200}});await page.route('**/*',r=>r.request().url().startsWith('file:')?r.continue():r.abort());await page.goto(pathToFileURL(path.resolve(out,'conversation.html')).href);await page.evaluate(()=>document.fonts.ready);report.browser=await page.evaluate(()=>({sections:document.querySelectorAll('section').length,tables:document.querySelectorAll('table').length,images:[...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight})),formulas:document.querySelectorAll('.katex').length,codeBlocks:document.querySelectorAll('pre code').length}));await page.pdf({path:path.join(out,'conversation.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;text-align:center;font-size:8px;color:#657182"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});}
  finally{await browser.close();}
  const canvas=dependency('@napi-rs/canvas');global.DOMMatrix=canvas.DOMMatrix;global.Path2D=canvas.Path2D;global.ImageData=canvas.ImageData;
  const pdfjs=await import(pathToFileURL(path.join(bundle,'pdfjs-dist/legacy/build/pdf.mjs')).href);
  const document=await pdfjs.getDocument({data:new Uint8Array(await fs.readFile(path.join(out,'conversation.pdf'))),useSystemFonts:true}).promise;
  report.pages=document.numPages;await fs.mkdir(path.join(out,'pages'),{recursive:true});
  for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n),viewport=page.getViewport({scale:1.4});const image=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:image.getContext('2d'),viewport}).promise;await fs.writeFile(path.join(out,'pages',`page-${String(n).padStart(3,'0')}.png`),image.toBuffer('image/png'));}
  report.contactSheets=await contactSheets(out,document.numPages);
 }
 report.htmlSha256=sha256(html);if(pdf)report.pdfSha256=sha256(await fs.readFile(path.join(out,'conversation.pdf')));
 report.elapsedMs=Math.round(performance.now()-start);await fs.writeFile(path.join(out,'render-report.json'),JSON.stringify(report,null,2));return report;
}
async function contactSheets(out,count) {
 const sharp=dependency('sharp'),results=[];
 for(let first=1;first<=count;first+=12){const layers=[];
  for(let n=first;n<=Math.min(count,first+11);n++){
   const position=n-first,x=(position%3)*250,y=Math.floor(position/3)*375;
   const thumb=await sharp(path.join(out,'pages',`page-${String(n).padStart(3,'0')}.png`)).resize({width:240,height:340,fit:'contain',background:'#fff'}).png().toBuffer();
   const label=Buffer.from(`<svg width="240" height="24"><rect width="240" height="24" fill="#e4eaf0"/><text x="12" y="17" font-family="Arial" font-size="14">Page ${n}</text></svg>`);
   layers.push({input:label,left:x,top:y},{input:thumb,left:x,top:y+24});
  }
  const filename=`contact-${String(first).padStart(3,'0')}-${String(Math.min(count,first+11)).padStart(3,'0')}.png`;
  await sharp({create:{width:750,height:1500,channels:3,background:'#c8d2de'}}).composite(layers).png().toFile(path.join(out,filename));results.push(filename);
 }
 return results;
}
async function replaceAssets(body,zip,report){
 for(const entry of Object.values(zip.files)){if(entry.dir||!entry.name.startsWith('assets/'))continue;const mime=/\.png$/i.test(entry.name)?'image/png':/\.jpe?g$/i.test(entry.name)?'image/jpeg':/\.svg$/i.test(entry.name)?'image/svg+xml':null;if(!mime)continue;const value=`data:${mime};base64,${await entry.async('base64')}`;const ref=`src="${escape(entry.name)}"`;const count=body.split(ref).length-1;if(count){body=body.split(ref).join(`src="${value}" data-asset-path="${escape(entry.name)}"`);report.assets.push({path:entry.name,count});}}
 return body;
}
module.exports={parseMessages,parser,renderZip,contactSheets};
if(require.main===module){const [input,out,...options]=process.argv.slice(2);if(!input||!out)throw Error('Usage: node scripts/render-export.cjs INPUT.zip OUTPUT_DIR [--no-pdf]');renderZip(input,out,{pdf:!options.includes('--no-pdf')}).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});}
