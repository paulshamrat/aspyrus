import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';

const bundle = buildSync({ entryPoints: ['src/webview/editor.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
const source = String.raw`\documentclass{article}
\begin{document}
\section{Results}
\label{sec:results}

Opening paragraph.

\begin{figure}
\includegraphics{assets/example.png}
\caption{Original caption.}
\label{fig:example}
\end{figure}

Move this paragraph with $x^2$ and \cite{example}.

Final paragraph.
\end{document}`;

function canvas(t) {
  const html = fs.readFileSync('src/webview/index.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localleaf.test' });
  t.after(() => dom.window.close());
  const messages = [];
  dom.window.acquireVsCodeApi = () => ({ postMessage: (message) => messages.push(message), setState() {} });
  dom.window.eval(bundle);
  const send = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
  send({ command: 'init', content: source, fileName: 'paper.tex' });
  const document = dom.window.document;
  const paper = document.getElementById('paper-canvas');
  const input = () => paper.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const save = () => {
    document.getElementById('btn-save').click();
    return messages.filter((m) => m.command === 'save').at(-1);
  };
  const ack = (message) => send({ command: 'saveSuccess', saveId: message.saveId });
  return { document, paper, input, save, ack, send, messages };
}

function paragraph(paper, text) {
  return [...paper.children].find((el) => el.textContent.includes(text));
}

test('untouched canvas preserves source byte-for-byte, including hidden commands', (t) => {
  const c = canvas(t);
  assert.equal(c.save().content, source);
});

test('cut/paste paragraph before figure follows canvas order and survives repeated Save', (t) => {
  const c = canvas(t);
  const moved = paragraph(c.paper, 'Move this paragraph');
  const figure = c.paper.querySelector('.latex-float-card').parentElement;
  c.paper.insertBefore(moved, figure);
  c.input();
  const first = c.save();
  assert.ok(first.content.indexOf('Move this paragraph') < first.content.indexOf('\\begin{figure}'));
  assert.equal(first.content.split('Move this paragraph').length - 1, 1);
  assert.ok(first.content.includes('$x^2$ and \\cite{example}'));
  const figureRaw = source.match(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/)[0];
  assert.ok(first.content.includes(figureRaw));
  c.ack(first);
  assert.equal(c.save().content, first.content);
});

test('deleted wrapper stays deleted and an untracked pasted paragraph is saved', (t) => {
  const c = canvas(t);
  paragraph(c.paper, 'Move this paragraph').remove();
  const pasted = c.document.createElement('p');
  pasted.textContent = 'Pasted before figure.';
  c.paper.insertBefore(pasted, c.paper.querySelector('.latex-float-card').parentElement);
  c.input();
  const saved = c.save();
  assert.ok(!saved.content.includes('Move this paragraph'));
  assert.ok(saved.content.indexOf('Pasted before figure.') < saved.content.indexOf('\\begin{figure}'));
  assert.ok(saved.content.includes('\\label{sec:results}'));
});

test('multiple pasted paragraphs within a wrapper are all saved', (t) => {
  const c = canvas(t);
  paragraph(c.paper, 'Opening paragraph').innerHTML = '<p>Opening paragraph.</p><p>Inserted paragraph.</p><div>Another paragraph.</div>';
  c.input();
  const first = c.save();
  assert.ok(first.content.includes('Opening paragraph.\n\nInserted paragraph.\n\nAnother paragraph.'));
  c.ack(first);
  assert.equal(c.save().content, first.content);
});

test('ordinary text edit survives save acknowledgement and a second Save', (t) => {
  const c = canvas(t);
  paragraph(c.paper, 'Opening paragraph').querySelector('p').textContent = 'Edited opening.';
  c.input();
  const first = c.save();
  c.ack(first);
  assert.equal(c.save().content, first.content);
  assert.ok(first.content.includes('Edited opening.'));
});

test('edits during an in-flight save stay unsaved until the next explicit Save', (t) => {
  const c = canvas(t);
  const opening = paragraph(c.paper, 'Opening paragraph').querySelector('p');
  opening.textContent = 'First edit.';
  c.input();
  const first = c.save();
  opening.textContent = 'Second edit.';
  c.input();
  c.save();
  assert.equal(c.messages.filter((m) => m.command === 'save').length, 1);
  c.ack(first);
  assert.equal(c.messages.filter((m) => m.command === 'save').length, 1);
  assert.equal(c.document.getElementById('status-text').textContent, 'Unsaved edits');
  const second = c.save();
  assert.notEqual(second.saveId, first.saveId);
  assert.ok(second.content.includes('Second edit.'));
  assert.equal(c.document.getElementById('status-text').textContent, 'Saving...');
  c.ack(second);
  assert.match(c.document.getElementById('status-text').textContent, /^Saved/);
});

test('external source update invalidates an older save acknowledgement', (t) => {
  const c = canvas(t);
  const first = c.save();
  c.send({ command: 'externalUpdate', content: source.replace('Opening paragraph.', 'Raw editor change.') });
  c.ack(first);
  assert.ok(c.save().content.includes('Raw editor change.'));
});

test('failed saves remain dirty and can be retried', (t) => {
  const c = canvas(t);
  c.input();
  const first = c.save();
  c.send({ command: 'saveError', saveId: first.saveId });
  assert.equal(c.document.getElementById('status-text').textContent, 'Error saving');
  assert.notEqual(c.save().saveId, first.saveId);
});

test('caption edits preserve the figure environment through repeated saves', (t) => {
  const c = canvas(t);
  const graphics = String.raw`\includegraphics[width=0.82\textwidth,keepaspectratio]{assets/example.png}`;
  const fractionalSource = source.replace(String.raw`\includegraphics{assets/example.png}`, graphics);
  c.send({ command: 'init', content: fractionalSource, fileName: 'paper.tex' });
  const caption = c.paper.querySelector('.float-caption-body');
  caption.lastChild.textContent = 'Updated caption.';
  c.input();
  const first = c.save();
  assert.ok(first.content.includes('\\caption{Updated caption.}'));
  assert.equal(first.content, fractionalSource.replace('Original caption.', 'Updated caption.'));
  assert.ok(first.content.includes('\\label{fig:example}'));
  c.ack(first);
  assert.equal(c.save().content, first.content);
});

test('compile waits for the newest edit to finish saving', (t) => {
  const c = canvas(t);
  const opening = paragraph(c.paper, 'Opening paragraph').querySelector('p');
  opening.textContent = 'First edit.';
  c.input();
  const first = c.save();
  opening.textContent = 'Latest edit.';
  c.input();
  c.document.getElementById('btn-compile').click();
  c.ack(first);
  assert.ok(!c.messages.some((m) => m.command === 'compile'));
  const second = c.messages.filter((m) => m.command === 'save').at(-1);
  assert.ok(second.content.includes('Latest edit.'));
  c.ack(second);
  assert.equal(c.messages.filter((m) => m.command === 'compile').length, 1);
});

test('untouched complex source retains comments, equations and citation whitespace', (t) => {
  const c = canvas(t);
  const complex = source.replace('Opening paragraph.', String.raw`Opening   paragraph with \cite{example}.
% Keep this comment exactly.

\begin{equation}
  E = mc^2
\end{equation}`);
  c.send({ command: 'init', content: complex, fileName: 'paper.tex' });
  assert.equal(c.save().content, complex);
});

test('typing and blur checkpoint a draft without saving the manuscript', async (t) => {
  const c = canvas(t);
  paragraph(c.paper, 'Opening paragraph').querySelector('p').textContent = 'Unsaved draft.';
  c.input();
  c.document.defaultView.dispatchEvent(new c.document.defaultView.Event('blur'));
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(c.messages.filter((m) => m.command === 'save').length, 0);
  assert.ok(c.messages.some((m) => m.command === 'checkpoint' && m.content.includes('Unsaved draft.')));
  assert.equal(c.document.getElementById('btn-recovery'), null);
  c.send({command: 'requestRestore'});
  assert.ok(c.messages.some((m) => m.command === 'restore' && m.content.includes('Unsaved draft.')));
});

test('cleared title serializes as empty braces and preserves nested preamble macros', (t) => {
  const c = canvas(t);
  const titled = source.replace('\\begin{document}', '\\title{A \\textbf{nested} title}\n\\author{Author}\n\\begin{document}');
  c.send({ command: 'init', content: titled, fileName: 'paper.tex' });
  const title = c.paper.querySelector('[data-cmd="title"]');
  title.innerHTML = '<br>';
  c.input();
  const saved = c.save();
  assert.ok(saved.content.includes('\\title{}\n\\author{Author}'), saved.content);
  assert.ok(!saved.content.includes('nested'));
  c.ack(saved);
  assert.equal(c.save().content, saved.content);
});

test('host clipboard failure leaves the selected figure intact', (t) => {
  const c = canvas(t);
  const win = c.document.defaultView;
  c.paper.querySelector('.float-image-preview').dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true, cancelable: true }));
  const request = c.messages.find((m) => m.command === 'figureClipboardWrite');
  assert.ok(request.content.includes('\\caption{Original caption.}'));
  assert.ok(request.content.includes('\\label{fig:example}'));
  c.send({ command: 'figureClipboardError', requestId: request.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
  assert.equal(c.save().content, source);
});

test('figure cut/paste succeeds when native edit commands falsely report success', (t) => {
  const c = canvas(t);
  const win = c.document.defaultView;
  c.document.execCommand = () => true; // The failure observed in the live editor.
  c.paper.querySelector('.float-image-preview').dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'x', ctrlKey: true, cancelable: true }));
  const clipboard = c.messages.find((m) => m.command === 'figureClipboardWrite').content;
  c.send({ command: 'figureClipboardWritten', requestId: c.messages.find((m) => m.command === 'figureClipboardWrite').requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
  const cutSave = c.save();
  assert.ok(!cutSave.content.includes('\\begin{figure}'));
  c.ack(cutSave);
  const opening = paragraph(c.paper, 'Opening paragraph').querySelector('p');
  const range = c.document.createRange();
  range.setStart(opening.firstChild, 8);
  range.collapse(true);
  win.getSelection().removeAllRanges();
  win.getSelection().addRange(range);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }));
  c.send({ command: 'figureClipboardRead', content: clipboard, requestId: c.messages.find((m) => m.command === 'figureClipboardRead').requestId });
  const pasted = c.save();
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
  assert.equal(pasted.content.split('\\begin{figure}').length - 1, 1);
  assert.ok(pasted.content.indexOf('Opening') < pasted.content.indexOf('\\begin{figure}'));
  assert.ok(pasted.content.indexOf('\\end{figure}') < pasted.content.indexOf('paragraph.'));
  c.ack(pasted);
  c.document.getElementById('btn-undo').click();
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
  c.document.getElementById('btn-undo').click();
  assert.equal(c.save().content, source);
  c.document.getElementById('btn-redo').click();
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
  c.document.getElementById('btn-redo').click();
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
});

function selectText(c, selector) {
  const range = c.document.createRange();
  range.selectNodeContents(c.paper.querySelector(selector));
  const selection = c.document.defaultView.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.toString();
}

function figureShortcut(c, key) {
  c.paper.focus();
  const event = new c.document.defaultView.KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
  c.document.defaultView.dispatchEvent(event);
  return event;
}

function chooseFigure(c) {
  c.paper.querySelector('.float-image-preview').dispatchEvent(new c.document.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

test('right-click preserves selected prose and caption text after a figure copy', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  figureShortcut(c, 'c');
  const request = c.messages.at(-1);
  c.send({ command: 'figureClipboardWritten', requestId: request.requestId });
  for (const selector of ['p', '.float-caption-body']) {
    const selected = selectText(c, selector);
    const event = new c.document.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    c.paper.querySelector(selector).dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'Leave the native text menu available');
    assert.equal(c.document.defaultView.getSelection().toString(), selected);
    assert.equal(c.document.querySelector('.figure-context-menu').hidden, true);
  }
});

test('text keyboard selection cannot reuse a stale figure selection', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  selectText(c, 'p');
  const event = figureShortcut(c, 'x');
  assert.equal(event.defaultPrevented, false);
  assert.equal(c.messages.filter((m) => m.command === 'figureClipboardWrite').length, 0);
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
});

test('a second copy shortcut cannot turn an unconfirmed cut into a copy', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  figureShortcut(c, 'x');
  const cut = c.messages.at(-1);
  figureShortcut(c, 'c');
  assert.equal(c.messages.filter((m) => m.command === 'figureClipboardWrite').length, 1);
  c.send({ command: 'figureClipboardWritten', requestId: cut.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
});

test('paste waits for cut confirmation and inserts exactly one figure', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  figureShortcut(c, 'x');
  const cut = c.messages.at(-1);
  const destination = c.paper.querySelector('p');
  const range = c.document.createRange();
  range.setStart(destination.firstChild, 8);
  range.collapse(true);
  c.document.defaultView.getSelection().removeAllRanges();
  c.document.defaultView.getSelection().addRange(range);
  figureShortcut(c, 'v');
  assert.equal(c.messages.filter((m) => m.command === 'figureClipboardRead').length, 0);
  c.send({ command: 'figureClipboardWritten', requestId: cut.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
  const paste = c.messages.at(-1);
  assert.equal(paste.command, 'figureClipboardRead');
  c.send({ command: 'figureClipboardRead', requestId: paste.requestId, content: cut.content });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
  const saved = c.save().content;
  assert.equal(saved.split('\\begin{figure}').length - 1, 1);
  assert.ok(saved.indexOf('Opening') < saved.indexOf('\\begin{figure}'));
  assert.ok(saved.indexOf('\\end{figure}') < saved.indexOf('paragraph.'));
});

test('stale clipboard acknowledgements cannot remove a new document figure', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  figureShortcut(c, 'x');
  const old = c.messages.at(-1);
  c.send({ command: 'init', content: source, fileName: 'paper.tex' });
  chooseFigure(c);
  figureShortcut(c, 'x');
  const current = c.messages.at(-1);
  c.send({ command: 'figureClipboardWritten', requestId: old.requestId });
  c.send({ command: 'figureClipboardError', requestId: old.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
  c.send({ command: 'figureClipboardWritten', requestId: current.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 0);
});

test('editing a caption during clipboard write cancels the pending cut visibly', (t) => {
  const c = canvas(t);
  chooseFigure(c);
  figureShortcut(c, 'x');
  const cut = c.messages.at(-1);
  c.paper.querySelector('.float-caption-body').textContent = 'New caption.';
  c.input();
  c.send({ command: 'figureClipboardWritten', requestId: cut.requestId });
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length, 1);
  assert.match(c.document.getElementById('status-text').textContent, /Figure changed/);
  assert.ok(c.save().content.includes('\\caption{New caption.}'));
});

test('unified compile waits for all pending edits', (t) => {
  const c = canvas(t);
  paragraph(c.paper, 'Opening').querySelector('p').textContent = 'Updated master.';
  c.input();
  c.document.getElementById('btn-compile').click();
  const first = c.messages.filter(m => m.command === 'save').at(-1);
  assert.ok(first);
  assert.ok(!c.messages.some(m => m.command === 'compile'));
  paragraph(c.paper, 'Updated').querySelector('p').textContent = 'Latest master.';
  c.input();
  c.ack(first);
  const second = c.messages.filter(m => m.command === 'save').at(-1);
  assert.notEqual(first.saveId, second.saveId);
  c.ack(second);
  assert.equal(c.messages.filter(m => m.command === 'compile').length, 1);
});

test('supplementary boundary survives a LocalLeaf edit and save', (t) => {
  const c = canvas(t);
  const master = source.replace('Final paragraph.', '% localleaf:supplementary\n\\clearpage\n\\section{Supplementary}\n\nFinal paragraph.');
  c.send({ command: 'init', content: master, fileName: 'main.tex' });
  assert.equal(c.save().content, master);
  c.ack(c.messages.filter(m => m.command === 'save').at(-1));
  paragraph(c.paper, 'Opening').querySelector('p').textContent = 'Edited opening.';
  c.input();
  const saved = c.save().content;
  assert.equal(saved.split('% localleaf:supplementary').length, 2);
  assert.ok(saved.indexOf('% localleaf:supplementary') < saved.indexOf('\\section{Supplementary}'));
});

const starter = String.raw`\documentclass{article}
\title{Supplementary Material}
\begin{document}
\maketitle
\renewcommand{\thefigure}{S\arabic{figure}}
\setcounter{figure}{0}
% Paste body here.
\bibliographystyle{plain}
\bibliography{../references/references}
\end{document}`;

function pastePlain(c, text) {
  const event = new c.document.defaultView.Event('paste', {bubbles:true, cancelable:true});
  Object.defineProperty(event, 'clipboardData', {value:{getData:type=>type==='text/plain'?text:''}});
  c.paper.dispatchEvent(event);
  return event;
}
function bodyCaret(c) {
  const p = [...c.paper.querySelectorAll('p')].find(n=>!n.textContent.trim());
  assert.ok(p, 'Empty templates must expose a body insertion point');
  const range=c.document.createRange();range.setStart(p,0);range.collapse(true);
  c.document.defaultView.getSelection().removeAllRanges();c.document.defaultView.getSelection().addRange(range);
}

test('plain figure clipboard from another canvas renders and saves in a blank supplementary template', t => {
  const c=canvas(t);
  c.send({command:'init',content:starter,fileName:'supplementary.tex'});
  assert.equal(c.save().content,starter);
  c.ack(c.messages.at(-1));
  bodyCaret(c);
  const figure=source.match(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/)[0];
  assert.equal(pastePlain(c,figure).defaultPrevented,true);
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length,1);
  assert.equal(c.paper.querySelector('.float-caption-prefix').textContent,'Figure S1.');
  const saved=c.save();
  assert.ok(saved.content.includes(figure),saved.content);
  assert.ok(saved.content.indexOf(figure)<saved.content.indexOf('\\bibliographystyle'));
  c.ack(saved);
  assert.equal(c.save().content,saved.content);
});

test('mixed prose and figure copy preserves partial prose, full caption and labels in either selection direction', t => {
  for (const backwards of [false,true]) {
    const c=canvas(t);c.paper.focus();
    const opening=c.paper.querySelector('p').firstChild;
    const caption=c.paper.querySelector('.float-caption-body').lastChild;
    const selection=c.document.defaultView.getSelection();
    selection.setBaseAndExtent(...(backwards?[caption,caption.length,opening,8]:[opening,8,caption,caption.length]));
    figureShortcut(c,'c');
    const copied=c.messages.filter(m=>m.command==='figureClipboardWrite').at(-1);
    assert.ok(copied.content.startsWith('paragraph.'),copied.content);
    assert.ok(copied.content.includes('\\label{fig:example}'));
    assert.ok(copied.content.includes('\\caption{Original caption.}'));
    const dest=canvas(t);dest.send({command:'init',content:starter,fileName:'supplementary.tex'});
    bodyCaret(dest);pastePlain(dest,copied.content);
    const saved=dest.save().content;
    assert.ok(saved.includes('paragraph.'));
    assert.equal(saved.split('\\begin{figure}').length-1,1);
    assert.ok(saved.includes('\\label{fig:example}'));
    assert.ok(saved.indexOf('paragraph.')<saved.indexOf('\\begin{figure}'));
  }
});

test('body paragraphs appended inside the title wrapper are never omitted by Save', t => {
  const c=canvas(t);c.send({command:'init',content:starter,fileName:'supplementary.tex'});
  const p=c.document.createElement('p');p.textContent='Body pasted after title.';
  c.paper.querySelector('[data-cmd="title"]').after(p);c.input();
  const saved=c.save();
  assert.ok(saved.content.includes('Body pasted after title.'),saved.content);
  assert.ok(saved.content.includes('\\title{Supplementary Material}'));
  c.ack(saved);assert.equal(c.save().content,saved.content);
});

test('plain text that only mentions an incomplete figure macro retains normal paste', t => {
  const c=canvas(t);
  selectText(c,'p');
  assert.equal(pastePlain(c,'An example: \\begin{figure}').defaultPrevented,false);
});

test('mixed cut is confirmed, undoable and does not resurrect deleted prose or figures', t => {
  const c=canvas(t);c.paper.focus();
  const range=c.document.createRange();
  range.setStart(c.paper.querySelector('p').firstChild,0);
  range.setEndAfter(c.paper.querySelector('.latex-float-card').parentElement);
  c.document.defaultView.getSelection().removeAllRanges();c.document.defaultView.getSelection().addRange(range);
  figureShortcut(c,'x');
  const cut=c.messages.filter(m=>m.command==='figureClipboardWrite').at(-1);
  assert.ok(cut.content.includes('Opening paragraph.'));
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length,1);
  c.send({command:'figureClipboardWritten',requestId:cut.requestId});
  assert.equal(c.paper.querySelectorAll('.latex-float-card').length,0);
  const saved=c.save();
  assert.ok(!saved.content.includes('Opening paragraph.'));
  assert.ok(!saved.content.includes('\\begin{figure}'));
  assert.ok(saved.content.includes('Final paragraph.'));
  c.ack(saved);c.document.getElementById('btn-undo').click();
  assert.equal(c.save().content,source);
});

test('pasting multiple figures preserves their complete source and surrounding prose', t => {
  const c=canvas(t);c.send({command:'init',content:starter,fileName:'supplementary.tex'});bodyCaret(c);
  const first=source.match(/\\begin\{figure\}[\s\S]*?\\end\{figure\}/)[0];
  const second=first.replace('fig:example','fig:second').replace('Original caption.','Second caption.');
  pastePlain(c,'Before figures.\n\n'+first+'\n\nBetween figures.\n\n'+second+'\n\nAfter figures.\n');
  const saved=c.save().content;
  assert.ok(saved.includes(first));assert.ok(saved.includes(second));
  assert.ok(saved.indexOf('Before figures.')<saved.indexOf(first));
  assert.ok(saved.indexOf(first)<saved.indexOf('Between figures.'));
  assert.ok(saved.indexOf('Between figures.')<saved.indexOf(second));
  assert.ok(saved.indexOf(second)<saved.indexOf('After figures.'));
  assert.deepEqual([...c.paper.querySelectorAll('.float-caption-prefix')].map(n=>n.textContent),['Figure S1.','Figure S2.']);
});


test('compiled citation numbers and compressed superscript ranges match without source edits', t => {
  const c = canvas(t);
  const raw = String.raw`\documentclass{article}
\usepackage[super,sort&compress]{natbib}
\begin{document}
Citations\cite{c,a,b,d}.\end{document}`;
  c.send({command:'init',content:raw,fileName:'paper.tex',bibContext:{citeNumbers:{a:'7',b:'8',c:'9',d:'12'},isSuperscript:true,sortCitations:true,compressCitations:true}});
  assert.equal(c.paper.querySelector('.latex-cite').textContent,'7–9,12');
  assert.ok(c.paper.querySelector('.cite-super'));
  assert.equal(c.save().content,raw);
});

test('asset refresh preserves unsaved edits and requests current source',t=>{
  const c=canvas(t);
  paragraph(c.paper,'Opening').querySelector('p').textContent='Unsaved asset test.';
  c.input();
  c.send({command:'refreshAssets'});
  const request=c.messages.at(-1);
  assert.equal(request.command,'resolveFigurePreviews');
  assert.match(request.content,/Unsaved asset test/);
  c.send({command:'figurePreviews',revision:request.revision,figureUris:{'assets/example.png':'https://localleaf.test/image.png?v=2'}});
  assert.equal(c.paper.querySelector('.float-image-preview img').getAttribute('src'),'https://localleaf.test/image.png?v=2');
  assert.equal(c.save().content,request.content);
  c.send({command:'figurePreviews',revision:request.revision,figureUris:{}});
  assert.equal(c.paper.querySelector('.float-image-preview img'),null);
  assert.match(c.paper.querySelector('.float-image-preview').textContent,/unavailable/);
  assert.equal(c.save().content,request.content);
});

test('front matter and forward references agree with source and survive save/refresh', t => {
  const c = canvas(t);
  const documentSource = String.raw`\documentclass{article}
\usepackage{authblk}
\title{A paper}
% \author{Not an author}
\newcommand{\example}{\author{Not a declaration}}
\author[1\affilmarksep 2]{First \textbf{Author}}
\author[1,*]{Second Author}
\affil[1]{First Department}
\affil[2]{Second Department}
\date{*Correspondence: author@example.test}
\begin{document}
\maketitle

See Figure~\ref{fig:coverage}A, Table~\ref{tab:summary}, Equation~\eqref{eq:distance}, page~\pageref{fig:coverage}, and \autoref{fig:coverage}. Missing: \ref{fig:missing}.

\begin{figure}
\caption{Coverage.}\label{fig:coverage}
\end{figure}

\begin{table}
\caption{Summary.}\label{tab:summary}
\end{table}

\begin{equation}
d = x\label{eq:distance}
\end{equation}
\end{document}`;
  c.send({command:'init',content:documentSource,fileName:'paper.tex',bibContext:{}});
  const front = c.paper.querySelector('.latex-front-matter');
  assert.ok(front.textContent.includes('First Author1,2, Second Author1,*'));
  assert.equal(front.querySelectorAll('.latex-affiliation').length,2);
  assert.ok(front.textContent.includes('*Correspondence: author@example.test'));
  assert.ok(!front.textContent.includes('Not a'));
  assert.equal(front.getAttribute('contenteditable'),'false');
  const refs = () => [...c.paper.querySelectorAll('.latex-ref')].map(n=>n.textContent);
  assert.deepEqual(refs(),['1','1','(1)','[fig:coverage]','Figure 1','[fig:missing]']);
  assert.equal(c.save().content,documentSource);
  const saved=c.save();c.ack(saved);
  c.send({command:'compileResult',success:true,bibContext:{labelMap:{'fig:coverage':'4','tab:summary':'S2','eq:distance':'7'},labelPages:{'fig:coverage':'9'}}});
  assert.deepEqual(refs(),['4','S2','(7)','9','Figure 4','[fig:missing]']);
  assert.equal(c.save().content,documentSource);
  c.ack(c.save());
  // A real prose edit must retain tokens and all preamble declarations.
  const p=c.paper.querySelector('.latex-paragraph');p.firstChild.textContent='Compare Figure\u00a0';c.input();
  assert.ok(c.save().content.includes(String.raw`Compare Figure~\ref{fig:coverage}A`));
  assert.ok(c.save().content.includes(String.raw`\author[1\affilmarksep 2]{First \textbf{Author}}`));
  c.send({command:'externalUpdate',content:documentSource.replace('First Department','Updated Department')});
  assert.ok(c.paper.querySelector('.latex-front-matter').textContent.includes('Updated Department'));
});

test('author declarations without maketitle are preserved but not displayed', t => {
  const c=canvas(t);
  const source=String.raw`\documentclass{article}\author{Hidden Author}\date{}\begin{document}Body.\end{document}`;
  c.send({command:'init',content:source,fileName:'paper.tex'});
  assert.equal(c.paper.querySelector('.latex-front-matter'),null);
  assert.equal(c.save().content,source);
});

test('reference addition, deletion, and refresh button renumbers citations sequentially', (t) => {
  const c = canvas(t);
  const citeSource = String.raw`\documentclass{article}
\begin{document}
First paragraph with \cite{alpha}.

Second paragraph with \cite{beta}.

Third paragraph with \cite{gamma}.
\end{document}`;
  c.send({ command: 'init', content: citeSource, fileName: 'paper.tex', bibContext: {} });

  const getCiteTexts = () => [...c.paper.querySelectorAll('.latex-cite')].map((n) => n.textContent);
  assert.deepEqual(getCiteTexts(), ['[1]', '[2]', '[3]']);

  // Delete the second citation (beta) from the DOM
  const cites = c.paper.querySelectorAll('.latex-cite');
  cites[1].remove();
  c.input();

  // After deletion and input event, remaining citations must be renumbered sequentially: [1] and [2]
  assert.deepEqual(getCiteTexts(), ['[1]', '[2]']);

  // Refresh button renumbers citations
  const refreshBtn = c.document.getElementById('btn-refresh-citations');
  assert.ok(refreshBtn, 'Refresh citations button must exist');
  refreshBtn.click();
  assert.deepEqual(getCiteTexts(), ['[1]', '[2]']);
});

test('toolbar contains superscript and subscript controls', (t) => {
  const c = canvas(t);
  assert.ok(c.document.getElementById('btn-superscript'), 'Superscript button must exist');
  assert.ok(c.document.getElementById('btn-subscript'), 'Subscript button must exist');
  assert.ok(c.document.querySelector('#block-menu [data-block="p"]'), 'Body text block style must exist');
  assert.ok(c.document.querySelector('#block-menu [data-block="h2"]'), 'Section block style must exist');
});

test('toolbar contains insert figure button and figure modal dialog', (t) => {
  const c = canvas(t);
  const btn = c.document.getElementById('btn-add-figure');
  assert.ok(btn, 'Insert figure button must exist');
  assert.equal(btn.getAttribute('aria-label'), 'Insert figure');
  const modal = c.document.getElementById('figure-modal');
  assert.ok(modal, 'Figure modal must exist');
  assert.equal(modal.style.display, 'none');

  // Open modal via button click
  btn.click();
  assert.equal(modal.style.display, 'flex');

  const pathInput = c.document.getElementById('figure-path-input');
  const captionInput = c.document.getElementById('figure-caption-input');
  const labelInput = c.document.getElementById('figure-label-input');
  const confirmBtn = c.document.getElementById('btn-confirm-figure');

  assert.ok(confirmBtn.disabled, 'Confirm button must be disabled when path is empty');

  // Input path and caption
  pathInput.value = 'assets/figures/test_plot.png';
  pathInput.dispatchEvent(new c.document.defaultView.Event('input'));
  assert.equal(confirmBtn.disabled, false);
  assert.equal(labelInput.value, 'fig:test_plot');

  captionInput.value = 'Test plot caption.';
  confirmBtn.click();

  assert.equal(modal.style.display, 'none');

  // Check saved document contains the inserted figure
  const saved = c.save();
  assert.ok(saved.content.includes(String.raw`\includegraphics[width=\textwidth,keepaspectratio]{assets/figures/test_plot.png}`), 'Saved LaTeX must contain new figure');
  assert.ok(saved.content.includes(String.raw`\caption{Test plot caption.}`), 'Saved LaTeX must contain caption');
  assert.ok(saved.content.includes(String.raw`\label{fig:test_plot}`), 'Saved LaTeX must contain label');
});

test('toolbar contains insert table button and table modal dialog', (t) => {
  const c = canvas(t);
  const btn = c.document.getElementById('btn-add-table');
  assert.ok(btn, 'Insert table button must exist');
  assert.equal(btn.getAttribute('aria-label'), 'Insert table');
  const modal = c.document.getElementById('table-modal');
  assert.ok(modal, 'Table modal must exist');
  assert.equal(modal.style.display, 'none');

  // Open modal via button click
  btn.click();
  assert.equal(modal.style.display, 'flex');

  const rowsInput = c.document.getElementById('table-rows-input');
  const colsInput = c.document.getElementById('table-cols-input');
  const captionInput = c.document.getElementById('table-caption-input');
  const labelInput = c.document.getElementById('table-label-input');
  const booktabsCheckbox = c.document.getElementById('table-booktabs-checkbox');
  const confirmBtn = c.document.getElementById('btn-confirm-table');

  assert.ok(rowsInput, 'Rows input must exist');
  assert.ok(colsInput, 'Cols input must exist');
  assert.ok(captionInput, 'Caption input must exist');
  assert.ok(labelInput, 'Label input must exist');
  assert.ok(booktabsCheckbox, 'Booktabs checkbox must exist');
  assert.ok(confirmBtn, 'Confirm button must exist');

  // Fill in inputs
  rowsInput.value = '2';
  colsInput.value = '2';
  captionInput.value = 'Screening summary.';
  captionInput.dispatchEvent(new c.document.defaultView.Event('input'));
  assert.equal(labelInput.value, 'tab:screening_summary');

  confirmBtn.click();
  assert.equal(modal.style.display, 'none');

  // Check saved document contains the inserted table with booktabs
  const saved = c.save();
  assert.ok(saved.content.includes(String.raw`\begin{table}[htbp]`), 'Saved LaTeX must contain table environment');
  assert.ok(saved.content.includes(String.raw`\caption{Screening summary.}`), 'Saved LaTeX must contain caption');
  assert.ok(saved.content.includes(String.raw`\label{tab:screening_summary}`), 'Saved LaTeX must contain label');
  assert.ok(saved.content.includes(String.raw`\begin{tabular}{ll}`), 'Saved LaTeX must contain tabular with 2 cols');
  assert.ok(saved.content.includes(String.raw`\toprule`), 'Saved LaTeX must contain toprule');
  assert.ok(saved.content.includes(String.raw`\midrule`), 'Saved LaTeX must contain midrule');
  assert.ok(saved.content.includes(String.raw`\bottomrule`), 'Saved LaTeX must contain bottomrule');
});

test('toolbar contains vertical dividers between logical categories matching Overleaf layout', (t) => {
  const c = canvas(t);
  const dividers = c.document.querySelectorAll('.toolbar .toolbar-divider');
  assert.ok(dividers.length >= 4, `Expected at least 4 category dividers, got ${dividers.length}`);
});


test('highlight control refuses unsupported preambles without altering source', (t) => {
  const c = canvas(t);
  const node = paragraph(c.paper, 'Opening paragraph').firstChild;
  const range = c.document.createRange();
  range.selectNodeContents(node);
  const selection = c.document.defaultView.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  const button = c.document.getElementById('btn-highlight-menu');
  button.dispatchEvent(new c.document.defaultView.MouseEvent('mousedown', {bubbles:true}));
  button.click(); c.document.querySelector('[data-highlight="yellow"]').click();
  assert.equal(c.paper.querySelector('mark'), null);
  assert.match(c.document.getElementById('status-text').textContent, /usepackage\{soul\}/);
  assert.equal(c.save().content, source);
});


test('partial math highlighting leaves scientific source unchanged', (t) => {
  const c = canvas(t);
  const prepared = source.replace(String.raw`\begin{document}`, String.raw`\usepackage{soul}` + '\n' + String.raw`\begin{document}`);
  c.send({command:'init', content:prepared, fileName:'paper.tex'});
  const math = c.paper.querySelector('.latex-math');
  const range = c.document.createRange();
  range.selectNodeContents(math);
  const selection = c.document.defaultView.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  const button = c.document.getElementById('btn-highlight-menu');
  button.dispatchEvent(new c.document.defaultView.MouseEvent('mousedown', {bubbles:true}));
  button.click(); c.document.querySelector('[data-highlight="yellow"]').click();
  assert.equal(c.paper.querySelector('mark'), null);
  assert.match(c.document.getElementById('status-text').textContent, /whole math token/);
  assert.equal(c.save().content, prepared);
});

test('new citation uses cite despite a legacy revref declaration', t => {
  const c = canvas(t);
  const tex = String.raw`\documentclass{article}
\newcommand{\revref}[1]{\cite{#1}}
\begin{document}
Existing \revref{old}.

Insert here.
\end{document}`;
  c.send({ command: 'init', content: tex, fileName: 'paper.tex', bibContext: {
    metaMap: { added: { key: 'added', title: 'New reference', author: 'Author', year: '2026' } },
  } });
  c.document.getElementById('btn-add-citation').click();
  c.document.querySelector('#citation-results-list').firstElementChild.click();
  c.document.getElementById('btn-confirm-cite').click();
  const saved = c.save().content;
  assert.ok(saved.includes('\\cite{added}'));
  assert.ok(saved.includes('\\revref{old}'));
  assert.ok(!saved.includes('\\revref{added}'));
});
