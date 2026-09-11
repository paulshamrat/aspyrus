import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, applyEdits, escapeLatex, serializeInline } from '../src/latex.js';

const source =
  '\\documentclass{article}\r\n\\begin{document}\r\n% keep comment\r\n\\section{Introduction}\r\nHello world.\r\n$x^{2}$\r\n\\custom{untouched}\r\n\\end{document}\r\n';
test('no edits preserve every byte, including comments and CRLF', () => {
  const blocks = parseSource(source);
  assert.equal(blocks.map((b) => b.raw).join(''), source);
  assert.equal(applyEdits(source, []), source);
  assert.equal(blocks.filter((b) => b.html !== null).length, 2);
});
test('editing a heading preserves its command and unrelated source', () => {
  const block = parseSource(source).find((b) => b.tag === 'h2');
  const result = applyEdits(source, [
    { ...block, text: block.prefix + 'Updated' + block.suffix + block.newline },
  ]);
  assert.equal(result, source.replace('Introduction', 'Updated'));
});
test('HTML is escaped and complex environments remain protected', () => {
  const blocks = parseSource(
    '\\begin{document}\n<img src=x onerror="alert(1)">\n\\begin{equation}\nx+y\n\\end{equation}\n\\end{document}',
  );
  assert.match(blocks[1].html, /&lt;img/);
  assert.equal(blocks[3].html, null);
});
test('conditional contents stay protected', () => {
  const blocks = parseSource(
    '\\begin{document}\n\\ifdraft\nOriginal\n\\else\nAlternate\n\\fi\nText\n\\end{document}',
  );
  assert.equal(blocks[2].html, null);
  assert.equal(blocks[4].html, null);
  assert.equal(blocks[6].html, 'Text');
});
test('edits are escaped as LaTeX, never inserted as HTML', () => {
  assert.equal(escapeLatex('50% & $10'), '50\\% \\& \\$10');
  const node = { tagName: 'SPAN', childNodes: [{ nodeType: 3, textContent: '50%' }] };
  assert.equal(serializeInline(node), '50\\%');
});
test('overlapping patches are rejected', () => {
  assert.throws(() =>
    applyEdits('abcdef', [
      { start: 1, end: 4, text: 'x' },
      { start: 2, end: 5, text: 'y' },
    ]),
  );
});
