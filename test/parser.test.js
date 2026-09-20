import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, serializeDocument, inlineToHtml, escapeLatex } from '../src/parser.js';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

test('escapeLatex preserves ties and escapes reserved chars', () => {
  assert.equal(escapeLatex('Figure~1 & Section #2%'), 'Figure~1 \\& Section \\#2\\%');
});

test('inlineToHtml renders colored text, citations, and math', () => {
  const input = '\\textcolor{blue}{G12C} has $k_{\\text{cat}}$ with \\cite{ref1} and \\ref{fig1}.';
  const html = inlineToHtml(input);
  assert.ok(html.includes('data-color="blue"'));
  assert.ok(html.includes('latex-math'));
  assert.ok(html.includes('latex-cite'));
  assert.ok(html.includes('latex-ref'));
});

test('roundtrip exact match on kras main.tex with zero edits', () => {
  const krasPath = '/home/paul/works/alexovlab/manuscript/kras/main.tex';
  if (!fs.existsSync(krasPath)) return;

  const originalSource = fs.readFileSync(krasPath, 'utf8');
  const parsed = parseDocument(originalSource);

  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="canvas"></div></body></html>');
  const doc = dom.window.document;
  const canvas = doc.getElementById('canvas');

  for (const block of parsed.blocks) {
    if (block.hidden) continue;
    const el = doc.createElement('div');
    el.dataset.blockId = String(block.id);
    el.innerHTML = block.html;
    block.snapshot = el.innerHTML;
    canvas.appendChild(el);
  }

  const result = serializeDocument(parsed, canvas);
  assert.equal(result, originalSource);
});
