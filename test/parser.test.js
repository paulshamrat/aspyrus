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

test('math typography formats Greek letters, subscripts, superscripts, and operators', () => {
  const input = '$<9.0$ and $\\alpha/\\beta$ and $R_g \\in [14.76, 15.37]$ and $d_{\\text{pocket}} \\ge 11.0$';
  const html = inlineToHtml(input);
  assert.ok(html.includes('&lt;9.0'));
  assert.ok(html.includes('α/β'));
  assert.ok(html.includes('R<sub>g</sub>'));
  assert.ok(html.includes('∈'));
  assert.ok(html.includes('d<sub>pocket</sub>'));
  assert.ok(html.includes('≥'));
  // Ensure raw LaTeX is preserved in data-latex for byte-for-byte serialization
  assert.ok(html.includes('data-latex="$&lt;9.0$"'));
  assert.ok(html.includes('data-latex="$\\alpha/\\beta$"'));
});

test('ties and dashes are correctly rendered and escaped back to LaTeX', () => {
  const input = 'Figure~1 with 14.76--15.37~\\AA---allosteric';
  const html = inlineToHtml(input);
  assert.ok(html.includes('&nbsp;'));
  assert.ok(html.includes('–')); // en-dash
  assert.ok(html.includes('—')); // em-dash

  const roundtripped = escapeLatex('Figure\u00A01 with 14.76\u201315.37\u00A0Å\u2014allosteric');
  assert.ok(roundtripped.includes('Figure~1'));
  assert.ok(roundtripped.includes('14.76--15.37~'));
  assert.ok(roundtripped.includes('---allosteric'));
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
