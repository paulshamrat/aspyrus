import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { RichDocument } from '../src/rich-latex.js';

test('handover interface starts and code/visual switches preserve a CV', async () => {
  const html = readFileSync('editor/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4848',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const source = '\\documentclass{article}\n\\begin{document}\nHello world\n\\end{document}\n';
  window.RichDocument = RichDocument;
  window.pdfjsLib = { GlobalWorkerOptions: {} };
  window.document.execCommand = () => true;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  let value = '';
  const editor = {
    setValue: (v) => {
      value = v;
    },
    getValue: () => value,
    addAction: () => {},
    addCommand: () => {},
    layout: () => {},
    focus: () => {},
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getModel: () => ({ getLineContent: () => '', findMatches: () => [] }),
  };
  window.monaco = {
    languages: { register: () => {}, setMonarchTokensProvider: () => {} },
    editor: { create: () => editor, setTheme: () => {}, setModelMarkers: () => {} },
    KeyMod: { CtrlCmd: 1, Alt: 2 },
    KeyCode: { KeyS: 1, Enter: 2, KeyZ: 3 },
  };
  window.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: source,
      file_path: '/tmp/example.tex',
      file_name: 'example.tex',
      revision: '1',
      engine: 'pdflatex',
      pdf_exists: false,
    }),
  });
  const script = readFileSync('editor/src/app.js', 'utf8').replace(/^import .*;\n/gm, '');
  window.eval(script);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(window.document.getElementById('active-filename').textContent, 'example.tex');
  assert.match(window.document.getElementById('visual-body').textContent, /Hello world/);
  window.document.getElementById('btn-mode-code').click();
  assert.equal(value, source);
  window.document.getElementById('btn-mode-visual').click();
  assert.equal(value, source);
  dom.window.close();
});
