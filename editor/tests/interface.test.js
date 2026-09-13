import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { RichDocument } from '../src/rich-latex.js';
import { escapeHtml } from '../src/latex.js';

test('visual canvas interface starts and renders document', async () => {
  const html = readFileSync('editor/index.html', 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:4848',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const source = '\\documentclass{article}\n\\begin{document}\nHello world\n\\end{document}\n';
  window.RichDocument = RichDocument;
  window.escapeHtml = escapeHtml;
  window.document.execCommand = () => true;
  window.HTMLElement.prototype.scrollIntoView = () => {};

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
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(window.document.getElementById('active-filename').textContent, 'example.tex');
  assert.match(window.document.getElementById('visual-body').textContent, /Hello world/);

  dom.window.close();
});
