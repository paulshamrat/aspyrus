import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, serializeDocument, inlineToHtml, escapeLatex } from '../src/parser.js';
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

test('roundtrip exact match on kras main.tex with zero edits and title included', () => {
  const krasPath = '/home/paul/works/alexovlab/manuscript/kras/main.tex';
  if (!fs.existsSync(krasPath)) return;

  const originalSource = fs.readFileSync(krasPath, 'utf8');
  const parsed = parseDocument(originalSource);

  assert.ok(parsed.titleInfo, 'Title should be extracted');
  assert.equal(
    parsed.titleInfo.text,
    'Oncogenic KRAS Mutations Alter Switch II Dynamics and Conformational Flexibility',
  );

  // Mock DOM container
  const children = [];
  for (const block of parsed.blocks) {
    if (block.hidden) continue;
    block.snapshot = block.html;
    children.push({
      dataset: { blockId: String(block.id), cmd: block.cmd },
      innerHTML: block.html,
      querySelector: () => null,
      childNodes: [],
    });
  }

  const mockContainer = {
    children,
    querySelector: (selector) => {
      if (selector === '[data-cmd="title"]') {
        return {
          dataset: { cmd: 'title' },
          childNodes: [{ nodeType: 3, textContent: parsed.titleInfo.text }],
        };
      }
      return null;
    },
  };

  const result = serializeDocument(parsed, mockContainer);
  assert.equal(result, originalSource);
});
