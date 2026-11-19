import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('focus/reveal never reinitializes retained canvas; ready initializes once', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localleaf-panel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'main.tex');
  fs.writeFileSync(file, '\\begin{document}Original\\end{document}');
  const uri = { fsPath: file, scheme: 'file', toString: () => file };
  const doc = { uri, fileName: file, getText: () => fs.readFileSync(file, 'utf8') };
  const sent = [];
  const viewListeners = [];
  let open, receive;
  const disposable = { dispose() {} };
  const panel = {
    webview: { asWebviewUri: (uri) => uri, postMessage: (m) => sent.push(m), onDidReceiveMessage: (fn) => { receive = fn; return disposable; } },
    onDidChangeViewState: (fn) => { viewListeners.push(fn); return disposable; },
    onDidDispose() {},
    reveal() { viewListeners.forEach((fn) => fn({ webviewPanel: { visible: true, active: true } })); },
  };
  let clipboard = '';
  const vscode = {
    env: { clipboard: { writeText: async (text) => { clipboard = text; }, readText: async () => clipboard } },
    Uri: { file: (file) => ({ fsPath: file, toString: () => file }) },
    ViewColumn: { Beside: 2 },
    commands: { registerCommand: (name, fn) => { if (name === 'aspyrus.open') open = fn; return disposable; } },
    window: { createOutputChannel: () => ({ appendLine() {} }), createWebviewPanel: () => panel, registerWebviewPanelSerializer: () => disposable },
    workspace: { openTextDocument: async () => doc, onDidChangeTextDocument: () => disposable },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync('src/extension.cjs', 'utf8'), {
    module: mod, require: (name) => name === 'vscode' ? vscode : name.startsWith('./') ? require('../src/' + name.slice(2)) : require(name), setTimeout, clearTimeout, console,
  });
  mod.exports.activate({ extensionPath: process.cwd(), globalStorageUri: { fsPath: root }, subscriptions: [] });
  await open(uri);
  assert.equal(sent.length, 0, 'Wait for the webview ready handshake');
  await receive({ command: 'ready' });
  assert.equal(sent.filter((m) => m.command === 'init').length, 1);
  for (let i = 0; i < 3; i++) {
    viewListeners.forEach((fn) => fn({ webviewPanel: { visible: true, active: false } }));
    await open(uri);
  }
  assert.equal(sent.filter((m) => m.command === 'init').length, 1, 'Focus/reveal must preserve canvas edits, selection, and undo');
  await receive({command:'figureClipboardWrite',content:'Complete figure source',requestId:41});
  assert.equal(clipboard, 'Complete figure source');
  assert.equal(sent.at(-1).command, 'figureClipboardWritten');
  assert.equal(sent.at(-1).requestId, 41);
  await receive({command:'figureClipboardRead',requestId:42});
  assert.equal(sent.at(-1).content, clipboard);
  assert.equal(sent.at(-1).requestId, 42);
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'image.png'), 'fixture');
  await receive({command:'resolveFigurePreviews',revision:7,content:String.raw`\includegraphics{assets/image.png}\includegraphics{../../etc/passwd}`});
  assert.equal(sent.at(-1).command,'figurePreviews');
  assert.equal(sent.at(-1).revision,7);
  assert.equal(Object.keys(sent.at(-1).figureUris).length,1);
  assert.ok(sent.at(-1).figureUris['assets/image.png']);
  const errors = [];
  vscode.window.showErrorMessage = message => errors.push(message);
  doc.isDirty = true;
  doc.save = async () => false;
  vscode.workspace.textDocuments = [doc];
  await receive({ command: 'compile' });
  assert.match(errors.at(-1), /Save the document/);
  assert.equal(sent.at(-1).success, false);
});
