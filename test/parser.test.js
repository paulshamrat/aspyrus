import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCanvasTypography, parseDocument, serializeDocument, inlineToHtml, escapeLatex, domNodeToLatex, isUprightMeasurementMath, extractTabular, parseColumnAlignments, parseTabularToHtml, serializeHtmlTableToLatex } from '../src/parser.js';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';

test('detectCanvasTypography reads a 12 pt one-and-a-half-spaced article profile', () => {
  const profile = detectCanvasTypography([
    '\\documentclass[letterpaper,12pt]{article}',
    '\\usepackage{caption}',
    '\\usepackage{setspace}',
    '\\captionsetup{font=normalsize}',
    '\\onehalfspacing',
    '\\titleformat{\\section}{\\normalfont\\bfseries\\normalsize}{}{0pt}{}',
    '\\titleformat{\\subsection}{\\normalfont\\bfseries\\normalsize}{}{0pt}{}',
    '\\renewcommand{\\@maketitle}{\\noindent{\\normalfont\\bfseries\\normalsize \\@title\\par}}',
    '\\begin{document}',
  ].join('\n'));
  assert.deepEqual(profile, {
    isLatexArticle: true,
    baseSizePt: 12,
    usesOneHalfSpacing: true,
    titleSize: 'normal',
    normalHeadingCommands: ['section', 'subsection'],
    captionSize: 'normal',
  });
});

test('escapeLatex preserves ties and escapes reserved chars', () => {
  assert.equal(escapeLatex('Figure~1 & Section #2%'), 'Figure~1 \\& Section \\#2\\%');
});

test('escapeLatex preserves typed citation and reference macros without escaping braces', () => {
  const typed = 'See previous study\\revref{Landrum2026RDKit} and \\cite{Smith2024} for details & data.';
  const escaped = escapeLatex(typed);
  assert.equal(escaped, 'See previous study\\revref{Landrum2026RDKit} and \\cite{Smith2024} for details \\& data.');
});

test('inlineToHtml renders colored text, citations, and math', () => {
  const input = '\\textcolor{blue}{G12C} has $k_{\\text{cat}}$ with \\cite{ref1} and \\ref{fig1}.';
  const html = inlineToHtml(input);
  assert.ok(html.includes('data-color="blue"'));
  assert.ok(html.includes('latex-math'));
  assert.ok(html.includes('latex-cite'));
  assert.ok(html.includes('latex-ref'));
});

test('inline box wrappers mbox and hbox unwrap cleanly to canvas and roundtrip to LaTeX', () => {
  const input = 'The activity of \\mbox{K-Ras} is controlled by \\hbox{switch cycles}.';
  const html = inlineToHtml(input);
  assert.ok(html.includes('<span data-latex-cmd="mbox">K-Ras</span>'));
  assert.ok(html.includes('<span data-latex-cmd="hbox">switch cycles</span>'));
  assert.ok(!html.includes('latex-token'));
  const dom = new JSDOM(html);
  const back = domNodeToLatex(dom.window.document.body);
  assert.equal(back, input);
});

test('numeric measurements and charge-only math render upright without changing symbolic math', () => {
  const dimensions = '$30 ' + '\\' + 'times 30 ' + '\\' + 'times 30$';
  const tolerance = '$1.0 ' + '\\' + 'pm 0.1$';
  const rate = '$k_{' + '\\' + 'text{cat}}$';
  assert.equal(isUprightMeasurementMath('$^{2+}$'), true);
  assert.equal(isUprightMeasurementMath(String.raw`\(−3.6\)`), true);
  assert.equal(isUprightMeasurementMath('$30×30×30$'), true);
  assert.equal(isUprightMeasurementMath(dimensions), true);
  assert.equal(isUprightMeasurementMath(tolerance), true);
  assert.equal(isUprightMeasurementMath(String.raw`$>15\text{~\AA}$`), true);
  assert.equal(isUprightMeasurementMath(String.raw`$\leq 3.0\text{~\AA}$`), true);
  assert.equal(isUprightMeasurementMath(String.raw`$-0.56\text{~kcal/mol}$`), true);
  assert.equal(isUprightMeasurementMath('$^\\prime$'), true);
  assert.equal(isUprightMeasurementMath('$5^\\prime$'), true);
  assert.equal(isUprightMeasurementMath("$5'$"), true);
  assert.equal(isUprightMeasurementMath('$R_g$'), false);
  assert.equal(isUprightMeasurementMath(rate), false);
  assert.equal(isUprightMeasurementMath("$f'(x)$"), false);

  const input = 'Mg$^{2+}$ and ' + dimensions + '~' + '\\' + 'AA{} boxes; $R_g$.';
  const html = inlineToHtml(input);
  assert.equal((html.match(/math-measurement/g) || []).length, 2);
  assert.match(html, /latex-token latex-math"[^>]*>R<sub>g<\/sub>/);
});
test('math typography formats Greek letters, subscripts, superscripts, and operators', () => {
  const input = '$<9.0$ and $\\alpha/\\beta$ and $R_g \\in [14.76, 15.37]$ and $d_{\\text{pocket}} \\ge 11.0$ and $\\mathbf{r}$ and the 5$^\\prime$ splice donor site with $f\'(x)$ and $25^\\circ$C';
  const html = inlineToHtml(input);
  assert.ok(html.includes('&lt;9.0'));
  assert.ok(new JSDOM(html).window.document.body.textContent.includes('α/β'));
  assert.ok(html.includes('R<sub>g</sub>'));
  assert.ok(html.includes('∈'));
  assert.ok(html.includes('d<sub><span class="math-upright">pocket</span></sub>'));
  assert.ok(html.includes('≥'));
  assert.ok(html.includes('<strong class="math-bold">r</strong>'));
  assert.ok(html.includes('5<span class="latex-token latex-math math-measurement" data-latex="$^\\prime$" data-initial="′" title="Math: $^\\prime$">′</span> splice donor site'));
  assert.ok(new JSDOM(html).window.document.body.textContent.includes('f′(x)'));
  assert.ok(new JSDOM(html).window.document.body.textContent.includes('25°'));
  // Ensure raw LaTeX is preserved in data-latex for byte-for-byte serialization
  assert.ok(html.includes('data-latex="$&lt;9.0$"'));
  assert.ok(html.includes('data-latex="$\\alpha/\\beta$"'));
  assert.ok(html.includes('data-latex="$^\\prime$"'));
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

test('textasciitilde renders as visual tilde symbol and roundtrips to LaTeX', () => {
  const input = 'transiently reaching up to \\textasciitilde{}3.0~\\AA{} during opening';
  const html = inlineToHtml(input);
  assert.ok(html.includes('data-latex="\\textasciitilde{}"'));
  assert.ok(html.includes('>~</span>'));
  assert.ok(!html.includes('>\\textasciitilde{}</span>'));
  const dom = new JSDOM(html);
  const back = domNodeToLatex(dom.window.document.body);
  assert.equal(back, input);
});

test('quote ligatures and large operator math bounds are correctly rendered and escaped back to LaTeX', () => {
  const quoteInput = "A localized ``traffic jam'' of molecular signals";
  const quoteHtml = inlineToHtml(quoteInput);
  assert.ok(quoteHtml.includes('“traffic jam”'));
  assert.equal(escapeLatex("A localized “traffic jam” of molecular signals"), "A localized ``traffic jam'' of molecular signals");

  const mathInput = '\\(H_{\\mathrm{norm}} = -\\sum_{i=1}^{K}p_i\\ln(p_i)/\\ln(K)\\)';
  const mathHtml = inlineToHtml(mathInput);
  assert.ok(mathHtml.includes('math-limits'));
  assert.equal(new JSDOM(mathHtml).window.document.querySelector('.math-limit-op').textContent, '∑');
  assert.ok(mathHtml.includes('math-limit-sup">K</sup>'));
  assert.equal(new JSDOM(mathHtml).window.document.querySelector('.math-limit-sub').textContent, 'i=1');

  const deltaInput = '\\(\\Delta H_{\\mathrm{norm}}\\)';
  const deltaHtml = inlineToHtml(deltaInput);
  assert.ok(new JSDOM(deltaHtml).window.document.body.textContent.includes('ΔHnorm'));
  assert.ok(mathHtml.includes('−')); // mathematical minus U+2212

  const hlInput = '\\pihighlight{lost in 4 pathogenic variants}';
  const hlHtml = inlineToHtml(hlInput);
  assert.ok(hlHtml.includes('<mark class="latex-highlight" data-latex-cmd="pihighlight">lost in 4 pathogenic variants</mark>'));
});

test('figure previews leave authored widths in source rather than canvas styling', () => {
  for (const options of [String.raw`width=0.82\textwidth`, String.raw`width=0.6\linewidth`, 'width=3in,height=2in,keepaspectratio']) {
    const graphics = `\\includegraphics[${options}]{fig2.png}`;
    const src = `\\begin{figure}[htbp]\n\\centering\n${graphics}\n\\caption{Sample caption}\n\\label{fig:sample}\n\\end{figure}`;
    const doc = parseDocument(`\\begin{document}\n${src}\n\\end{document}`);
    const card = doc.blocks.find((b) => b.hasCaption);
    const dom = new JSDOM(card.html);
    assert.equal(dom.window.document.querySelector('.float-image-preview').getAttribute('style'), null);
    assert.equal(dom.window.document.querySelector('.float-image-preview').dataset.imagePath, 'fig2.png');
    assert.ok(card.raw.includes(graphics));
    dom.window.close();
  }
});

test('math tokens can be edited and serialize back to updated LaTeX numbers', () => {

  // 1. Untouched math node preserves original LaTeX
  const untouchedNode = {
    nodeType: 1,
    className: 'latex-token latex-math',
    innerHTML: '300 ± 2',
    dataset: { latex: '$300 \\pm 2$', initial: '300 ± 2' },
    childNodes: [{ nodeType: 3, textContent: '300 ± 2' }],
  };
  assert.equal(domNodeToLatex(untouchedNode), '$300 \\pm 2$');

  // 2. Edited number inside math node updates cleanly
  const editedNumberNode = {
    nodeType: 1,
    className: 'latex-token latex-math',
    innerHTML: '310 ± 2',
    dataset: { latex: '$300 \\pm 2$', initial: '300 ± 2' },
    childNodes: [{ nodeType: 3, textContent: '310 ± 2' }],
  };
  assert.equal(domNodeToLatex(editedNumberNode), '$310 \\pm 2$');

  // 3. Edited inequality / comparison
  const editedCompNode = {
    nodeType: 1,
    className: 'latex-token latex-math',
    innerHTML: '&lt;9.5',
    dataset: { latex: '$<9.0$', initial: '&lt;9.0' },
    childNodes: [{ nodeType: 3, textContent: '<9.5' }],
  };
  assert.equal(domNodeToLatex(editedCompNode), '$<9.5$');

  // 4. Edited RMSD tolerance
  const editedRMSDNode = {
    nodeType: 1,
    className: 'latex-token latex-math',
    innerHTML: '1.45 ± 0.10',
    dataset: { latex: '$1.44 \\pm 0.10$', initial: '1.44 ± 0.10' },
    childNodes: [{ nodeType: 3, textContent: '1.45 ± 0.10' }],
  };
  assert.equal(domNodeToLatex(editedRMSDNode), '$1.45 \\pm 0.10$');
});

test('webview waits for confirmed canvas save before compiling', () => {
  const editorSource = fs.readFileSync(new URL('../src/webview/editor.js', import.meta.url), 'utf8');
  assert.ok(editorSource.includes('let pendingCompile = false;'));
  assert.match(editorSource, /pendingCompile = true;\s*clearTimeout\(autoSaveTimer\);\s*saveDocument\(\);\s*return;/);
  assert.match(editorSource, /if \(pendingCompile\) \{\s*pendingCompile = false;\s*startCompile\(\);/);
});
test('raw TeX updates are content-aware and cannot be dropped by a save timer', () => {
  const extensionSource = fs.readFileSync(new URL('../src/extension.cjs', import.meta.url), 'utf8');
  assert.ok(extensionSource.includes('let lastCanvasContent = doc.getText();'));
  assert.ok(extensionSource.includes("lastCanvasContent = content;"));
  assert.ok(extensionSource.includes('if (updatedContent === lastCanvasContent) return;'));
  assert.ok(!extensionSource.includes('&& !isInternalSave'));
});

test('raw TeX updates replace stale dirty canvas blocks', () => {
  const editorSource = fs.readFileSync(new URL('../src/webview/editor.js', import.meta.url), 'utf8');
  assert.match(editorSource, /case 'externalUpdate':[\s\S]*clearTimeout\(autoSaveTimer\);[\s\S]*renderDocument\(message.content \|\| ''\);/);
  assert.ok(!editorSource.includes("Disk changed (unsaved edits)"));
});

test('webview exposes compact canvas undo and redo controls', () => {
  const html = fs.readFileSync(new URL('../src/webview/index.html', import.meta.url), 'utf8');
  const editorSource = fs.readFileSync(new URL('../src/webview/editor.js', import.meta.url), 'utf8');
  assert.ok(html.includes('id="btn-undo"'));
  assert.ok(html.includes('id="btn-redo"'));
  assert.ok(editorSource.includes("runHistoryCommand('undo')"));
  assert.ok(editorSource.includes("runHistoryCommand('redo')"));
  assert.ok(editorSource.includes('function recordCanvasHistory()'));
});

test('roundtrip exact match on example main.tex with zero edits and title included', () => {
  const examplePath = new URL('../example/main/main.tex', import.meta.url).pathname;
  if (!fs.existsSync(examplePath)) return;

  const originalSource = fs.readFileSync(examplePath, 'utf8');
  const parsed = parseDocument(originalSource);

  assert.ok(parsed.titleInfo, 'Title should be extracted');
  assert.equal(
    parsed.titleInfo.text,
    'Scientific Manuscript Template and Style Demonstration',
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

test('display equations and fractions/roots render with publication-grade markup', () => {
  const source = `\\begin{document}
\\begin{equation}
E = \\frac{m c^2}{\\sqrt{1 - v^2}}
\\end{equation}
\\end{document}`;
  const parsed = parseDocument(source);
  const eqBlock = parsed.blocks.find((b) => b.isEquation);
  assert.ok(eqBlock, 'Equation block should be detected');
  assert.ok(eqBlock.html.includes('latex-equation-block'));
  assert.ok(eqBlock.html.includes('math-frac'));
  assert.ok(eqBlock.html.includes('math-sqrt'));
});

test('revref citations and label hiding in cdkl5-modulation manuscript', () => {
  const sample = `\\subsection{Small-Molecule Screening}
\\label{subsec:methods-small-molecule-screening}

RDKit (version 2025.09.5)\\revref{Landrum2026RDKit} was used.`;
  const parsed = parseDocument(`\\begin{document}\n${sample}\n\\end{document}`);

  // Label block must be hidden
  const labelBlock = parsed.blocks.find((b) => b.raw.includes('label{subsec:methods-small-molecule-screening}'));
  assert.ok(labelBlock, 'Label block must exist');
  assert.equal(labelBlock.hidden, true, 'Label block must be hidden from visual DOM');

  // revref citation must be rendered as a chip
  const para = parsed.blocks.find((b) => b.raw.includes('RDKit'));
  assert.ok(para, 'Paragraph block must exist');
  assert.ok(para.html.includes('class="latex-token latex-cite"'), 'revref should render as citation chip');
  assert.ok(para.html.includes('[Landrum2026RDKit]'), 'revref should display key in brackets');
  assert.ok(para.html.includes('data-latex="\\revref{Landrum2026RDKit}"'), 'revref data-latex should preserve original macro');
});

test('getBibContext discovers shared references from either authored folder', async (t) => {
  const { createRequire } = await import('node:module');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  const { getBibContext } = require('../src/extension.cjs');
  const root = fs.mkdtempSync(path.join(tmpdir(), 'localleaf-bib-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, '.localleaf.json'), '{}');
  fs.mkdirSync(path.join(root, 'references'));
  fs.writeFileSync(path.join(root, 'references', 'references.bib'), '@article{Example, title={A shared reference}, author={Person, A.}, year={2020}, doi={10.1234/example}}');
  for (const name of ['main', 'supplementary']) {
    fs.mkdirSync(path.join(root, name));
    const file = path.join(root, name, name + '.tex');
    fs.writeFileSync(file, String.raw`\usepackage[super]{natbib}
\begin{document}Prose\cite{Example}\bibliography{../references/references}\end{document}`);
    const context = getBibContext(file);
    assert.equal(context.isSuperscript, true);
    assert.equal(context.citeNumbers.Example, '1');
    assert.equal(context.doiMap.Example, '10.1234/example');
    assert.equal(context.metaMap.Example.title, 'A shared reference');
  }
  assert.doesNotThrow(() => getBibContext(path.join(root, 'missing.tex')));
});

test('figure cards retain their relative asset path for safe webview previewing', () => {
  const source = String.raw`\begin{document}
\begin{figure}
\includegraphics[width=\textwidth]{assets/figures/example.png}
\caption{Example figure.}
\label{fig:example}
\end{figure}
\end{document}`;
  const parsed = parseDocument(source);
  const figure = parsed.blocks.find((block) => block.hasCaption);
  assert.ok(figure, 'Figure block should be recognized');
  assert.equal(figure.imagePath, 'assets/figures/example.png');
  assert.ok(figure.html.includes('data-image-path="assets/figures/example.png"'));
  assert.ok(figure.html.includes('float-image-preview'));
  assert.ok(figure.html.includes('class="float-caption-prefix" contenteditable="false" data-latex="">Figure 1.</span>'));
  assert.ok(!figure.html.includes('float-header'), 'Technical source metadata should not appear in the authoring canvas');
});

test('figure numbering dynamically computes main vs supplementary numbering', () => {
  const source = String.raw`\begin{document}
\begin{figure}
\includegraphics{assets/figures/fig1.png}
\caption{Proximity analysis.}
\label{fig:spatial-proximity}
\end{figure}

\begin{figure}
\includegraphics{assets/figures/fig2.png}
\caption{Allosteric network.}
\label{fig:allosteric-network}
\end{figure}

\renewcommand{\thefigure}{S\arabic{figure}}
\setcounter{figure}{0}

\noindent
\begin{minipage}{\textwidth}
\includegraphics{assets/figures/figS1.png}
\captionof{figure}{Supplementary details.}
\label{fig:distal-breakdown}
\end{minipage}
\end{document}`;

  const parsed = parseDocument(source);
  const figures = parsed.blocks.filter((b) => b.hasCaption);
  assert.equal(figures.length, 3);
  assert.equal(figures[0].displayNumber, '1');
  assert.equal(figures[0].captionPrefix, 'Figure 1.');
  assert.equal(figures[1].displayNumber, '2');
  assert.equal(figures[1].captionPrefix, 'Figure 2.');
  assert.equal(figures[2].displayNumber, 'S1');
  assert.equal(figures[2].captionPrefix, 'Figure S1.');
});

test('splitBodyChunks isolates top-level directives, minipages, and clearpage', () => {
  const source = `\\renewcommand{\\thefigure}{S\\arabic{figure}}
\\setcounter{figure}{0}

\\noindent
\\begin{minipage}{\\textwidth}
  \\centering
  \\includegraphics[width=\\textwidth]{assets/figures/receptor_sites_overview.png}
  \\captionof{figure}{\\textbf{Holo ATP--Mg CDKL5 receptor-site review.} Overview.}
  \\label{fig:S1}
\\end{minipage}
\\clearpage
`;
  const parsed = parseDocument(`\\begin{document}\n${source}\\end{document}`);

  // Directives should be hidden
  const renewBlock = parsed.blocks.find((b) => b.raw.includes('renewcommand'));
  assert.ok(renewBlock && renewBlock.hidden, 'renewcommand must be hidden');

  const noindentBlock = parsed.blocks.find((b) => b.raw.includes('noindent'));
  assert.ok(noindentBlock && noindentBlock.hidden, 'noindent must be hidden');

  const clearpageBlock = parsed.blocks.find((b) => b.raw.includes('clearpage'));
  assert.ok(clearpageBlock && clearpageBlock.hidden, 'clearpage must be hidden');

  // Minipage should have editable caption card and recognized as FIGURE
  const figBlock = parsed.blocks.find((b) => b.raw.includes('begin{minipage}'));
  assert.ok(figBlock, 'Minipage block must exist');
  assert.equal(figBlock.hasCaption, true, 'Minipage with caption must have hasCaption: true');
  assert.ok(figBlock.html.includes('class="float-caption-prefix" contenteditable="false" data-latex="">Figure S1.</span>'), 'Minipage with captionof{figure} must render its visible figure number');
  assert.ok(!figBlock.html.includes('float-header'), 'Technical source metadata must not appear above a manuscript caption');
  assert.ok(figBlock.html.includes('class="float-caption-body" contenteditable="true"'), 'Caption body must be contenteditable');
  assert.ok(figBlock.html.includes('Holo ATP–Mg CDKL5 receptor-site review'), 'Caption text must be rendered in caption body');

  // Verify byte-for-byte untouched serialization
  const children = parsed.blocks.filter((b) => !b.hidden).map((b) => {
    b.snapshot = b.html;
    return {
      dataset: { blockId: String(b.id) },
      innerHTML: b.html,
      querySelector: () => null,
      childNodes: [],
    };
  });
  const mockContainer = { children, querySelector: () => null };
  const reserialized = serializeDocument(parsed, mockContainer);
  assert.equal(reserialized, `\\begin{document}\n${source}\\end{document}`);
});

test('escapeLatex preserves includegraphics, urls, and labels with underscores', () => {
  const input = 'See \\includegraphics[width=\\textwidth]{assets/figures/receptor_sites_overview.png} and \\url{https://example.com/site_id} & 50% WT.';
  const escaped = escapeLatex(input);
  assert.ok(escaped.includes('assets/figures/receptor_sites_overview.png'), 'Image filename underscores must not be escaped');
  assert.ok(escaped.includes('https://example.com/site_id'), 'URL underscores must not be escaped');
  assert.ok(escaped.includes('\\&'), '& must still be escaped');
  assert.ok(escaped.includes('\\%'), '% must still be escaped');
});

test('webview template and styles include theme toggle and multi-theme rules', () => {
  const html = fs.readFileSync(new URL('../src/webview/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/webview/styles.css', import.meta.url), 'utf8');

  assert.ok(html.includes('id="btn-theme-toggle"'), 'Theme toggle button must be present in index.html');
  assert.ok(html.includes('class="theme-icon-sun"'), 'Sun icon must be present');
  assert.ok(html.includes('class="theme-icon-moon"'), 'Moon icon must be present');
  assert.ok(css.includes('body.vscode-high-contrast'), 'High contrast dark theme must be supported');
  assert.ok(css.includes('body.vscode-high-contrast-light'), 'High contrast light theme must be supported');
  assert.ok(css.includes('body.theme-light'), 'Manual theme-light override must be supported');
  assert.ok(css.includes('body.theme-dark'), 'Manual theme-dark override must be supported');
  assert.ok(css.includes('margin-left: auto;'), 'toolbar-right must be positioned at rightmost corner');
});






test('clearpage does not hide the following section heading', () => {
  const source = [
    '\\documentclass{article}',
    '\\begin{document}',
    'Methods text.',
    '\\clearpage',
    '\\section{Supplementary Materials}',
    '\\subsection{Receptor Preparation}',
    'Supplementary prose.',
    '\\end{document}',
  ].join('\n');
  const document = parseDocument(source, { fileName: 'main.tex' });
  assert.ok(document.blocks.some((block) => (block.html || '').includes('Supplementary Materials')));
});

test('compiled cache resolves label numbers, pages and kinds from the open document only', async t => {
  const {createRequire} = await import('node:module');
  const {tmpdir} = await import('node:os');
  const path = await import('node:path');
  const {getBibContext} = createRequire(import.meta.url)('../src/extension.cjs');
  const root=fs.mkdtempSync(path.join(tmpdir(),'localleaf-labels-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'.localleaf_build'));
  fs.writeFileSync(path.join(root,'paper.tex'),String.raw`\begin{document}A citation\cite{Example}.\end{document}`);
  fs.writeFileSync(path.join(root,'paper.aux'),String.raw`\bibcite{Example}{9}\newlabel{fig:coverage}{{9}{99}}`);
  fs.writeFileSync(path.join(root,'.localleaf_build/paper.aux'),String.raw`\bibcite{Example}{{1}{2024}{{Person}}{{}}}
\newlabel{fig:coverage}{{1}{3}{A {nested} title}{figure.1}{}}
\newlabel{eq:distance}{{2}{4}{}{equation.2}{}}
\newlabel{sec:methods}{{3}{5}{Methods}{section.3}{}}`);
  const context=getBibContext(path.join(root,'paper.tex'));
  assert.equal(context.citeNumbers.Example,'1');
  assert.deepEqual(context.labelMap,{'fig:coverage':'1','eq:distance':'2','sec:methods':'3'});
  assert.deepEqual(context.labelPages,{'fig:coverage':'3','eq:distance':'4','sec:methods':'5'});
  assert.deepEqual(context.labelKinds,{'fig:coverage':'Figure','eq:distance':'Equation','sec:methods':'section'});
  const other=getBibContext(path.join(root,'supplementary.tex'));
  assert.deepEqual(other.labelMap,{});
});

test('superscript and subscript macros parse to sup/sub tags', () => {
  const doc = parseDocument(String.raw`\begin{document}Energy $E$\textsuperscript{2} and Coordinate $x$\textsubscript{i}.\end{document}`);
  const pBlock = doc.blocks.find((b) => b.tag === 'p');
  assert.ok(pBlock.html.includes('<sup>2</sup>'));
  assert.ok(pBlock.html.includes('<sub>i</sub>'));
});

test('nocite is preserved as a hidden block and serialized byte-for-byte', () => {
  const source = '\\begin{document}\n\nSome text.\n\n\\nocite{Hector2017CDKL5}\n\n\\bibliography{refs}\n\n\\end{document}';
  const doc = parseDocument(source);
  const nociteBlock = doc.blocks.find((b) => b.raw.includes('\\nocite{Hector2017CDKL5}'));
  assert.ok(nociteBlock, 'nocite block found');
  assert.equal(nociteBlock.hidden, true);
  assert.equal(nociteBlock.html, '');
});

test('raw parenthetical DOIs remain pure text without citation tokenization', () => {
  const source = '\\begin{document}\nDestabilization (DOI: 10.1016/j.cell.2021.05.001) in prose.\n\\end{document}';
  const doc = parseDocument(source);
  const pBlock = doc.blocks.find((b) => b.tag === 'p');
  assert.ok(pBlock, 'Paragraph found');
  assert.ok(!pBlock.html.includes('latex-cite'), 'Raw DOI must not be turned into citation badge');
  assert.ok(!pBlock.html.includes('latex-doi'), 'Raw DOI must not be converted into latex-doi class');
  assert.ok(pBlock.html.includes('(DOI: 10.1016/j.cell.2021.05.001)'), 'Raw DOI must remain pure text in HTML');
});

test('toolbar contains symbol picker button and [1] citation button', () => {
  const indexHtml = fs.readFileSync(path.join('src', 'webview', 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('id="btn-symbol-menu"'), 'Must have btn-symbol-menu');
  assert.ok(indexHtml.includes('>Ω</button>'), 'Must have Ω button icon');
  assert.ok(indexHtml.includes('id="btn-cite-mode-menu"'), 'Must have citation mode menu');
  assert.ok(indexHtml.includes('>[1]</button>'), 'Citation mode trigger must display [1]');
});

test('paste as plain text is exposed via context menu and hotkey without toolbar clutter', () => {
  const indexHtml = fs.readFileSync(path.join('src', 'webview', 'index.html'), 'utf8');
  assert.ok(!indexHtml.includes('id="btn-paste-plain"'), 'Toolbar must not contain redundant btn-paste-plain');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const commands = pkg.contributes && pkg.contributes.commands;
  const pasteCommand = commands.find((c) => c.command === 'aspyrus.pastePlainText');
  assert.ok(pasteCommand, 'Must register aspyrus.pastePlainText command');
  assert.strictEqual(pasteCommand.title, 'Paste as Plain Text');

  const webviewMenus = pkg.contributes && pkg.contributes.menus && pkg.contributes.menus['webview/context'];
  assert.ok(webviewMenus, 'Must contribute to webview/context');
  const pasteMenu = webviewMenus.find((m) => m.command === 'aspyrus.pastePlainText');
  assert.ok(pasteMenu, 'Must contribute aspyrus.pastePlainText to webview/context menu');
});

test('elements with dataset.latex serialize as their latex command, not visual text', () => {
  const source = '\\section{Intro}\n\nSome text.\n\n\\bibliography{refs}\n';
  const parsed = parseDocument(source);
  const children = [
    ...parsed.blocks.map((b) => ({
      dataset: { blockId: String(b.id) },
      innerHTML: b.snapshot || b.html || b.raw,
      querySelector: () => null,
      childNodes: [],
    })),
    {
      dataset: { latex: '\\cite{VanBergen2022CDKL5}' },
      innerHTML: '[1]',
      textContent: '[1]',
      childNodes: [{ nodeType: 3, textContent: '[1]' }],
      querySelector: () => null,
    },
  ];
  const mockContainer = { children, querySelector: () => null };
  const serialized = serializeDocument(parsed, mockContainer);
  assert.ok(serialized.includes('\\cite{VanBergen2022CDKL5}'), 'Must serialize as \\cite{...}');
  assert.ok(!serialized.includes('[1]'), 'Must not serialize raw [1]');
});

test('parseTabularToHtml parses booktabs table with column alignments and rules', () => {
  const tabular = `\\begin{tabular}{llr}
\\toprule
\\textbf{Compound} & \\textbf{Target} & \\textbf{Affinity} \\\\
\\midrule
CMPD-101 & CDKL5 & 12.5 \\\\
CMPD-102 & CDKL5 & 45.0 \\\\
\\bottomrule
\\end{tabular}`;

  const html = parseTabularToHtml(tabular);
  assert.ok(html.includes('class="latex-table booktabs"'));
  assert.ok(html.includes('data-colspec="llr"'));
  assert.ok(html.includes('<thead><tr>'));
  assert.ok(html.includes('<th align="left" style="text-align: left;" contenteditable="true"><strong>Compound</strong></th>'));
  assert.ok(html.includes('<th align="right" style="text-align: right;" contenteditable="true"><strong>Affinity</strong></th>'));
  assert.ok(html.includes('<tbody>'));
  assert.ok(html.includes('<td align="left" style="text-align: left;" contenteditable="true">CMPD-101</td>'));
  assert.ok(html.includes('<td align="right" style="text-align: right;" contenteditable="true">12.5</td>'));
});

test('parseDocument renders table environment as publication-grade table card and preserves byte-for-byte serialization', () => {
  const source = `\\begin{document}
\\begin{table}[htbp]
\\centering
\\caption{Current docking campaign status and scale on Palmetto.}
\\label{tab:docking_campaign}
\\resizebox{\\textwidth}{!}{%
\\begin{tabular}{llrrrrrr}
\\toprule
\\textbf{Library} & \\textbf{Dataset Type} & \\textbf{Total Ligands} & \\textbf{Batches} &
\\textbf{Docked} & \\textbf{Failed} & \\textbf{Success Rate} &
\\textbf{Top Score (kcal/mol)} \\\\
\\midrule
ChemBridge & Commercial Diversity & 1,683,063 & 16,831 & 1,682,007 & 1,056 & 99.94\\% & -9.91 \\\\
ChemDiv & Commercial Diversity & 1,661,404 & 16,615 & 1,661,293 & 111 & 99.99\\% & -10.25 \\\\
Enamine & Commercial Diversity & 2,885,206 & 28,853 & 2,881,137 & 4,069 & 99.86\\% & -10.07 \\\\
FDA Approved & Drug Repurposing & 1,922 & 20 & 1,902 & 20 & 98.96\\% & -8.93 \\\\
\\midrule
\\textbf{Total Campaign} & & \\textbf{6,231,595} & \\textbf{62,319} &
\\textbf{6,226,339} & \\textbf{5,256} & \\textbf{99.92\\%} & \\textbf{-10.25} \\\\
\\bottomrule
\\end{tabular}%
}
\\end{table}
\\end{document}`;

  const parsed = parseDocument(source);
  const tableBlock = parsed.blocks.find(b => b.hasCaption);
  assert.ok(tableBlock, 'Table block must be recognized with caption');
  assert.equal(tableBlock.isTable, true);
  assert.equal(tableBlock.captionKind, 'Table');
  assert.equal(tableBlock.displayNumber, '1');
  assert.equal(tableBlock.captionPrefix, 'Table 1.');

  assert.ok(tableBlock.html.includes('class="latex-float-card latex-table-card"'));
  assert.ok(tableBlock.html.includes('class="float-caption-prefix" contenteditable="false" data-latex="">Table 1.</span>'));
  assert.ok(tableBlock.html.includes('Current docking campaign status and scale on Palmetto.'));
  assert.ok(tableBlock.html.includes('class="float-table-preview"'));
  assert.ok(tableBlock.html.includes('ChemBridge'));
  assert.ok(tableBlock.html.includes('1,682,007'));
  assert.ok(tableBlock.html.includes('99.94%'));
  assert.ok(tableBlock.html.includes('table-midrule'));

  // Test 100% byte-for-byte serialization when untouched
  tableBlock.snapshot = tableBlock.html;
  const mockContainer = {
    children: [
      {
        dataset: { blockId: String(tableBlock.id) },
        innerHTML: tableBlock.html,
        querySelector: () => null,
        querySelectorAll: () => [],
      },
    ],
  };
  const reserialized = serializeDocument(parsed, mockContainer);
  assert.equal(reserialized, source, 'Untouched table document must match byte-for-byte');
});

test('table caption edits preserve table body and surrounding environment', () => {
  const source = `\\begin{document}
\\begin{table}[htbp]
\\centering
\\caption{Original caption text.}
\\label{tab:campaign}
\\begin{tabular}{ll}
\\toprule
\\textbf{A} & \\textbf{B} \\\\
\\midrule
1 & 2 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\\end{document}`;

  const parsed = parseDocument(source);
  const tableBlock = parsed.blocks.find(b => b.hasCaption);
  tableBlock.snapshot = tableBlock.html;

  // Simulate editing only the caption in the DOM
  const editedCaptionHtml = `<div class="latex-float-card latex-table-card" data-block-id="${tableBlock.id}" data-env="table">
    <div class="float-caption-body" contenteditable="true">
      <span class="float-caption-prefix" contenteditable="false" data-latex="">Table 1.</span> Updated caption text.
    </div>
    <div class="float-table-preview">${tableBlock.tableHtml}</div>
  </div>`;

  const captionNode = {
    childNodes: [{ nodeType: 3, textContent: 'Updated caption text.' }],
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const mockFloatCard = {
    classList: { contains: (cls) => cls === 'latex-float-card' },
    querySelector: (sel) => {
      if (sel === '.float-caption-body') return captionNode;
      if (sel === 'table.latex-table') return null; // Table was untouched
      if (sel === '.float-table-preview') return { innerHTML: tableBlock.tableHtml };
      return null;
    },
    querySelectorAll: () => [],
    innerHTML: editedCaptionHtml,
  };

  const mockContainer = {
    children: [
      {
        dataset: { blockId: String(tableBlock.id) },
        innerHTML: editedCaptionHtml,
        classList: { contains: (cls) => cls === 'latex-float-card' },
        querySelector: mockFloatCard.querySelector,
        querySelectorAll: () => [],
      },
    ],
  };

  const serialized = serializeDocument(parsed, mockContainer);
  assert.ok(serialized.includes('\\caption{Updated caption text.}'), 'Serialized LaTeX must contain updated caption');
  assert.ok(serialized.includes('\\label{tab:campaign}'), 'Label must be preserved');
  assert.ok(serialized.includes('\\begin{tabular}{ll}'), 'Tabular must be preserved');
  assert.ok(serialized.includes('1 & 2 \\\\'), 'Tabular contents must be preserved');
});


test('universal colour commands and nested blocks preserve source and scope', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\redtext{Red inline} and \bluetext{Blue inline}.

\begin{redblock}
Red paragraph.

\section{Red heading}

\begin{blueblock}
Blue paragraph.

\begin{figure}
\caption{Blue caption.}\label{fig:blue}
\end{figure}
\end{blueblock}

Red again.
\end{redblock}

Ordinary paragraph.
\end{document}`;
  const parsed = parseDocument(source);
  for (const block of parsed.blocks) block.snapshot = block.html;
  const container = { children: parsed.blocks.map(block => ({
    dataset: { blockId: String(block.id) }, innerHTML: block.html,
  })) };
  assert.equal(serializeDocument(parsed, container), source);
  const html = parsed.blocks.map(b => b.html).join('\n');
  assert.match(html, /color: #D32F2F[^>]*data-latex-cmd="redtext"/);
  assert.match(html, /color: #1976D2[^>]*data-latex-cmd="bluetext"/);
  assert.match(html, /color: #D32F2F;[^>]*>Red paragraph/);
  assert.match(html, /color: #D32F2F;[^>]*>Red heading/);
  assert.match(html, /color: #1976D2;[^>]*>Blue paragraph/);
  assert.match(html, /float-caption-body[^>]*color: #1976D2;/);
  assert.match(html, /color: #D32F2F;[^>]*>Red again/);
  assert.match(html, /<p class="latex-paragraph" data-block-id="[^"]*">Ordinary paragraph/);
});


test('upright Greek labels survive saving while symbolic Greek keeps its source', () => {
  assert.equal(escapeLatex('Ω'), '$\\Omega$');
  assert.equal(escapeLatex('αC and β3; μ'), '$\\upalpha$C and $\\upbeta$3; $\\upmu$');
  const source = String.raw`Labels \(\upalpha\)C, C$\upalpha$, \(\upbeta3\); variable \(\chi_1\).`;
  const dom = new JSDOM(inlineToHtml(source));
  assert.equal(domNodeToLatex(dom.window.document.body), source);
  const math = dom.window.document.querySelectorAll('.latex-math');
  assert.equal(math[0].querySelector('.math-upright').textContent, 'α');
  assert.equal(math[3].firstChild.textContent, 'χ');
  const caps = new JSDOM(inlineToHtml(String.raw`\(\Gamma+\Delta+\Theta+\Lambda+\Xi+\Pi+\Sigma+\Upsilon+\Phi+\Psi+\Omega\)`));
  for (const letter of 'ΓΔΘΛΞΠΣΥΦΨΩ') assert.ok([...caps.window.document.querySelectorAll('.math-upright')].some(n => n.textContent === letter));
  const explicit = new JSDOM(inlineToHtml(String.raw`\(\mathit{\Theta}\)`));
  assert.equal(explicit.window.document.querySelector('.math-italic').textContent, 'Θ');
});

test('standard scoped colours preserve source, nested paragraphs and outer restoration', () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\begingroup\color{red}
Redouter with \textbf{bold}.

\begingroup\color{blue}
Blueinner with \(x^2\).
\endgroup

Redrestored.
\endgroup

Ordinary.
\end{document}`;
  const doc = parseDocument(source);
  assert.equal(doc.blocks.map(b => b.raw).join(''), source.split('\\begin{document}')[1].split('\\end{document}')[0]);
  for (const [word, colour] of [['Redouter', 'red'], ['Blueinner', 'blue'], ['Redrestored', 'red']]) {
    assert.ok(doc.blocks.find(b => b.raw.includes(word)).html.includes(`color: ${colour}`));
  }
  assert.ok(!doc.blocks.find(b => b.raw.includes('Ordinary')).html.includes('color: red'));
  assert.ok(doc.blocks.filter(b => /^\\(?:begingroup|endgroup)/.test(b.raw.trim())).every(b => b.hidden));
  for (const block of doc.blocks) block.snapshot = block.html;
  const container = { children: doc.blocks.map(block => ({ dataset: { blockId: String(block.id) }, innerHTML: block.html })) };
  assert.equal(serializeDocument(doc, container), source);
});
