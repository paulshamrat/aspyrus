import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {compileManuscript} = require('../src/compiler.cjs');
const source = String.raw`\documentclass{article}
\begin{document}A plain report.\end{document}`;
function fixture(t) {
  const root=fs.mkdtempSync('/tmp/localleaf-compiler-');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const doc=path.join(root,'paper.tex');
  fs.writeFileSync(doc,source);
  return {root,doc,options:{texFilePath:doc,output:{appendLine(){}}}};
}
test('packaged engine builds without configuration; never autoexecutes compile.sh', async t=>{
  const {root,options}=fixture(t);
  fs.writeFileSync(path.join(root,'compile.sh'),'touch dangerous-marker');
  const result=await compileManuscript(options);
  assert.ok(fs.existsSync(result.pdfPath));
  assert.ok(fs.existsSync(result.docxPath));
  assert.equal(result.figuresPath,null);
  assert.ok(!fs.existsSync(path.join(root,'dangerous-marker')));
});
test('preparation requires workspace trust and runs before snapshot',async t=>{
  const {root,doc,options}=fixture(t);
  fs.writeFileSync(path.join(root,'.localleaf.json'),JSON.stringify({version:1,prepare:['python3','prepare.py']}));
  fs.writeFileSync(path.join(root,'prepare.py'),`from pathlib import Path\nPath('paper.tex').write_text(${JSON.stringify(source.replace('A plain report.','Prepared bibliography workflow.'))})\n`);
  await assert.rejects(compileManuscript(options),/Trust this workspace/);
  assert.equal(fs.readFileSync(doc,'utf8'),source);
  const result=await compileManuscript({...options,trusted:true});
  assert.equal(result.success,true);
  assert.match(fs.readFileSync(doc,'utf8'),/Prepared bibliography/);
});
test('invalid or failed preparation stops before output publication',async t=>{
  const {root,options}=fixture(t);
  fs.writeFileSync(path.join(root,'.localleaf.json'),JSON.stringify({prepare:'echo unsafe'}));
  await assert.rejects(compileManuscript({...options,trusted:true}),/array/);
  fs.writeFileSync(path.join(root,'.localleaf.json'),JSON.stringify({prepare:['python3','-c','raise SystemExit("Preparation failed")']}));
  await assert.rejects(compileManuscript({...options,trusted:true}),/Preparation failed/);
  assert.ok(!fs.existsSync(path.join(root,'paper.pdf')));
});

test('configuration-free build scripts require an explicit marker and workspace trust',async t=>{
  const {root,options}=fixture(t);
  fs.mkdirSync(path.join(root,'scripts'));
  fs.mkdirSync(path.join(root,'.git'));
  fs.writeFileSync(path.join(root,'scripts','build.py'), "ASPYRUS_BUILD_ENTRY = True\nfrom pathlib import Path\np=Path(__file__).resolve().parents[1]\n(p/'paper.pdf').write_bytes(b'fixture PDF')\n(p/'paper.docx').write_bytes(b'fixture Word')\n");
  await assert.rejects(compileManuscript(options),/Trust this workspace/);
  assert.ok(!fs.existsSync(path.join(root,'paper.pdf')));
  const result=await compileManuscript({...options,trusted:true});
  assert.equal(result.success,true);
  assert.ok(!fs.existsSync(path.join(root,'.aspyrus.json')));
  const outside = fs.mkdtempSync('/tmp/aspyrus-outside-');
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  const foreign=path.join(outside,'build.py');
  fs.copyFileSync(path.join(root,'scripts','build.py'),foreign);
  fs.unlinkSync(path.join(root,'scripts','build.py'));
  fs.symlinkSync(foreign,path.join(root,'scripts','build.py'));
  await assert.rejects(compileManuscript({...options,trusted:true}),/escapes the project/);
});
