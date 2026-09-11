import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { RichDocument } from '../src/rich-latex.js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const example = String.raw`\documentclass{article}
\newcommand{\cvsection}[1]{\section*{#1}}
\begin{document}
\begin{center}
{\fontsize{16pt}{18pt}\selectfont\textbf{Example Person}} \\[2pt]
Contact information
\end{center}
\cvsection{Education}
\textbf{Role} \hfill 2026 \\
\begin{tabular}{ll}
2026 & Award \\
\end{tabular}
\begin{itemize}
\item First item
\end{itemize}
% preserve comment
\custom{value}
\end{document}
`;
function render(source) {
  const dom = new JSDOM('<textarea></textarea><main></main>');
  const rich = new RichDocument(
    dom.window.document.querySelector('main'),
    dom.window.document.querySelector('textarea'),
  );
  rich.render(source);
  return rich;
}
test('CV has visual header, entries, tables and lists without no-op source changes', () => {
  const rich = render(example);
  assert.equal(rich.serialize(), example);
  for (const selector of ['.cv-header-block', '.cv-entry-row', 'table', 'li', '.cv-section-title'])
    assert.ok(rich.container.querySelector(selector), selector);
});
test('CV edit preserves other source and custom commands', () => {
  const rich = render(example);
  rich.container.querySelector('li').textContent = 'Updated item';
  const updated = rich.serialize();
  assert.match(updated, /Updated item/);
  assert.ok(updated.includes('\\custom{value}'));
  assert.ok(updated.includes('% preserve comment'));
  assert.ok(updated.includes('\\begin{tabular}{ll}\n2026 & Award \\\\\n\\end{tabular}'));
});
test('alignment and spacing serialize to LaTeX rather than HTML', () => {
  const rich = render(example);
  const heading = rich.container.querySelector('h2');
  heading.style.textAlign = 'right';
  heading.style.marginBottom = '4pt';
  const updated = rich.serialize();
  assert.match(updated, /\\raggedleft/);
  assert.match(updated, /\\vspace\{4pt\}/);
  assert.ok(!updated.includes('<h2'));
});
const demo = 'demo/main.tex';
test('local handover demo round-trip and visual structure', { skip: !existsSync(demo) }, () => {
  const source = readFileSync(demo, 'utf8'),
    rich = render(source);
  assert.equal(rich.serialize(), source);
  assert.equal(rich.container.querySelectorAll('table').length, 3);
  assert.ok(rich.container.querySelectorAll('li').length > 20);
  assert.match(rich.container.querySelector('.cv-name').textContent, /Shamrat/);
  const heading = rich.container.querySelector('h2');
  heading.style.textAlign = 'right';
  writeFileSync('/tmp/localleaf-demo-edited.tex', rich.serialize());
});

test('removing an unknown source token cannot silently corrupt the file', () => {
  const rich = render(example);
  rich.container.querySelector('[data-latex]').remove();
  assert.throws(() => rich.serialize(), /Protected math or LaTeX/);
});
