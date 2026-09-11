import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import { parseSource, applyEdits, serializeInline } from './latex.js';
import * as pdfjs from '/vendor/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
const $ = (id) => document.getElementById(id);
let editor,
  documentInfo,
  saved = '',
  visualSource = '',
  blocks = [],
  mode = 'visual',
  busy = false;
let pdf = null,
  pdfZoom = 1,
  visualZoom = 1,
  renderId = 0;
const status = (text) => {
  $('status').textContent = text;
};
const fileFromUrl = new URL(location.href).searchParams.get('file');

async function api(path, data) {
  const response = await fetch(
    path,
    data
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-LocalLeaf': '1' },
          body: JSON.stringify(data),
        }
      : {},
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function currentContent() {
  if (mode === 'code') return editor.getValue();
  const edits = blocks
    .filter((b) => b.changed)
    .map((b) => ({
      start: b.start,
      end: b.end,
      text: b.prefix + serializeInline(b.element) + b.suffix + b.newline,
    }));
  return applyEdits(visualSource, edits);
}
function dirty() {
  return documentInfo && currentContent() !== saved;
}
function syncCode(content) {
  if (editor.getValue() === content) return;
  editor.pushUndoStop();
  editor.executeEdits('visual', [{ range: editor.getModel().getFullModelRange(), text: content }]);
  editor.pushUndoStop();
}
function renderVisual(source) {
  visualSource = source;
  blocks = parseSource(source);
  $('visual').replaceChildren();
  for (const block of blocks) {
    const element = document.createElement(block.html === null ? 'pre' : block.tag);
    block.element = element;
    element.dataset.start = block.start;
    if (block.html === null) {
      element.className = 'source-block';
      element.textContent = block.raw;
      element.title = 'Preserved LaTeX. Double-click to edit in Code.';
      element.ondblclick = () => switchMode('code', block.start);
    } else {
      element.innerHTML = block.html;
      element.contentEditable = 'true';
      element.spellcheck = true;
      element.addEventListener('input', () => {
        block.changed = true;
        status('Unsaved changes');
      });
      // Keep edits inside this source region. Pasted HTML never enters the document.
      element.addEventListener('beforeinput', (e) => {
        const selection = window.getSelection();
        if (
          selection.rangeCount &&
          (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode))
        )
          e.preventDefault();
        if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
          e.preventDefault();
          document.execCommand('insertText', false, ' ');
        }
      });
      element.addEventListener('paste', (e) => {
        e.preventDefault();
        document.execCommand(
          'insertText',
          false,
          e.clipboardData.getData('text/plain').replace(/\r?\n/g, ' '),
        );
      });
      element.addEventListener('drop', (e) => e.preventDefault());
    }
    $('visual').append(element);
  }
}
function switchMode(next, offset) {
  if (!editor || next === mode) return;
  const content = currentContent();
  if (next === 'code') {
    if (offset === undefined) {
      const selected = window.getSelection()?.anchorNode;
      offset = blocks.find((b) => b.element.contains(selected))?.start;
    }
    syncCode(content);
  } else renderVisual(content);
  mode = next;
  $('visual').hidden = next !== 'visual';
  $('code').hidden = next !== 'code';
  $('format').hidden = next !== 'visual';
  $('visual-mode').setAttribute('aria-pressed', String(next === 'visual'));
  $('code-mode').setAttribute('aria-pressed', String(next === 'code'));
  editor.layout();
  if (next === 'code') {
    if (offset !== undefined) {
      const position = editor.getModel().getPositionAt(offset);
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
    }
    editor.focus();
  } else {
    const position = editor.getModel().getOffsetAt(editor.getPosition());
    blocks
      .find((b) => b.start <= position && b.end > position)
      ?.element.scrollIntoView({ block: 'center' });
  }
}
async function load(file) {
  const result = await api('/api/document' + (file ? '?' + new URLSearchParams({ file }) : ''));
  documentInfo = result;
  saved = result.content;
  editor.setValue(saved);
  renderVisual(saved);
  $('filename').textContent = result.file_name;
  $('filename').title = result.file_path;
  $('engine').value = result.engine;
  history.replaceState(null, '', '/?' + new URLSearchParams({ file: result.file_path }));
  pdf = null;
  $('download-pdf').disabled = true;
  ++renderId;
  $('pages').textContent = 'Compile to preview your PDF.';
  if (result.pdf_exists) await loadPdf();
  status('Ready');
}
async function operation(action) {
  if (busy || !documentInfo) return;
  busy = true;
  document.querySelectorAll('header button, nav button').forEach((b) => (b.disabled = true));
  const content = currentContent();
  status(action === 'save' ? 'Saving…' : action === 'compile' ? 'Compiling…' : 'Exporting…');
  try {
    const result = await api('/api/' + action, {
      file: documentInfo.file_path,
      revision: documentInfo.revision,
      content,
      engine: $('engine').value,
    });
    documentInfo.revision = result.revision;
    saved = content;
    $('log').textContent = result.log || result.error || result.message || '';
    if (!result.success) {
      $('diagnostics').open = true;
      throw new Error(result.error || result.message || 'Compilation failed; see build messages.');
    }
    if (action === 'compile') await loadPdf();
    if (action === 'export_docx') {
      download('docx');
      $('diagnostics').open = true;
    }
    status(dirty() ? 'Unsaved changes' : action === 'save' ? 'Saved' : 'Done');
    return true;
  } catch (error) {
    status(error.message);
    return false;
  } finally {
    busy = false;
    document.querySelectorAll('header button, nav button').forEach((b) => (b.disabled = false));
    $('download-pdf').disabled = !pdf;
  }
}
function download(format) {
  const link = document.createElement('a');
  link.href = '/api/' + format + '?' + new URLSearchParams({ file: documentInfo.file_path });
  link.download = documentInfo.file_name.replace(/\.tex$/i, '.' + format);
  link.click();
}
async function loadPdf() {
  const response = await fetch('/api/pdf?' + new URLSearchParams({ file: documentInfo.file_path }));
  if (!response.ok) throw new Error('PDF is unavailable');
  if (pdf) await pdf.destroy();
  pdf = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise;
  await renderPdf();
  $('download-pdf').disabled = false;
}
async function renderPdf() {
  if (!pdf || $('preview').hidden) return;
  const id = ++renderId,
    current = pdf;
  $('pages').replaceChildren();
  for (let i = 1; i <= current.numPages; i++) {
    const page = await current.getPage(i);
    if (id !== renderId) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.max(0.2, ($('preview').clientWidth - 40) / base.width) * pdfZoom;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ratio = window.devicePixelRatio || 1;
    canvas.width = viewport.width * ratio;
    canvas.height = viewport.height * ratio;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    canvas.setAttribute('aria-label', `PDF page ${i}`);
    $('pages').append(canvas);
    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    }).promise;
  }
}
$('save').onclick = () => operation('save');
$('compile').onclick = () => operation('compile');
$('docx').onclick = () => operation('export_docx');
$('download-pdf').onclick = () => {
  if (documentInfo) download('pdf');
};
$('code-mode').onclick = () => switchMode('code');
$('visual-mode').onclick = () => switchMode('visual');
$('reload').onclick = async () => {
  if (dirty() && !confirm('Discard your unsaved changes and reload from disk?')) return;
  try {
    await load(documentInfo.file_path);
  } catch (e) {
    status(e.message);
  }
};
$('open').onclick = async () => {
  if (dirty() && !(await operation('save'))) return;
  const file = prompt('Absolute path to a LaTeX file:', documentInfo?.file_path || '');
  if (!file) return;
  try {
    const info = await api('/api/open', { file });
    await load(info.file_path);
  } catch (e) {
    status(e.message);
  }
};
$('pdf-toggle').onclick = () => {
  $('preview').hidden = !$('preview').hidden;
  $('pdf-toggle').setAttribute('aria-pressed', String(!$('preview').hidden));
  editor.layout();
  renderPdf().catch((e) => status(e.message));
};
for (const [id, delta] of [
  ['pdf-in', 0.15],
  ['pdf-out', -0.15],
])
  $(id).onclick = () => {
    pdfZoom = Math.max(0.4, Math.min(3, pdfZoom + delta));
    $('pdf-zoom').textContent = Math.round(pdfZoom * 100) + '%';
    renderPdf().catch((e) => status(e.message));
  };
for (const [id, delta] of [
  ['visual-in', 0.1],
  ['visual-out', -0.1],
])
  $(id).onclick = () => {
    visualZoom = Math.max(0.6, Math.min(2, visualZoom + delta));
    $('visual').style.fontSize = 16 * visualZoom + 'px';
    $('visual-zoom').textContent = Math.round(visualZoom * 100) + '%';
  };
document.querySelectorAll('[data-format]').forEach((button) => {
  button.onmousedown = (e) => e.preventDefault();
  button.onclick = () => {
    const selection = window.getSelection();
    const block = blocks.find(
      (b) =>
        b.html !== null &&
        b.element.contains(selection.anchorNode) &&
        b.element.contains(selection.focusNode),
    );
    if (!block || selection.isCollapsed) {
      status('Select text in one editable block first.');
      return;
    }
    const range = selection.getRangeAt(0);
    const tag = { bold: 'strong', italic: 'em', underline: 'u' }[button.dataset.format];
    const wrapper = document.createElement(tag);
    wrapper.append(range.extractContents());
    range.insertNode(wrapper);
    block.changed = true;
    status('Unsaved changes');
  };
});
window.addEventListener('beforeunload', (e) => {
  if (dirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['s', 'Enter'].includes(e.key)) {
    e.preventDefault();
    operation(e.key === 's' ? 'save' : 'compile');
  }
  if (e.altKey && e.key.toLowerCase() === 'z' && editor) {
    e.preventDefault();
    editor.updateOptions({ wordWrap: editor.getRawOptions().wordWrap === 'on' ? 'off' : 'on' });
  }
});
self.MonacoEnvironment = {
  getWorker: () => new Worker('/src/editor.worker.js', { type: 'module' }),
};
async function initialize() {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\[a-zA-Z@]+/, 'keyword'],
        [/\$[^$]*\$/, 'string'],
        [/[{}]/, 'delimiter.bracket'],
      ],
    },
  });
  editor = monaco.editor.create($('code'), {
    value: '',
    language: 'latex',
    automaticLayout: true,
    wordWrap: 'on',
    minimap: { enabled: false },
    theme: 'vs-dark',
  });
  editor.onDidChangeModelContent(() => {
    if (mode === 'code') status(dirty() ? 'Unsaved changes' : 'Saved');
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => operation('save'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => operation('compile'));
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () =>
    editor.updateOptions({ wordWrap: editor.getRawOptions().wordWrap === 'on' ? 'off' : 'on' }),
  );
  try {
    await load(fileFromUrl);
  } catch (e) {
    status(e.message);
  }
}
initialize().catch((e) => status(e.message));
