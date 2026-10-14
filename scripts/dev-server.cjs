// A loopback-only, explicit-file development harness; no workspace directory browsing.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const files=new Map([['/','tests/browser.html'],...['core.js','automation.js','content.js','jszip.min.js'].map(n=>['/'+n,'extension/'+n])]);
for(const [url,file] of Object.entries({'/code':'tests/code-browser.html','/fixture.py':'tests/fixtures/v5-python.py','/cm-view.js':'node_modules/@codemirror/view/dist/index.js','/cm-state.js':'node_modules/@codemirror/state/dist/index.js','/cluster-break.js':'node_modules/@marijn/find-cluster-break/src/index.js','/style-mod.js':'node_modules/style-mod/src/style-mod.js','/w3c-keyname.js':'node_modules/w3c-keyname/index.js'}))files.set(url,file);
http.createServer((req,res)=>{
  const file=files.get(req.url.split('?')[0]);if(!file){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(path.resolve(file)));
}).listen(52301,'127.0.0.1',()=>console.log('Archive test harness: http://127.0.0.1:52301'));
