import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';

const chrome = '/usr/bin/google-chrome';
test('native browser figure cut/paste, undo, and empty subsection Backspace', { skip: !fs.existsSync(chrome), timeout: 30000 }, async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localleaf-browser-'));
  const proc = spawn(chrome, ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(async () => {
    proc.kill();
    await new Promise((resolve) => proc.once('exit', resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    proc.stderr.on('data', (data) => {
      output += data;
      const match = output.match(/DevTools listening on ws:\/\/127.0.0.1:(\d+)/);
      if (match) resolve(match[1]);
    });
    proc.once('error', reject);
    proc.once('exit', (code) => reject(new Error(`Chrome exited: ${code}`)));
  });
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  t.after(() => ws.close());
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (response.id) {
      const { resolve, reject } = pending.get(response.id);
      pending.delete(response.id);
      if (response.error) reject(new Error(JSON.stringify(response.error)));
      else resolve(response.result);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const html = fs.readFileSync('src/webview/index.html', 'utf8').replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '');
  const bundle = buildSync({ entryPoints: ['src/webview/editor.js'], bundle: true, write: false, format: 'iife' }).outputFiles[0].text;
  await evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); window.messages = []; window.acquireVsCodeApi = () => ({ postMessage(m) { messages.push(m); if(m.command==='figureClipboardWrite'){window.hostClipboard=m.content;setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{command:'figureClipboardWritten',requestId:m.requestId}})),0);} if(m.command==='figureClipboardRead'){setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{command:'figureClipboardRead',requestId:m.requestId,content:window.hostClipboard}})),0);} if (m.command === 'save') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {command:'saveSuccess', saveId:m.saveId} })), 0); }, setState() {} });`);
  await evaluate(`const style=document.createElement('style'); style.textContent=${JSON.stringify(fs.readFileSync('src/webview/styles.css','utf8'))}; document.head.appendChild(style);`);
  await evaluate(bundle);
  // Figure widths follow the authoring column at wide and narrow pane sizes.
  // A tall image must retain its aspect ratio instead of being letterboxed by
  // a viewport-height cap. Authored fractional widths affect exports only.
  const responsiveSource = String.raw`\documentclass{article}
\begin{document}
A body paragraph that wraps naturally as the authoring pane narrows. Its edges define the available text column for the figures below. Additional ordinary words make the responsive line wrapping observable at each viewport width.

\begin{figure}
\includegraphics[width=\textwidth]{assets/tall.svg}
\caption{Full-width figure.}\label{fig:full}
\end{figure}

\begin{figure}
\includegraphics[width=0.6\textwidth]{assets/tall.svg}
\caption{Fractional-width figure.}\label{fig:fraction}
\end{figure}
\end{document}`;
  const tallImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1600"><rect width="400" height="1600" fill="steelblue"/></svg>');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(responsiveSource)},fileName:'paper.tex',figureUris:{'assets/tall.svg':${JSON.stringify(tallImage)}}}}))`);
  const decoded = await command('Runtime.evaluate', { expression: `Promise.all([...document.querySelectorAll('.float-image')].map(image=>image.decode()))`, awaitPromise: true });
  assert.ok(!decoded.exceptionDetails, 'Synthetic tall figure must load');
  const columnWidths = [];
  for (const width of [1280, 800, 500]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 500, deviceScaleFactor: 1, mobile: false });
    const layout = await evaluate(`(()=>{
      const column=document.querySelector('.latex-paragraph').getBoundingClientRect();
      const images=[...document.querySelectorAll('.float-image')].map(image=>{
        const rect=image.getBoundingClientRect();
        return {left:rect.left,right:rect.right,width:rect.width,height:rect.height,ratio:image.naturalHeight/image.naturalWidth};
      });
      return {left:column.left,right:column.right,width:column.width,images};
    })()`);
    columnWidths.push(layout.width);
    const [full, fraction] = layout.images;
    assert.ok(Math.abs(full.left-layout.left)<1 && Math.abs(full.right-layout.right)<1, 'Full figure aligns with body text');
    assert.ok(Math.abs(fraction.left-layout.left)<1 && Math.abs(fraction.right-layout.right)<1, 'Fractional-width source also previews across the text column');
    for (const image of layout.images) assert.ok(Math.abs(image.height-image.width*image.ratio)<1, 'Tall figure keeps its aspect ratio at full column width');
  }
  assert.ok(columnWidths[0]>columnWidths[1] && columnWidths[1]>columnWidths[2], 'Figures adapt when the pane narrows');
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`), responsiveSource);
  await evaluate(`document.querySelectorAll('.float-caption-body')[1].lastChild.textContent='Edited fractional caption.'; document.getElementById('paper-canvas').dispatchEvent(new Event('input',{bubbles:true})); document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`), responsiveSource.replace('Fractional-width figure.', 'Edited fractional caption.'));
  await command('Emulation.clearDeviceMetricsOverride');
  const citationSource = String.raw`\documentclass{article}
\usepackage[numbers,sort&compress]{natbib}
\begin{document}
Evidence\cite{alpha,beta,gamma} remains readable.
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(citationSource)},fileName:'paper.tex',bibContext:{isSuperscript:false,sortCitations:true,compressCitations:true,metaMap:{alpha:{title:'Alpha study',year:'2026'}}}}}))`);
  const initialTheme = await evaluate(`document.body.className`);
  for (const theme of ['vscode-light', 'vscode-dark']) {
    assert.deepEqual(await evaluate(`(()=>{document.body.className=${JSON.stringify(theme)};const n=document.querySelector('.cite-bracket'),c=getComputedStyle(n),p=getComputedStyle(n.parentElement);return [c.display,c.borderTopWidth,c.backgroundColor,c.paddingLeft,c.marginLeft,c.fontSize===p.fontSize,c.fontFamily===p.fontFamily,c.color!==p.color,n.title.includes('Alpha study')];})()`), ['inline','0px','rgba(0, 0, 0, 0)','0px','0px',true,true,true,true]);
  }
  await evaluate(`document.body.className=${JSON.stringify(initialTheme)}`);
  await evaluate(`document.querySelector('.cite-bracket').click()`);
  assert.equal(await evaluate(`document.getElementById('cite-modal').style.display`), 'flex');
  await evaluate(`document.getElementById('btn-cancel-modal').click();document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`), citationSource);
  const typographySource = String.raw`\documentclass{article}
\begin{document}
Distance $>15\text{~\AA}$ and variable $d_{\text{min}}$.

\begin{equation}
x = y
\end{equation}
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(typographySource)},fileName:'paper.tex'}}))`);
  assert.deepEqual(await evaluate(`(()=>{const m=getComputedStyle(document.querySelector('.math-measurement'));const e=getComputedStyle(document.querySelector('.latex-equation-block'));return [m.fontStyle,e.borderTopWidth,e.backgroundColor,!!document.getElementById('btn-recovery')];})()`), ['normal','0px','rgba(0, 0, 0, 0)',false]);
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`),typographySource);
  const greekSource = String.raw`\documentclass{article}
\usepackage{upgreek}
\begin{document}
Label \(\upalpha\)C and variable \(\chi_1\); uppercase \(\Theta\).
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(greekSource)},fileName:'paper.tex'}}))`);
  assert.deepEqual(await evaluate(`(()=>{const m=document.querySelectorAll('.latex-math');return [getComputedStyle(m[0].querySelector('.math-upright')).fontStyle,getComputedStyle(m[1]).fontStyle,getComputedStyle(m[2].querySelector('.math-upright')).fontStyle];})()`), ['normal','italic','normal']);
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`),greekSource);
  await evaluate(`(()=>{const p=document.querySelector('.latex-paragraph');const range=document.createRange();range.selectNodeContents(p);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);const button=document.getElementById('btn-symbol-menu');button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));button.click();document.querySelector('#symbol-menu [data-symbol="α"]').click();document.getElementById('btn-save').click();})()`);
  const greekSaved = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(greekSaved.includes(String.raw`$\upalpha$`));
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(greekSaved)},fileName:'paper.tex'}}))`);
  assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('.latex-math')].at(-1).querySelector('.math-upright')).fontStyle`),'normal');
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(greekSource.replace('\\usepackage{upgreek}\n',''))},fileName:'paper.tex'}}))`);
  await evaluate(`(()=>{const button=document.getElementById('btn-symbol-menu');button.click();document.querySelector('#symbol-menu [data-symbol="α"]').click();})()`);
  assert.ok(await evaluate(`document.body.textContent.includes('Upright Greek labels require')`));
  const formattingSource = String.raw`\documentclass{article}
\usepackage{soul}
\begin{document}
Before \textbf{selected words} after. Mixed \(x\ge0.15\) and \(−3.6\).
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(formattingSource)},fileName:'paper.tex'}}))`);
  assert.deepEqual(await evaluate(`(()=>{const p=document.querySelector('.latex-paragraph');const math=p.querySelector('.latex-math');const number=math.querySelector('.math-literal');return [getComputedStyle(math).fontStyle,getComputedStyle(number).fontStyle,getComputedStyle(p.querySelector('.math-measurement')).fontStyle];})()`), ['italic','normal','normal']);
  await evaluate(`window.selectWords = text => {const w=document.createTreeWalker(document.getElementById('paper-canvas'),NodeFilter.SHOW_TEXT);let node;while(node=w.nextNode()){const i=node.textContent.indexOf(text);if(i>=0){const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+text.length);getSelection().removeAllRanges();getSelection().addRange(range);return;}}throw new Error('Text not found: '+text);}; window.highlightAction = action => {const button=document.getElementById('btn-highlight-menu');button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));button.click();document.querySelector('[data-highlight="'+action+'"]').click();}; selectWords('selected words');highlightAction('yellow');`);
  assert.deepEqual(await evaluate(`(()=>{const m=document.querySelector('mark');return [m.textContent,m.closest('strong').textContent,getComputedStyle(m).backgroundColor,getSelection().toString()];})()`), ['selected words','selected words','rgb(255, 235, 59)','selected words']);
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.ok((await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`)).includes(String.raw`\textbf{\hl{selected words}}`));
  await evaluate(`selectWords('words');highlightAction('remove');`);
  assert.equal(await evaluate(`document.querySelector('mark').textContent`), 'selected ');
  assert.equal(await evaluate(`getSelection().toString()`), 'words');
  await evaluate(`document.getElementById('btn-undo').click()`);
  assert.equal(await evaluate(`document.querySelector('mark').textContent`), 'selected words');
  await evaluate(`document.getElementById('btn-redo').click()`);
  assert.equal(await evaluate(`document.querySelector('mark').textContent`), 'selected ');
  await evaluate(`selectWords('words'); const button=document.getElementById('btn-color-menu');button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));button.click();document.querySelector('[data-color="red"]').click();`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-color="D32F2F"].latex-color')).color`), 'rgb(211, 47, 47)');
  await evaluate(`document.getElementById('btn-save').click()`);
  const savedFormatting = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(savedFormatting.includes(String.raw`\textcolor[HTML]{D32F2F}`));
  assert.ok(savedFormatting.includes(String.raw`\(x\ge0.15\)`));
  assert.ok(savedFormatting.includes(String.raw`\(−3.6\)`));
  const frontSource = String.raw`\documentclass[12pt]{article}
\title{Author and reference rendering}
\author[1\affilmarksep 2]{First Author}
\author[1,*]{Second Author}
\affil[1]{Department One}
\affil[2]{Department Two}
\date{*Correspondence: author@example.test}
\begin{document}
\maketitle

As shown in Figure~\ref{fig:coverage}A.

\begin{figure}
\caption{Coverage.}\label{fig:coverage}
\end{figure}
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(frontSource)},fileName:'paper.tex',bibContext:{}}}))`);
  assert.deepEqual(await evaluate(`(()=>{const ref=document.querySelector('.latex-ref');const style=getComputedStyle(ref);return [document.querySelector('.latex-authors').textContent,document.querySelectorAll('.latex-affiliation').length,ref.parentElement.textContent,style.marginLeft,style.borderTopWidth,getComputedStyle(document.querySelector('.latex-authors')).fontStyle];})()`), ['First Author1,2, Second Author1,*',2,'As shown in Figure\u00a01A.','0px','0px','normal']);
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`),frontSource);
  const source = String.raw`\begin{document}
Opening paragraph.

\begin{figure}[htbp]
\includegraphics{assets/example.png}
\caption{Original caption.}
\label{fig:example}
\end{figure}

\subsection{Remove me}

Final paragraph.
\end{document}`;
  await evaluate(`window.dispatchEvent(new MessageEvent('message', {data:{command:'init',content:${JSON.stringify(source)},fileName:'paper.tex'}})); window.paper=document.getElementById('paper-canvas'); window.clip=new DataTransfer();`);
  assert.equal(await evaluate(`document.querySelector('.float-image-preview').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); getSelection().toString().includes('Original caption.')`), true);
  await evaluate(`paper.dispatchEvent(new ClipboardEvent('cut',{clipboardData:clip,bubbles:true,cancelable:true}));`);
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`), 0);
  assert.ok(await evaluate(`clip.getData('application/x-aspyrus-figure').includes('\\label{fig:example}')`));
  assert.ok(await evaluate(`clip.getData('application/x-localleaf-figure').includes('\\label{fig:example}')`));
  // Native undo must restore the entire figure, then redo must remove it again.
  assert.equal(await evaluate(`document.getElementById('btn-undo').click(); paper.querySelectorAll('.latex-float-card').length`), 1);
  assert.equal(await evaluate(`document.getElementById('btn-redo').click(); paper.querySelectorAll('.latex-float-card').length`), 0);
  // Paste at the start of the final paragraph, as an author would place it.
  await evaluate(`const p=[...paper.querySelectorAll('p')].find(p=>p.textContent==='Final paragraph.'); const r=document.createRange(); r.setStart(p,0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); paper.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));`);
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`), 1);
  await evaluate(`document.getElementById('btn-save').click()`);
  const saved = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(saved.indexOf('\\subsection') < saved.indexOf('\\begin{figure}'), saved);
  assert.equal(saved.split('\\begin{figure}').length - 1, 1);
  assert.ok(saved.includes('\\caption{Original caption.}'), saved + '\nDOM: ' + await evaluate('paper.innerHTML'));
  assert.ok(saved.includes('Final paragraph.'));
  assert.equal(await evaluate(`document.getElementById('btn-undo').click(); paper.querySelectorAll('.latex-float-card').length`), 0);
  assert.equal(await evaluate(`document.getElementById('btn-redo').click(); paper.querySelectorAll('.latex-float-card').length`), 1);
  assert.equal(await evaluate(`paper.querySelector('.float-caption-body').contentEditable`), 'true');
  await evaluate(`document.getElementById('btn-save').click()`);
  assert.equal(await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`), saved);
  // Test the exact reported boundary: heading immediately below a figure.
  await evaluate(`window.dispatchEvent(new MessageEvent('message', {data:{command:'init',content:${JSON.stringify(source)},fileName:'paper.tex'}}));`);
  // Delete heading text with the native editor, then press Backspace once more.
  await evaluate(`const h=paper.querySelector('h3'); const r2=document.createRange(); r2.selectNodeContents(h); getSelection().removeAllRanges(); getSelection().addRange(r2); document.execCommand('delete');`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  assert.equal(await evaluate(`paper.querySelectorAll('h3').length`), 0);
  await evaluate(`document.execCommand('insertText',false,'Ordinary text below figure.');`);
  await evaluate(`document.getElementById('btn-save').click()`);
  const final = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(!final.includes('\\subsection'), final);
  assert.ok(final.includes('\\begin{figure}'));
  assert.ok(final.includes('Ordinary text below figure.'));
  assert.ok(!final.includes('\\subsection{}'));
  // Reproduce the video: drag upwards from caption into the image, then use
  // the real system clipboard and paste between paragraphs split with Enter.
  const splitSource = source.replace('Opening paragraph.', 'First half. Second half.');
  await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false });
  await evaluate(`window.dispatchEvent(new MessageEvent('message', {data:{command:'init',content:${JSON.stringify(splitSource)},fileName:'paper.tex'}}));
    paper.focus();
    const first=paper.querySelector('p'); const split=document.createRange(); split.setStart(first.firstChild,12); split.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(split); document.execCommand('insertParagraph');
    paper.querySelector('.float-image-preview').style.height='120px';`);
  const points = await evaluate(`(() => {const card=paper.querySelector('.latex-float-card'); card.scrollIntoView(); const a=card.querySelector('.float-caption-body').getBoundingClientRect(); const b=card.querySelector('.float-image-preview').getBoundingClientRect(); return {x:a.left+85, y:a.bottom-3, endX:b.left+5, endY:b.top+5};})()`);
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: points.x, y: points.y, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.endX, y: points.endY, button: 'left', buttons: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: points.endX, y: points.endY, button: 'left', clickCount: 1 });
  assert.equal(await evaluate(`paper.querySelectorAll('.figure-selected').length`), 1);
  async function controlKey(key) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: 'Key'+key.toUpperCase(), modifiers: 2, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: 'Key'+key.toUpperCase(), modifiers: 2, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  }
  await evaluate(`window.nativeCutCount=0; paper.addEventListener('cut',()=>window.nativeCutCount++,{once:true});`);
  await controlKey('x');
  assert.equal(await evaluate('window.nativeCutCount'),0, 'Figure shortcut must bypass native clipboard events');
  await command('Runtime.evaluate', {expression: 'new Promise(resolve => setTimeout(resolve, 0))', awaitPromise: true});
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`), 0);
  await evaluate(`const second=[...paper.querySelectorAll('p')].find(p=>p.textContent.includes('Second half.')); const dest=document.createRange(); dest.setStart(second,0); dest.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(dest);`);
  await controlKey('v');
  // Native paste is asynchronous; wait for a DOM observation, not a fixed delay.
  await command('Runtime.evaluate', { expression: `new Promise(resolve=>{if(paper.querySelector('.latex-float-card')) return resolve(); const observer=new MutationObserver(()=>{if(paper.querySelector('.latex-float-card')){observer.disconnect();resolve();}}); observer.observe(paper,{childList:true,subtree:true}); setTimeout(()=>{observer.disconnect();resolve();},2000);})`, awaitPromise: true });
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`), 1);
  await evaluate(`document.getElementById('btn-save').click()`);
  const splitSaved = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(splitSaved.indexOf('First half.') < splitSaved.indexOf('\\begin{figure}'), splitSaved);
  assert.ok(splitSaved.indexOf('\\end{figure}') < splitSaved.indexOf('Second half.'), splitSaved);
  assert.equal(splitSaved.split('\\begin{figure}').length - 1, 1);
  assert.ok(splitSaved.includes('\\caption{Original caption.}'), splitSaved);
  assert.ok(splitSaved.includes('\\label{fig:example}'), splitSaved);

  // Clipboard bridges may drop custom MIME types. HTML must still carry the
  // figure, and a caret within text must split at that exact position.
  await evaluate(`window.dispatchEvent(new MessageEvent('message', {data:{command:'init',content:${JSON.stringify(splitSource)},fileName:'paper.tex'}}));
    paper.querySelector('.float-image-preview').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));`);
  await controlKey('x');
  await command('Runtime.evaluate', {expression: 'new Promise(resolve => setTimeout(resolve, 0))', awaitPromise: true});
  await evaluate(`const paragraph=paper.querySelector('p'); const middle=document.createRange(); middle.setStart(paragraph.firstChild,12); middle.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(middle); const htmlOnly=new DataTransfer(); htmlOnly.setData('text/html',clip.getData('text/html')); paper.dispatchEvent(new ClipboardEvent('paste',{clipboardData:htmlOnly,bubbles:true,cancelable:true})); document.getElementById('btn-save').click();`);
  const middleSaved = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.ok(middleSaved.indexOf('First half.') < middleSaved.indexOf('\\begin{figure}'), middleSaved);
  assert.ok(middleSaved.indexOf('\\end{figure}') < middleSaved.indexOf('Second half.'), middleSaved);
  assert.equal(middleSaved.split('\\begin{figure}').length - 1, 1);

  // A figure far below the opening must remain at the same scroll position
  // when focus comes from another control, matching a split editor/webview.
  const longSource = source.replace('Opening paragraph.', Array.from({length:80}, (_,i)=>`Paragraph ${i}: manuscript text for scroll coverage.`).join('\n\n'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1100, height: 600, deviceScaleFactor: 1, mobile: false });
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(longSource)},fileName:'paper.tex'}})); paper.querySelector('.float-image-preview').style.height='120px'; paper.querySelector('.latex-float-card').scrollIntoView({block:'center'}); document.getElementById('btn-save').focus({preventScroll:true});`);
  const scrollBefore = await evaluate(`document.querySelector('.editor-viewport').scrollTop`);
  assert.ok(scrollBefore > 1000, 'Exercise a deeply scrolled document');
  const clickPoint = await evaluate(`(() => {const r=paper.querySelector('.float-image-preview').getBoundingClientRect(); return {x:r.left+20,y:r.top+20};})()`);
  await command('Input.dispatchMouseEvent', {type:'mousePressed', ...clickPoint, button:'left', clickCount:1});
  await command('Input.dispatchMouseEvent', {type:'mouseReleased', ...clickPoint, button:'left', clickCount:1});
  assert.equal(await evaluate(`document.querySelector('.editor-viewport').scrollTop`), scrollBefore);
  assert.equal(await evaluate(`paper.querySelectorAll('.figure-selected').length`), 1);
  await controlKey('x');
  await command('Runtime.evaluate', {expression: 'new Promise(resolve => setTimeout(resolve, 0))', awaitPromise: true});
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`), 0);
  assert.ok(await evaluate(`document.querySelector('.editor-viewport').scrollTop`) > 1000);

  // Exercise the exact right-click path shown in the latest screencast.
  await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(source)},fileName:'paper.tex'}})); paper.querySelector('.float-image-preview').style.height='100px'; paper.querySelector('.latex-float-card').scrollIntoView({block:'center'});`);
  async function rightClick(selector) {
    const point = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+3,y:r.top+8};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'right',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'right',clickCount:1});
  }
  async function clickMenu(label) {
    const point = await evaluate(`(() => {const b=[...document.querySelectorAll('.figure-context-menu button')].find(b=>b.textContent===${JSON.stringify(label)});const r=b.getBoundingClientRect();return {x:r.left+10,y:r.top+10};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
    await command('Runtime.evaluate',{expression:'new Promise(resolve=>setTimeout(resolve,0))',awaitPromise:true});
  }
  await rightClick('.float-image-preview');
  assert.equal(await evaluate(`document.querySelector('.figure-context-menu').hidden`),false);
  await clickMenu('Cut figure');
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`),0);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('status-text')).display`),'block');
  await evaluate(`const destination=[...paper.querySelectorAll('p')].find(p=>p.textContent==='Final paragraph.');destination.id='paste-destination'; destination.scrollIntoView({block:'center'});`);
  await rightClick('#paste-destination');
  await clickMenu('Paste figure');
  assert.equal(await evaluate(`paper.querySelectorAll('.latex-float-card').length`),1);
  await evaluate(`document.getElementById('btn-save').click()`);
  const menuSaved = await evaluate(`messages.filter(m=>m.command==='save').at(-1).content`);
  assert.equal(menuSaved.split('\\begin{figure}').length-1,1);
  assert.ok(menuSaved.indexOf('\\subsection') < menuSaved.indexOf('\\begin{figure}'), menuSaved);
  assert.ok(menuSaved.indexOf('\\end{figure}') < menuSaved.indexOf('Final paragraph.'), menuSaved);
  assert.ok(menuSaved.includes('\\caption{Original caption.}'));
  assert.ok(menuSaved.includes('\\label{fig:example}'));

  assert.equal(await evaluate(`document.getElementById('btn-build-menu')`), null);

  // A remembered figure clipboard must not replace the native text menu or
  // steal Ctrl+C, in either prose or an editable caption.
  await evaluate(`[...paper.querySelectorAll('p')].find(p=>p.textContent==='Final paragraph.').id='text-copy-target'`);
  for (const selector of ['#text-copy-target', '.float-caption-body']) {
    const selected = await evaluate(`(() => {const node=paper.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});node.focus();const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);return getSelection().toString();})()`);
    await rightClick(selector);
    assert.equal(await evaluate(`document.querySelector('.figure-context-menu').hidden`), true);
    assert.equal(await evaluate(`getSelection().toString()`), selected);
    const writes = await evaluate(`messages.filter(m=>m.command==='figureClipboardWrite').length`);
    await evaluate(`window.copiedSelection=null;paper.addEventListener('copy',()=>window.copiedSelection=getSelection().toString(),{once:true});`);
    await controlKey('c');
    assert.equal(await evaluate('window.copiedSelection'), selected);
    assert.equal(await evaluate(`messages.filter(m=>m.command==='figureClipboardWrite').length`), writes);
  }

  // Real pointer selections must cross prose, the image and caption in either
  // direction. The receiver is a separate webview with no figure clipboard cache.
  const supplementaryTemplate = String.raw`\documentclass{article}
\usepackage{graphicx}
\title{Supplementary Material}
\begin{document}
\maketitle
\renewcommand{\thefigure}{S\arabic{figure}}
\setcounter{figure}{0}
% Editable body belongs before the bibliography.
\bibliographystyle{plain}
\bibliography{references}
\end{document}`;
  await command('Emulation.setDeviceMetricsOverride', {width:1200,height:1200,deviceScaleFactor:1,mobile:false});
  for (const backwards of [false,true]) {
    await evaluate(`window.dispatchEvent(new MessageEvent('message',{data:{command:'init',content:${JSON.stringify(source)},fileName:'main.tex'}}));
      paper.querySelector('.float-image-preview').style.height='100px';paper.querySelector('p').scrollIntoView({block:'center'});`);
    const drag = await evaluate(`(() => {const a=paper.querySelector('p').getBoundingClientRect();const b=paper.querySelector('.float-caption-body').getBoundingClientRect();return {start:{x:a.left+1,y:a.top+10},end:{x:b.right-2,y:b.bottom-4}};})()`);
    const from=backwards?drag.end:drag.start, to=backwards?drag.start:drag.end;
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...from,button:'left',clickCount:1});
    for(let step=1;step<=8;step++) await command('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*step/8,y:from.y+(to.y-from.y)*step/8,buttons:1,button:'left'});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...to,button:'left',clickCount:1});
    const selected = await evaluate('getSelection().toString()');
    assert.ok(selected.includes('Opening paragraph.'),selected);
    assert.ok(selected.includes('Original caption.'),selected);
    await controlKey('c');
    await command('Runtime.evaluate',{expression:'new Promise(resolve=>setTimeout(resolve,0))',awaitPromise:true});
    const clipboard = await evaluate('window.hostClipboard');
    assert.ok(clipboard.includes('Opening paragraph.'),clipboard);
    assert.ok(clipboard.includes('\\caption{Original caption.}'),clipboard);
    assert.ok(clipboard.includes('\\label{fig:example}'),clipboard);
    await evaluate(`(() => {document.getElementById('receiver')?.remove();window.receiver=document.createElement('iframe');receiver.id='receiver';document.body.appendChild(receiver);
      const w=receiver.contentWindow;w.document.open();w.document.write(${JSON.stringify(html)});w.document.close();w.messages=[];
      w.acquireVsCodeApi=()=>({setState(){},postMessage(m){w.messages.push(m);if(m.command==='save')setTimeout(()=>w.dispatchEvent(new w.MessageEvent('message',{data:{command:'saveSuccess',saveId:m.saveId}})),0);
        if(m.command==='resolveFigurePreviews')setTimeout(()=>w.dispatchEvent(new w.MessageEvent('message',{data:{command:'figurePreviews',revision:m.revision,figureUris:{'assets/example.png':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S0AAAAASUVORK5CYII='}}})),0);}});
      w.eval(${JSON.stringify(bundle)});w.dispatchEvent(new w.MessageEvent('message',{data:{command:'init',content:${JSON.stringify(supplementaryTemplate)},fileName:'supplementary.tex'}}));
      const p=w.document.querySelector('#paper-canvas > p');p.focus();const range=w.document.createRange();range.setStart(p,0);range.collapse(true);w.getSelection().removeAllRanges();w.getSelection().addRange(range);
      const clipboard=new DataTransfer();clipboard.setData('text/plain',${JSON.stringify(clipboard)});p.dispatchEvent(new w.ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));})()`);
    await command('Runtime.evaluate',{expression:'new Promise(resolve=>setTimeout(resolve,0))',awaitPromise:true});
    assert.equal(await evaluate(`receiver.contentDocument.querySelectorAll('.latex-float-card').length`),1);
    assert.equal(await evaluate(`receiver.contentDocument.querySelector('.float-caption-prefix').textContent`),'Figure S1.');
    assert.ok(await evaluate(`receiver.contentDocument.querySelector('.float-image-preview img')?.getAttribute('src').startsWith('data:image/png')`));
    await evaluate(`receiver.contentDocument.getElementById('btn-compile').click()`);
    await command('Runtime.evaluate',{expression:'new Promise(resolve=>setTimeout(resolve,0))',awaitPromise:true});
    const messages = await evaluate('receiver.contentWindow.messages');
    const saved=messages.findLast(m=>m.command==='save').content;
    assert.ok(saved.includes('Opening paragraph.'),saved);
    assert.ok(saved.includes('\\caption{Original caption.}'),saved);
    assert.ok(saved.indexOf('\\end{figure}')<saved.indexOf('\\bibliographystyle'),saved);
    assert.equal(messages.filter(m=>m.command==='compile').length,1);
    await evaluate(`receiver.contentDocument.getElementById('btn-save').click()`);
    assert.equal(await evaluate(`receiver.contentWindow.messages.filter(m=>m.command==='save').at(-1).content`),saved);
    if (!backwards) {
      const fixture=path.join(profile,'saved-supplementary');fs.mkdirSync(path.join(fixture,'assets'),{recursive:true});
      fs.writeFileSync(path.join(fixture,'supplementary.tex'),saved);
      fs.writeFileSync(path.join(fixture,'references.bib'),'@article{test, title={Test}, author={Author}, year={2020}, journal={Journal}}');
      // Use a known-valid PNG produced by the Python integration fixture.
      execFileSync('python3',['-c',"import sys; from pathlib import Path; sys.path.insert(0,'test'); from export_test import png; Path(sys.argv[1]).write_bytes(png())",path.join(fixture,'assets/example.png')]);
      execFileSync('python3',['src/tools/export.py','build',path.join(fixture,'supplementary.tex')]);
      execFileSync('python3',['src/tools/export.py','figures',path.join(fixture,'supplementary.tex')]);
      const text=execFileSync('pdftotext',[path.join(fixture,'supplementary.pdf'),'-'],{encoding:'utf8'});
      assert.match(text,/Opening paragraph/);assert.match(text,/Original caption/);
      const report=JSON.parse(fs.readFileSync(path.join(fixture,'.supplementary-export.json'),'utf8'));
      assert.equal(report.checks.docx_images,1);
    }
    await evaluate(`receiver.remove();paper.focus()`);
  }

});
