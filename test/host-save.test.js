import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

for (const failure of [false, true]) {
  test(`save reacquires closed documents and ${failure ? 'reports failed disk saves' : 'confirms clean buffer and disk'}`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localleaf-save-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'main.tex');
    const original = '\\begin{document}Original\\end{document}';
    const changed = original.replace('Original', 'Edited');
    fs.writeFileSync(file, original);
    const uri = {fsPath:file, scheme:'file', toString:()=>file};
    let content = original;
    const makeDoc = () => ({uri, fileName:file, isClosed:false, isDirty:false,
      getText(){ if(this.isClosed) throw new Error('Document has been closed'); return content; },
      positionAt: n => n,
      async save(){ if(this.isClosed) throw new Error('Document has been closed'); if(failure) return false; fs.writeFileSync(file,content); this.isDirty=false; return true; }
    });
    let live = makeDoc();
    const sent=[], errors=[], commands={};
    let receive;
    const disposable={dispose(){}};
    const panel={active:true,webview:{asWebviewUri:u=>u,postMessage:m=>sent.push(m),onDidReceiveMessage:fn=>{receive=fn;return disposable;}},onDidDispose(){}};
    const vscode={
      Uri:{file:p=>({fsPath:p,toString:()=>p})}, ViewColumn:{Beside:2}, Range:class {},
      WorkspaceEdit:class { changes=[];replace(uri,range,value){this.changes.push(value);} },
      commands:{registerCommand:(name,fn)=>{commands[name]=fn;return disposable;}},
      window:{createOutputChannel:()=>({appendLine(){}}),createWebviewPanel:()=>panel,registerWebviewPanelSerializer:()=>disposable,showErrorMessage:m=>errors.push(m)},
      workspace:{get textDocuments(){return [live];},openTextDocument:async()=>live,onDidChangeTextDocument:()=>disposable,
        async applyEdit(edit){if(!edit.changes.length) return false;content=edit.changes.at(-1)??content;live.isClosed=true;live=makeDoc();live.isDirty=true;return true;}
      }
    };
    const mod={exports:{}};
    vm.runInNewContext(fs.readFileSync('src/extension.cjs','utf8'),{module:mod,require:n=>n==='vscode'?vscode:n.startsWith('./')?require('../src/'+n.slice(2)):require(n),setTimeout,clearTimeout,console});
    mod.exports.activate({extensionPath:process.cwd(),globalStorageUri:{fsPath:root},subscriptions:[]});
    await commands['aspyrus.open'](uri);
    live.isClosed=true;live=makeDoc();
    await receive({command:'save',saveId:1,content:changed});
    assert.equal(sent.at(-1).command, failure?'saveError':'saveSuccess');
    assert.equal(fs.readFileSync(file,'utf8'),failure?original:changed);
    assert.equal(live.isDirty,failure);
    assert.equal(errors.length,failure?1:0);
    if (!failure) {
      // Saving already-clean, identical content must succeed and never attempt an empty WorkspaceEdit
      await receive({command:'save',saveId:2,content:changed});
      assert.equal(sent.at(-1).command, 'saveSuccess');
    }
    commands['aspyrus.restore']();
    assert.equal(sent.at(-1).command,'requestRestore');
  });
}
