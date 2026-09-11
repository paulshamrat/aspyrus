// LocalLeaf - Overleaf-Style Local LaTeX Editor Client (with PDF.js & Clean Visual Parser)

import * as pdfjsLib from '/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

let editor = null;
let currentFileInfo = null;
let isCompiling = false;
let currentMode = 'visual'; // 'code' or 'visual'
let currentPreamble = '';
let currentPdfDoc = null;

// DOM Elements
const elActiveFilename = document.getElementById('active-filename');
const elFileSelectorBtn = document.getElementById('file-selector-btn');
const elBtnRecompile = document.getElementById('btn-recompile');
const elEngineSelect = document.getElementById('engine-select');
const elStatusBadge = document.getElementById('status-badge');
const elStatusText = document.getElementById('status-text');
const elAutoCompileChk = document.getElementById('auto-compile-chk');
const elPdfPagesContainer = document.getElementById('pdf-pages-container');
const elBtnToggleLog = document.getElementById('btn-toggle-log');
const elBtnCloseLog = document.getElementById('btn-close-log');
const elBtnDownloadPdf = document.getElementById('btn-download-pdf');
const elBtnTheme = document.getElementById('btn-theme');
const elThemeIcon = document.getElementById('theme-icon');
const elLogDrawer = document.getElementById('log-drawer');
const elErrorsList = document.getElementById('errors-list');
const elRawLogText = document.getElementById('raw-log-text');
const elErrorCountBadge = document.getElementById('error-count-badge');
const elSplitter = document.getElementById('splitter');
const elEditorPane = document.getElementById('editor-pane');
const elPdfPane = document.getElementById('pdf-pane');
const elFileModal = document.getElementById('file-modal');
const elBtnCloseModal = document.getElementById('btn-close-modal');
const elFileList = document.getElementById('file-list');
const elFileSearchInput = document.getElementById('file-search-input');

// Mode Switch Elements
const elBtnModeCode = document.getElementById('btn-mode-code');
const elBtnModeVisual = document.getElementById('btn-mode-visual');
const elEditorContainer = document.getElementById('editor-container');
const elVisualContainer = document.getElementById('visual-container');
const elVisualToolbar = document.getElementById('visual-toolbar');

// Visual Editor Elements
const elPreambleToggle = document.getElementById('preamble-toggle');
const elPreambleArrow = document.getElementById('preamble-arrow');
const elPreambleBody = document.getElementById('preamble-body');
const elPreambleTextarea = document.getElementById('preamble-textarea');
const elVisualBody = document.getElementById('visual-body');

// LibreOffice / Word Style Visual Toolbar Elements
const elVBtnUndo = document.getElementById('v-btn-undo');
const elVBtnRedo = document.getElementById('v-btn-redo');
const elVFormatSelect = document.getElementById('v-format-select');
const elVFontSelect = document.getElementById('v-font-select');
const elVBtnBold = document.getElementById('v-btn-bold');
const elVBtnItalic = document.getElementById('v-btn-italic');
const elVBtnUnderline = document.getElementById('v-btn-underline');
const elVBtnStrike = document.getElementById('v-btn-strike');
const elVBtnSup = document.getElementById('v-btn-sup');
const elVBtnSub = document.getElementById('v-btn-sub');
const elVBtnAlignLeft = document.getElementById('v-btn-align-left');
const elVBtnAlignCenter = document.getElementById('v-btn-align-center');
const elVBtnAlignRight = document.getElementById('v-btn-align-right');
const elVBtnBullet = document.getElementById('v-btn-bullet');
const elVBtnNumber = document.getElementById('v-btn-number');
const elVBtnOutdent = document.getElementById('v-btn-outdent');
const elVBtnIndent = document.getElementById('v-btn-indent');
const elVBtnHr = document.getElementById('v-btn-hr');
const elVBtnLink = document.getElementById('v-btn-link');
const elVBtnInsertEntry = document.getElementById('v-btn-insert-entry');
const elVBtnClear = document.getElementById('v-btn-clear');
const elVSizeSelect = document.getElementById('v-size-select');
const elVSpacingSelect = document.getElementById('v-spacing-select');
const elVPointsSelect = document.getElementById('v-points-select');

// DOCX Export Buttons
const elBtnExportDocx = document.getElementById('btn-export-docx');
const elBtnDownloadDocx = document.getElementById('btn-download-docx');

// Dismiss Logs
const elBtnDismissLogs = document.getElementById('btn-dismiss-logs');

// PDF Zoom Toolbar Elements
const elPdfZoomOut = document.getElementById('pdf-zoom-out');
const elPdfZoomIn = document.getElementById('pdf-zoom-in');
const elPdfZoomLevel = document.getElementById('pdf-zoom-level');
const elPdfZoomFit = document.getElementById('pdf-zoom-fit');
const elPdfZoomReset = document.getElementById('pdf-zoom-reset');
const elPdfPageIndicator = document.getElementById('pdf-page-indicator');
const elPdfContainer = document.getElementById('pdf-container');


// Toggle PDF Preview Visibility (Hide / Show)
const elBtnTogglePdf = document.getElementById('btn-toggle-pdf');
const elBtnTogglePdfText = document.getElementById('btn-toggle-pdf-text');
const elWorkspace = document.getElementById('workspace');

let isPdfHidden = localStorage.getItem('localleaf-hide-pdf') === 'true';

function updatePdfVisibility(hide) {
  isPdfHidden = hide;
  if (isPdfHidden) {
    elWorkspace.classList.add('hide-pdf');
    if (elBtnTogglePdfText) elBtnTogglePdfText.textContent = 'PDF';
    elBtnTogglePdf.classList.remove('active');
  } else {
    elWorkspace.classList.remove('hide-pdf');
    if (elBtnTogglePdfText) elBtnTogglePdfText.textContent = 'PDF';
    elBtnTogglePdf.classList.add('active');
    if (currentPdfDoc) {
      renderPdfViewer();
    }
  }
  localStorage.setItem('localleaf-hide-pdf', isPdfHidden);
  if (editor) editor.layout();
}

if (isPdfHidden) {
  updatePdfVisibility(true);
}

elBtnTogglePdf.addEventListener('click', () => {
  updatePdfVisibility(!isPdfHidden);
});

elSplitter.addEventListener('dblclick', () => {
  updatePdfVisibility(!isPdfHidden);
});

window.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    updatePdfVisibility(!isPdfHidden);
  }
});

// Setup Monaco AMD loader
require.config({ paths: { 'vs': '/monaco/vs' } });

require(['vs/editor/editor.main'], function () {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    tokenPostfix: '.latex',
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\$\$[\s\S]*?\$\$/, 'string.math'],
        [/\$[^\$]+?\$/, 'string.math'],
        [/\\(documentclass|usepackage|begin|end|section|subsection|subsubsection|paragraph|item|cite|ref|label|input|include)\b/, 'keyword'],
        [/\\\b[a-zA-Z@]+/, 'type.identifier'],
        [/[{}]/, 'delimiter.bracket'],
        [/[[\]]/, 'delimiter.square'],
        [/&/, 'operator'],
        [/\\\\/, 'operator'],
        [/\\if[a-zA-Z@]+/, 'keyword.control'],
        [/\\else\b|\\fi\b/, 'keyword.control'],
        [/\\newif\b/, 'keyword.control']
      ]
    }
  });

  const savedTheme = localStorage.getItem('localleaf-theme') || 'dark';
  applyTheme(savedTheme);

  // Initialize Monaco Editor
  editor = monaco.editor.create(elEditorContainer, {
    value: '% Loading file...',
    language: 'latex',
    theme: savedTheme === 'dark' ? 'vs-dark' : 'vs',
    automaticLayout: true,
    fontSize: 14,
    lineNumbers: 'on',
    wordWrap: 'on',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderWhitespace: 'selection'
  });

  function toggleWordWrap() {
    if (!editor) return;
    const currentWrap = editor.getRawOptions ? editor.getRawOptions().wordWrap : editor.getOption(monaco.editor.EditorOption.wordWrap);
    const nextWrap = (currentWrap === 'on') ? 'off' : 'on';
    editor.updateOptions({ wordWrap: nextWrap });
    setStatus('ready', `Word wrap: ${nextWrap}`);
    setTimeout(() => setStatus('ready', 'Ready'), 1200);
  }

  editor.addAction({
    id: 'toggle-word-wrap-action',
    label: 'Toggle Word Wrap (Alt+Z)',
    keybindings: [
      monaco.KeyMod.Alt | monaco.KeyCode.KeyZ
    ],
    run: function () {
      toggleWordWrap();
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
    if (elAutoCompileChk.checked) {
      triggerCompile();
    } else {
      saveContentOnly();
    }
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, function () {
    triggerCompile();
  });

  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyZ' || (e.key && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      toggleWordWrap();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (elAutoCompileChk.checked) {
        triggerCompile();
      } else {
        saveContentOnly();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerCompile();
    } else if (e.key === 'Escape') {
      dismissLogDrawer();
      if (elFileModal && !elFileModal.classList.contains('hidden')) {
        elFileModal.classList.add('hidden');
      }
      document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    }
  });

  // Load initial active file
  loadFile();
});

// Bi-directional Cursor / Position Synchronization between Visual and Code
let lastActiveVisualSnippet = '';

function updateVisualSelectionSnippet() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  let node = selection.anchorNode;
  if (!node) return;
  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }
  if (!elVisualBody || !elVisualBody.contains(node)) return;

  let block = node;
  while (block && block !== elVisualBody && !['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'TR', 'DIV'].includes(block.tagName)) {
    block = block.parentElement;
  }
  if (!block || block === elVisualBody) block = node;

  const text = block.textContent.trim();
  if (text) {
    const words = text.replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      lastActiveVisualSnippet = words.slice(0, 4).join(' ');
    }
  }
}

function jumpCodeEditorToSnippet(snippet) {
  if (!editor || !snippet) return;
  const model = editor.getModel();
  if (!model) return;

  let matches = model.findMatches(snippet, false, false, false, null, false);
  if (!matches || matches.length === 0) {
    const words = snippet.split(/\s+/).filter(w => w.length > 2);
    if (words.length >= 2) {
      matches = model.findMatches(words.slice(0, 2).join(' '), false, false, false, null, false);
    }
    if ((!matches || matches.length === 0) && words.length > 0) {
      matches = model.findMatches(words[0], false, false, false, null, false);
    }
  }

  if (matches && matches.length > 0) {
    const targetLine = matches[0].range.startLineNumber;
    editor.revealLineInCenter(targetLine);
    editor.setPosition({ lineNumber: targetLine, column: matches[0].range.startColumn });
    editor.focus();
  }
}

function jumpVisualEditorToText(text) {
  if (!text || !elVisualBody) return;
  const words = text.replace(/[^\w\s-]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return;

  const targetSearch = words.slice(0, 3).join(' ').toLowerCase();
  const singleSearch = words[0].toLowerCase();

  const walker = document.createTreeWalker(elVisualBody, NodeFilter.SHOW_ELEMENT);
  let matchNode = null;
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'TR', 'DIV'].includes(el.tagName)) {
      const content = el.textContent.toLowerCase();
      if (content.includes(targetSearch)) {
        matchNode = el;
        break;
      }
    }
  }

  if (!matchNode) {
    const walker2 = document.createTreeWalker(elVisualBody, NodeFilter.SHOW_ELEMENT);
    while (walker2.nextNode()) {
      const el = walker2.currentNode;
      if (['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'TR'].includes(el.tagName)) {
        if (el.textContent.toLowerCase().includes(singleSearch)) {
          matchNode = el;
          break;
        }
      }
    }
  }

  if (matchNode) {
    matchNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    matchNode.classList.add('visual-highlight-jump');
    setTimeout(() => matchNode.classList.remove('visual-highlight-jump'), 1500);
  }
}

// Switch Between Code and Visual Modes with Position Sync
function setEditorMode(mode) {
  if (currentMode === mode) return;

  if (mode === 'code') {
    updateVisualSelectionSnippet();
    const latexCode = serializeVisualToLatex();
    if (editor) {
      editor.setValue(latexCode);
    }
    elEditorContainer.classList.remove('hidden');
    elVisualContainer.classList.add('hidden');
    elBtnModeCode.classList.add('active');
    elBtnModeVisual.classList.remove('active');
    elVisualToolbar.classList.add('disabled');
    currentMode = 'code';
    if (editor) {
      editor.layout();
      editor.focus();
      if (lastActiveVisualSnippet) {
        setTimeout(() => jumpCodeEditorToSnippet(lastActiveVisualSnippet), 40);
      }
    }
  } else {
    let currentLineText = '';
    if (editor) {
      const pos = editor.getPosition();
      if (pos) {
        const lineContent = editor.getModel().getLineContent(pos.lineNumber);
        currentLineText = lineContent.replace(/\\(?:textbf|textit|href|cvsection|begin|end|item|rule|fontsize|selectfont)\b[^{}]*(\{[^}]*\})?/g, ' ').trim();
      }
    }
    const latexCode = editor ? editor.getValue() : '';
    renderLatexToVisual(latexCode);
    elEditorContainer.classList.add('hidden');
    elVisualContainer.classList.remove('hidden');
    elBtnModeVisual.classList.add('active');
    elBtnModeCode.classList.remove('active');
    elVisualToolbar.classList.remove('disabled');
    currentMode = 'visual';

    if (currentLineText) {
      setTimeout(() => jumpVisualEditorToText(currentLineText), 40);
    }
  }
}

elBtnModeCode.addEventListener('click', () => setEditorMode('code'));
elBtnModeVisual.addEventListener('click', () => setEditorMode('visual'));

// Preamble Accordion Toggle
elPreambleToggle.addEventListener('click', () => {
  const isCollapsed = elPreambleBody.classList.contains('collapsed');
  if (isCollapsed) {
    elPreambleBody.classList.remove('collapsed');
    elPreambleArrow.classList.add('expanded');
  } else {
    elPreambleBody.classList.add('collapsed');
    elPreambleArrow.classList.remove('expanded');
  }
});

// PDF Zoom State
let pdfZoomMode = 'fit'; // 'fit' or 'manual'
let pdfZoomScale = 1.0;

// PDF.js Canvas Multi-Page Rendering (Works 100% inside VS Code Webview)
async function renderPdfViewer() {
  if (!elPdfPagesContainer) return;
  elPdfPagesContainer.innerHTML = '<div class="pdf-loading-msg">Rendering PDF...</div>';
  const pdfUrl = `/api/pdf?t=${Date.now()}`;

  try {
    const res = await fetch(pdfUrl);
    if (!res.ok) {
      elPdfPagesContainer.innerHTML = '<div class="pdf-loading-msg">PDF not compiled yet. Click Recompile (Ctrl+S).</div>';
      if (elPdfPageIndicator) elPdfPageIndicator.textContent = 'No PDF';
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    currentPdfDoc = await loadingTask.promise;
    elPdfPagesContainer.innerHTML = '';

    if (elPdfPageIndicator) {
      elPdfPageIndicator.textContent = `${currentPdfDoc.numPages} Page${currentPdfDoc.numPages > 1 ? 's' : ''}`;
    }

    const availableWidth = Math.max(260, elPdfPagesContainer.clientWidth - 40);
    let targetWidth;

    if (pdfZoomMode === 'fit') {
      targetWidth = Math.min(availableWidth, 850);
      if (elPdfZoomLevel) elPdfZoomLevel.textContent = 'Fit';
    } else {
      const baseWidth = Math.min(availableWidth, 750);
      targetWidth = Math.round(baseWidth * pdfZoomScale);
      if (elPdfZoomLevel) elPdfZoomLevel.textContent = `${Math.round(pdfZoomScale * 100)}%`;
    }

    for (let pageNum = 1; pageNum <= currentPdfDoc.numPages; pageNum++) {
      const page = await currentPdfDoc.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = targetWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale: scale * 1.5 }); // High-DPI scale

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${targetWidth}px`;
      canvas.style.height = `${(viewport.height / viewport.width) * targetWidth}px`;

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;

      pageWrapper.appendChild(canvas);
      elPdfPagesContainer.appendChild(pageWrapper);
    }
  } catch (err) {
    console.error('PDF render error:', err);
    elPdfPagesContainer.innerHTML = `<div class="pdf-loading-msg">Could not load PDF: ${escapeHtml(err.message)}</div>`;
  }
}

function zoomPdf(delta) {
  pdfZoomMode = 'manual';
  pdfZoomScale = Math.max(0.4, Math.min(3.0, Math.round((pdfZoomScale + delta) * 100) / 100));
  renderPdfViewer();
}

if (elPdfZoomIn) elPdfZoomIn.addEventListener('click', () => zoomPdf(0.15));
if (elPdfZoomOut) elPdfZoomOut.addEventListener('click', () => zoomPdf(-0.15));
if (elPdfZoomFit) {
  elPdfZoomFit.addEventListener('click', () => {
    pdfZoomMode = 'fit';
    pdfZoomScale = 1.0;
    renderPdfViewer();
  });
}
if (elPdfZoomReset) {
  elPdfZoomReset.addEventListener('click', () => {
    pdfZoomMode = 'manual';
    pdfZoomScale = 1.0;
    renderPdfViewer();
  });
}

if (elPdfContainer) {
  elPdfContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      zoomPdf(e.deltaY < 0 ? 0.1 : -0.1);
    }
  }, { passive: false });
}

// Clean LaTeX to Visual Parser
function renderLatexToVisual(fullLatex) {
  const isBps = !fullLatex.includes('\\bpsfalse') && fullLatex.includes('\\bpstrue');
  const beginDocIdx = fullLatex.indexOf('\\begin{document}');
  let preamble = '';
  let body = fullLatex;

  if (beginDocIdx !== -1) {
    preamble = fullLatex.substring(0, beginDocIdx).trim();
    body = fullLatex.substring(beginDocIdx + '\\begin{document}'.length);
  }

  const endDocIdx = body.lastIndexOf('\\end{document}');
  if (endDocIdx !== -1) {
    body = body.substring(0, endDocIdx);
  }

  currentPreamble = preamble;
  elPreambleTextarea.value = preamble;

  elVisualBody.innerHTML = parseLatexToCleanHtml(body.trim(), isBps);
}

function preprocessConditionals(latex, isBps = true) {
  let s = latex;
  if (isBps) {
    s = s.replace(/\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\else((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '$1');
    s = s.replace(/\\ifbps\s*\\else((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '');
    s = s.replace(/\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '$1');
  } else {
    s = s.replace(/\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\else((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '$2');
    s = s.replace(/\\ifbps\s*\\else((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '$1');
    s = s.replace(/\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\fi/g, '');
  }
  s = s.replace(/\\ifbps\b/g, '');
  s = s.replace(/\\else\b/g, '');
  s = s.replace(/\\fi\b/g, '');
  return s;
}

function parseLatexToCleanHtml(latex, isBps = true) {
  let preprocessed = preprocessConditionals(latex, isBps);
  let lines = preprocessed.split('\n');
  let html = '';
  let inItemize = false;
  let inEnumerate = false;
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    let rawLine = lines[i];
    let line = rawLine.trim();

    // Skip empty or pure comment lines
    if (!line || line.startsWith('%')) continue;

    // Skip document setup commands
    if (line.startsWith('\\thispagestyle') || line.startsWith('\\setlength') || line.startsWith('\\renewcommand') || line.startsWith('\\pagestyle')) {
      continue;
    }

    // Skip lines that are purely vspace or hspace
    if (/^\\(vspace|hspace)\*?(\{[^}]*\}|\d+\w+)?$/.test(line)) {
      continue;
    }

    // Handle Header Block (Center, Left, or Right)
    if (line.includes('\\begin{center}') || line.includes('\\begin{flushleft}') || line.includes('\\begin{flushright}')) {
      const isLeft = line.includes('\\begin{flushleft}');
      const isRight = line.includes('\\begin{flushright}');
      const alignVal = isLeft ? 'left' : (isRight ? 'right' : 'center');
      let headerBlockHtml = `<div class="cv-header-block" style="text-align: ${alignVal};" data-align="${alignVal}">`;
      let name = '';
      let address = '';
      let contacts = [];
      let badge = '';

      i++;
      while (i < lines.length && !lines[i].includes('\\end{center}') && !lines[i].includes('\\end{flushleft}') && !lines[i].includes('\\end{flushright}')) {
        let hline = lines[i].trim();
        if (hline && !hline.startsWith('%')) {
          let nameMatch = hline.match(/\\textbf\{([^{}]+)\}/);
          if (nameMatch && (hline.includes('16pt') || !name)) {
            name = nameMatch[1];
          } else if (hline.includes('Biophysical Society') || hline.includes('Student Member')) {
            badge = 'Biophysical Society (BPS) Student Member';
          } else if (hline.includes('Google Scholar') || hline.includes('E-mail') || hline.includes('GitHub') || hline.includes('Phone:')) {
            let cleanedContacts = cleanLatexTypography(hline);
            if (cleanedContacts) contacts.push(cleanedContacts);
          } else {
            let addr = cleanLatexTypography(hline);
            if (addr) address = addr;
          }
        }
        i++;
      }

      if (name) headerBlockHtml += `<h1 class="cv-name" style="text-align: ${alignVal};">${escapeHtml(name)}</h1>`;
      if (address) headerBlockHtml += `<div class="cv-address" style="text-align: ${alignVal};">${address}</div>`;
      if (contacts.length > 0) {
        let contactText = contacts.join(' · ').replace(/(?: · )+/g, ' · ').replace(/^[·\s]+|[·\s]+$/g, '');
        headerBlockHtml += `<div class="cv-contacts" style="text-align: ${alignVal};">${contactText}</div>`;
      }
      if (badge) {
        headerBlockHtml += `<div class="cv-tag-container" style="text-align: ${alignVal};"><span class="cv-tag">${escapeHtml(badge)}</span></div>`;
      }

      headerBlockHtml += '</div>';
      html += headerBlockHtml;
      continue;
    }

    // Handle Sections
    let sectionMatch = line.match(/^\\(?:cvsection|section\*?)\{(.*?)\}/);
    if (sectionMatch) {
      if (inItemize) { html += '</ul>'; inItemize = false; }
      if (inEnumerate) { html += '</ol>'; inEnumerate = false; }
      let secTitle = cleanLatexTypography(sectionMatch[1]);
      html += `<h2 class="cv-section-title">${secTitle}</h2>`;
      continue;
    }

    // Handle Tables
    if (line.includes('\\begin{tabular}')) {
      inTable = true;
      tableRows = [];
      continue;
    }
    if (line.includes('\\end{tabular}')) {
      inTable = false;
      html += '<table class="cv-table">';
      tableRows.forEach(row => {
        let cells = row.split('&');
        if (cells.length >= 2) {
          html += `<tr><td class="col-date">${cleanLatexTypography(cells[0])}</td><td class="col-desc">${cleanLatexTypography(cells.slice(1).join('&'))}</td></tr>`;
        } else {
          html += `<tr><td colspan="2">${cleanLatexTypography(row)}</td></tr>`;
        }
      });
      html += '</table>';
      continue;
    }
    if (inTable) {
      let rowText = line.replace(/\\\\.*$/, '').trim();
      if (rowText) tableRows.push(rowText);
      continue;
    }

    // Handle Lists
    if (line.startsWith('\\begin{itemize}')) {
      inItemize = true;
      html += '<ul class="cv-list">';
      continue;
    }
    if (line.startsWith('\\end{itemize}')) {
      inItemize = false;
      html += '</ul>';
      continue;
    }
    if (line.startsWith('\\begin{enumerate}')) {
      inEnumerate = true;
      html += '<ol class="cv-list">';
      continue;
    }
    if (line.startsWith('\\end{enumerate}')) {
      inEnumerate = false;
      html += '</ol>';
      continue;
    }

    // Handle List Items
    if (line.startsWith('\\item')) {
      let itemContent = line.replace(/^\\item\s*/, '');
      let formatted = cleanLatexTypography(itemContent);
      if (inItemize || inEnumerate) {
        html += `<li>${formatted}</li>`;
      } else {
        html += `<ul class="cv-list"><li>${formatted}</li></ul>`;
      }
      continue;
    }

    // Handle Title with Date: \textbf{Title} \hfill \textbf{Date} \\
    if (line.includes('\\hfill')) {
      let parts = line.split('\\hfill');
      let titlePart = cleanLatexTypography(parts[0]);
      let datePart = cleanLatexTypography(parts[1]);
      html += `<div class="cv-entry-row"><span class="cv-entry-title">${titlePart}</span><span class="cv-entry-date">${datePart}</span></div>`;
      continue;
    }

    // Normal formatted line
    let clean = cleanLatexTypography(line);
    if (clean) {
      if (clean.startsWith('Utilizing the knowledge') || clean.length > 120) {
        html += `<p class="cv-summary">${clean}</p>`;
      } else {
        html += `<p class="cv-subline">${clean}</p>`;
      }
    }
  }

  if (inItemize) html += '</ul>';
  if (inEnumerate) html += '</ol>';

  return html || '<p>Start typing your CV...</p>';
}

function cleanLatexTypography(str) {
  if (!str) return '';
  let s = str;
  // Strip font size wrappers
  s = s.replace(/\{\\fontsize\{[^}]+\}\{[^}]+\}\\selectfont\s*/g, '');
  s = s.replace(/\\fontsize\{[^}]+\}\{[^}]+\}/g, '');
  s = s.replace(/\\selectfont\b/g, '');
  s = s.replace(/\\par\b/g, '');
  s = s.replace(/\\noindent\b/g, '');
  // Clean bracket spacing like [2pt], [1.5pt]
  s = s.replace(/\[\d+(\.\d+)?(pt|em|ex|cm|mm|in)\]/g, '');
  // Line breaks \\ with optional bracket
  s = s.replace(/\\\\(\[\d+(\.\d+)?(pt|em|ex|cm|mm|in)\])?/g, ' ');

  // Handle superscripts and subscripts
  s = s.replace(/\\textsuperscript\{([^}]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/\$\^\{?\*\}?\$/g, '<sup>*</sup>');
  s = s.replace(/\$\^\{([^}]+)\}\$/g, '<sup>$1</sup>');
  s = s.replace(/\\textsubscript\{([^}]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/\$_\{([^}]+)\}\$/g, '<sub>$1</sub>');

  // Middle dot: \cdot or $\cdot$ or $\;\cdot\;$
  s = s.replace(/\\cdot|\$\s*\\cdot\s*\$/g, ' · ');
  // Math vert / pipes: \vert or $\vert$ or $\;\vert\;$
  s = s.replace(/\$\s*\\;?\\vert\\;?\s*\$|\\vert/g, ' · ');

  // Preserve currency $
  s = s.replace(/\\\$/g, '___DOLLAR___');
  // Math dollar signs
  s = s.replace(/\$/g, '');
  s = s.replace(/___DOLLAR___/g, '$');

  // Strip vspace, hspace
  s = s.replace(/\\(vspace|hspace)\*?(\{[^}]*\}|\d+\w+)?/g, '');
  // LaTeX logo
  s = s.replace(/\\LaTeX\\?/g, 'LaTeX');
  // Convert \textbf{...} -> <strong>...</strong>
  s = s.replace(/\\textbf\{([^{}]+)\}/g, '<strong>$1</strong>');
  // Convert \textit{...} -> <em>...</em>
  s = s.replace(/\\textit\{([^{}]+)\}/g, '<em>$1</em>');
  // Convert \underline{...} -> <u>...</u>
  s = s.replace(/\\underline\{([^{}]+)\}/g, '<u>$1</u>');
  // Convert \href{url}{text} -> <a href="url">text</a>
  s = s.replace(/\\href\{([^}]+)\}\{([^}]+)\}/g, '<a href="$1" target="_blank">$2</a>');
  s = s.replace(/\\href\{([^}]+)\}/g, '<a href="$1" target="_blank">$1</a>');
  // Convert \url{url}
  s = s.replace(/\\url\{([^}]+)\}/g, '<a href="$1" target="_blank">$1</a>');
  // Escaped characters: \&, %, \_, \#
  s = s.replace(/\\&/g, '&amp;');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\#/g, '#');
  s = s.replace(/--/g, '–');
  s = s.replace(/---/g, '—');
  s = s.replace(/\\dots/g, '…');
  s = s.replace(/\\quad|\\qquad/g, ' ');
  s = s.replace(/~+/g, ' ');
  s = s.replace(/\{|\}/g, ''); // strip remaining dangling braces
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[·|•,\s]+|[·|•,\s]+$/g, '').trim();
  return s;
}

function getBlockAlignment(el) {
  if (!el) return 'center';
  if (el.dataset && el.dataset.align) return el.dataset.align;
  if (el.style && el.style.textAlign) return el.style.textAlign;
  if (el.getAttribute && el.getAttribute('align')) return el.getAttribute('align');
  const innerLeft = el.querySelector('[style*="text-align: left"], [style*="text-align:start"], [align="left"]');
  if (innerLeft) return 'left';
  const innerRight = el.querySelector('[style*="text-align: right"], [style*="text-align:end"], [align="right"]');
  if (innerRight) return 'right';
  const innerCenter = el.querySelector('[style*="text-align: center"], [align="center"]');
  if (innerCenter) return 'center';
  return 'center';
}

// Serialize Visual DOM back to valid LaTeX without dropping user content
function serializeVisualToLatex() {
  const preamble = elPreambleTextarea.value.trim();
  let bodyLatex = '';

  const nodes = elVisualBody.childNodes;
  for (let node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = deformatHtmlToLatex(node.textContent).trim();
      if (txt) {
        bodyLatex += `${txt} \\\\\n`;
      }
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const cl = node.classList;
      const tag = node.tagName.toLowerCase();

      if (cl.contains('cv-header-block')) {
        const nameEl = node.querySelector('.cv-name');
        const name = nameEl ? deformatHtmlToLatex(nameEl.innerHTML).trim() : 'Shamrat Kumar Paul';
        const addrEl = node.querySelector('.cv-address');
        const addr = addrEl ? deformatHtmlToLatex(addrEl.innerHTML).trim() : '';
        const contactsEl = node.querySelector('.cv-contacts');
        const hasBps = node.querySelector('.cv-tag') !== null;

        const align = getBlockAlignment(node);
        const envName = align === 'left' ? 'flushleft' : (align === 'right' ? 'flushright' : 'center');

        bodyLatex += `\\begin{${envName}}\n`;
        bodyLatex += `    {\\fontsize{16pt}{18pt}\\selectfont\\textbf{${name}}} \\\\[2.5pt]\n`;
        if (addr) {
          bodyLatex += `    {\\fontsize{9.5pt}{11.5pt}\\selectfont ${addr}} \\\\[1.5pt]\n`;
        }
        if (contactsEl) {
          let cText = deformatHtmlToLatex(contactsEl.innerHTML).trim();
          cText = cText.replace(/\s*·\s*|\s*\|\s*/g, ' $\\;\\vert\\;$ ');
          bodyLatex += `    {\\fontsize{9.5pt}{11.5pt}\\selectfont\n        ${cText}\n    }\n`;
        } else {
          bodyLatex += `    {\\fontsize{9.5pt}{11.5pt}\\selectfont\n`;
          bodyLatex += `        E-mail: \\href{mailto:shamrap@g.clemson.edu}{shamrap@g.clemson.edu} $\\;\\vert\\;$\n`;
          bodyLatex += `        \\href{https://scholar.google.com/citations?user=51wTjJAAAAAJ}{Google Scholar} $\\;\\vert\\;$\n`;
          bodyLatex += `        GitHub: \\href{https://github.com/paulshamrat}{https://github.com/paulshamrat/ColabMDA} $\\;\\vert\\;$\n`;
          bodyLatex += `        Phone: (864) 624 2575\n`;
          bodyLatex += `    }\n`;
        }
        if (hasBps) {
          bodyLatex += `    \\ifbps\n        \\\\[1.5pt]\n        {\\fontsize{9.5pt}{11.5pt}\\selectfont\\textbf{Biophysical Society (BPS) Student Member}}\n    \\fi\n`;
        }
        bodyLatex += `\\end{${envName}}\n\\vspace{2pt}\n\n`;
      } else if (tag === 'h1') {
        const h1Text = deformatHtmlToLatex(node.innerHTML).trim();
        if (h1Text) {
          bodyLatex += `{\\centering {\\LARGE \\textbf{${h1Text}}} \\\\[4pt]}\\par\\medskip\n\n`;
        }
      } else if (tag === 'h2' || cl.contains('cv-section-title')) {
        const secText = deformatHtmlToLatex(node.innerHTML).trim();
        const secAlign = node.style.textAlign || (node.dataset && node.dataset.align) || '';
        if (secAlign === 'center') {
          bodyLatex += `{\\centering \\cvsection{${secText}}\\par}\n`;
        } else if (secAlign === 'right') {
          bodyLatex += `{\\raggedleft \\cvsection{${secText}}\\par}\n`;
        } else {
          bodyLatex += `\\cvsection{${secText}}\n`;
        }
      } else if (tag === 'h3' || cl.contains('cv-subsection-title')) {
        const subText = deformatHtmlToLatex(node.innerHTML).trim();
        bodyLatex += `\\subsection*{${subText}}\n`;
      } else if (tag === 'h4') {
        const h4Text = deformatHtmlToLatex(node.innerHTML).trim();
        bodyLatex += `\\textbf{${h4Text}} \\\\[2pt]\n`;
      } else if (tag === 'hr') {
        bodyLatex += `\\noindent\\rule{\\linewidth}{0.4pt}\\\\[4pt]\n\n`;
      } else if (tag === 'blockquote') {
        bodyLatex += `\\begin{quote}\n${deformatHtmlToLatex(node.innerHTML).trim()}\n\\end{quote}\n\n`;
      } else if (cl.contains('cv-entry-row')) {
        const titleEl = node.querySelector('.cv-entry-title');
        const dateEl = node.querySelector('.cv-entry-date');
        const title = titleEl ? deformatHtmlToLatex(titleEl.innerHTML) : '';
        const date = dateEl ? deformatHtmlToLatex(dateEl.innerHTML) : '';
        bodyLatex += `${title} \\hfill ${date} \\\\\n`;
      } else if (tag === 'ul') {
        bodyLatex += `\\begin{itemize}\n`;
        node.querySelectorAll('li').forEach(li => {
          bodyLatex += `    \\item ${deformatHtmlToLatex(li.innerHTML)}\n`;
        });
        bodyLatex += `\\end{itemize}\n\n`;
      } else if (tag === 'ol') {
        bodyLatex += `\\begin{enumerate}\n`;
        node.querySelectorAll('li').forEach(li => {
          bodyLatex += `    \\item ${deformatHtmlToLatex(li.innerHTML)}\n`;
        });
        bodyLatex += `\\end{enumerate}\n\n`;
      } else if (tag === 'table' || cl.contains('cv-table')) {
        bodyLatex += `\\begin{tabular}{@{}p{1.35in}@{\\quad}p{5.3in}@{}}\n`;
        node.querySelectorAll('tr').forEach(tr => {
          let tds = tr.querySelectorAll('td');
          if (tds.length >= 2) {
            bodyLatex += `\\textbf{${tds[0].textContent.trim()}} & ${deformatHtmlToLatex(tds[1].innerHTML)} \\\\\n`;
          } else if (tds.length === 1) {
            bodyLatex += `\\multicolumn{2}{@{}l@{}}{${deformatHtmlToLatex(tds[0].innerHTML)}} \\\\\n`;
          }
        });
        bodyLatex += `\\end{tabular}\n\n`;
      } else if (tag === 'p' || tag === 'div') {
        let text = deformatHtmlToLatex(node.innerHTML).trim();
        text = text.replace(/\\(vspace|hspace)\*?(\{[^}]*\}|\d+\w+)?/g, '').trim();
        if (text && text !== 'pt' && text !== '\\vspace1pt') {
          const pAlign = node.style.textAlign || (node.dataset && node.dataset.align) || '';
          if (pAlign === 'center') {
            bodyLatex += `{\\centering ${text}\\par}\n`;
          } else if (pAlign === 'right') {
            bodyLatex += `{\\raggedleft ${text}\\par}\n`;
          } else if (pAlign === 'justify') {
            bodyLatex += `{\\justifying ${text}\\par}\n`;
          } else {
            if (cl.contains('cv-summary') || text.length > 150) {
              bodyLatex += `{\\fontsize{9.5pt}{12pt}\\selectfont\n${text}\n}\\par\n`;
            } else {
              bodyLatex += `${text} \\\\\n`;
            }
          }
          const vspace = node.dataset.vspace || (node.style.marginBottom && node.style.marginBottom !== '0px' ? node.style.marginBottom : '');
          if (vspace) {
            bodyLatex += `\\vspace{${vspace}}\n`;
          }
          bodyLatex += '\n';
        }
      }
    }
  }

  let fullDoc = '';
  if (preamble) {
    fullDoc += preamble + '\n\n';
  }
  fullDoc += '\\begin{document}\n\\thispagestyle{firstpage}\n\n';
  fullDoc += bodyLatex.trim() + '\n\n';
  fullDoc += '\\end{document}\n';

  return fullDoc;
}

function deformatHtmlToLatex(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/gi, '\\textbf{$1}');
  s = s.replace(/<b>([\s\S]*?)<\/b>/gi, '\\textbf{$1}');
  s = s.replace(/<em>([\s\S]*?)<\/em>/gi, '\\textit{$1}');
  s = s.replace(/<i>([\s\S]*?)<\/i>/gi, '\\textit{$1}');
  s = s.replace(/<u>([\s\S]*?)<\/u>/gi, '\\underline{$1}');
  s = s.replace(/<s>([\s\S]*?)<\/s>/gi, '$1');
  s = s.replace(/<strike>([\s\S]*?)<\/strike>/gi, '$1');
  s = s.replace(/<sup>([\s\S]*?)<\/sup>/gi, (m, p1) => `$^{${p1}}$`);
  s = s.replace(/<sub>([\s\S]*?)<\/sub>/gi, (m, p1) => `$_{${p1}}$`);
  s = s.replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '\\href{$1}{$2}');
  s = s.replace(/<br\s*\/?>/gi, ' \\\\\n');
  s = s.replace(/&amp;/g, '\\&');
  s = s.replace(/(^|[^\\])&/g, '$1\\&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/–/g, '--');
  s = s.replace(/—/g, '---');
  s = s.replace(/ · /g, ' $\\cdot$ ');
  s = s.replace(/·/g, ' $\\cdot$ ');
  // Use function replacement to avoid JS $1 backreference bug!
  s = s.replace(/(^|[^\\])\$(\d[\d,]*(?:\.\d+)?)/g, (match, prefix, num) => prefix + '\\$' + num);
  s = s.replace(/(^|[^\\])%/g, '$1\\%');
  return s.trim();
}

// Prevent toolbar buttons from stealing text selection focus
document.querySelectorAll('.v-btn').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
});

// LibreOffice / Word Style Visual Toolbar Actions
if (elVFormatSelect) {
  elVFormatSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'p') {
      document.execCommand('formatBlock', false, '<p>');
    } else if (val === 'h1') {
      document.execCommand('formatBlock', false, '<h1>');
    } else if (val === 'h2') {
      document.execCommand('formatBlock', false, '<h2>');
    } else if (val === 'h3') {
      document.execCommand('formatBlock', false, '<h3>');
    }
    elVisualBody.focus();
  });
}

if (elVFontSelect) {
  elVFontSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    const font = val === 'monospace' ? 'Courier New, monospace' : val === 'sans-serif' ? 'Helvetica, Arial, sans-serif' : 'Times New Roman, serif';
    document.execCommand('fontName', false, font);
    elVisualBody.focus();
  });
}

if (elVBtnBold) {
  elVBtnBold.addEventListener('click', () => {
    document.execCommand('bold', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnItalic) {
  elVBtnItalic.addEventListener('click', () => {
    document.execCommand('italic', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnUnderline) {
  elVBtnUnderline.addEventListener('click', () => {
    document.execCommand('underline', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnStrike) {
  elVBtnStrike.addEventListener('click', () => {
    document.execCommand('strikeThrough', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnSup) {
  elVBtnSup.addEventListener('click', () => {
    document.execCommand('superscript', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnSub) {
  elVBtnSub.addEventListener('click', () => {
    document.execCommand('subscript', false, null);
    elVisualBody.focus();
  });
}

function applyVisualAlignment(align) {
  const cmd = align === 'center' ? 'justifyCenter' : (align === 'right' ? 'justifyRight' : 'justifyLeft');
  document.execCommand(cmd, false, null);

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    let node = sel.anchorNode;
    while (node && node !== elVisualBody) {
      if (node.classList && node.classList.contains('cv-header-block')) {
        node.style.textAlign = align;
        node.dataset.align = align;
        node.querySelectorAll('.cv-name, .cv-address, .cv-contacts, h1, div').forEach(ch => {
          ch.style.textAlign = align;
        });
        break;
      }
      if (['P', 'H1', 'H2', 'H3', 'H4', 'DIV'].includes(node.tagName)) {
        node.style.textAlign = align;
        node.dataset.align = align;
        break;
      }
      node = node.parentNode;
    }
  }
  elVisualBody.focus();
  scheduleAutoCompile();
}

if (elVBtnAlignLeft) {
  elVBtnAlignLeft.addEventListener('click', () => applyVisualAlignment('left'));
}

if (elVBtnAlignCenter) {
  elVBtnAlignCenter.addEventListener('click', () => applyVisualAlignment('center'));
}

if (elVBtnAlignRight) {
  elVBtnAlignRight.addEventListener('click', () => applyVisualAlignment('right'));
}

if (elVBtnUndo) {
  elVBtnUndo.addEventListener('click', () => {
    document.execCommand('undo', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnRedo) {
  elVBtnRedo.addEventListener('click', () => {
    document.execCommand('redo', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnBullet) {
  elVBtnBullet.addEventListener('click', () => {
    document.execCommand('insertUnorderedList', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnNumber) {
  elVBtnNumber.addEventListener('click', () => {
    document.execCommand('insertOrderedList', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnOutdent) {
  elVBtnOutdent.addEventListener('click', () => {
    document.execCommand('outdent', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnIndent) {
  elVBtnIndent.addEventListener('click', () => {
    document.execCommand('indent', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnHr) {
  elVBtnHr.addEventListener('click', () => {
    document.execCommand('insertHorizontalRule', false, null);
    elVisualBody.focus();
  });
}

if (elVBtnLink) {
  elVBtnLink.addEventListener('click', () => {
    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';
    const url = prompt('Enter link URL (e.g. https://... or mailto:...):', 'https://');
    if (url && url !== 'https://') {
      const label = selectedText || prompt('Enter link text:', url) || url;
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(label)}</a>`);
    }
    elVisualBody.focus();
  });
}

if (elVBtnInsertEntry) {
  elVBtnInsertEntry.addEventListener('click', () => {
    const entryHtml = `<div class="cv-entry-row"><span class="cv-entry-title"><strong>New Role / Degree</strong>, Organization, Location</span><span class="cv-entry-date">Month Year – Month Year</span></div><p class="cv-subline">Key research, project, or training description...</p>`;
    document.execCommand('insertHTML', false, entryHtml);
    elVisualBody.focus();
  });
}

if (elVBtnClear) {
  elVBtnClear.addEventListener('click', () => {
    document.execCommand('removeFormat', false, null);
    elVisualBody.focus();
  });
}

// Visual Canvas Zoom Controls & Wheel Zoom (Ctrl+Wheel)
let visualZoom = 1.0;
const elVisualZoomLevel = document.getElementById('visual-zoom-level');
const elVBtnZoomIn = document.getElementById('v-btn-zoom-in');
const elVBtnZoomOut = document.getElementById('v-btn-zoom-out');
const elVisualCanvasWrapper = document.querySelector('.visual-canvas-wrapper');

function setVisualZoom(val) {
  visualZoom = Math.min(2.0, Math.max(0.5, Math.round(val * 100) / 100));
  if (elVisualBody) {
    elVisualBody.style.transform = `scale(${visualZoom})`;
    elVisualBody.style.transformOrigin = 'top center';
    if (elVisualCanvasWrapper) {
      elVisualCanvasWrapper.style.overflowX = visualZoom > 1.0 ? 'auto' : 'hidden';
    }
  }
  if (elVisualZoomLevel) {
    elVisualZoomLevel.textContent = `${Math.round(visualZoom * 100)}%`;
  }
  localStorage.setItem('localleaf-visual-zoom', visualZoom);
}

if (elVBtnZoomIn) {
  elVBtnZoomIn.addEventListener('click', () => setVisualZoom(visualZoom + 0.1));
}

if (elVBtnZoomOut) {
  elVBtnZoomOut.addEventListener('click', () => setVisualZoom(visualZoom - 0.1));
}

if (elVisualZoomLevel) {
  elVisualZoomLevel.addEventListener('click', () => setVisualZoom(1.0));
}

if (elVisualCanvasWrapper) {
  elVisualCanvasWrapper.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      setVisualZoom(visualZoom + delta);
    }
  }, { passive: false });
}

const savedVisualZoom = parseFloat(localStorage.getItem('localleaf-visual-zoom'));
if (!isNaN(savedVisualZoom) && savedVisualZoom >= 0.5 && savedVisualZoom <= 2.0) {
  setVisualZoom(savedVisualZoom);
}

function getActiveVisualBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!elVisualBody || !elVisualBody.contains(node)) return null;
  let block = node;
  while (block && block !== elVisualBody && !['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'TR', 'DIV', 'TABLE'].includes(block.tagName)) {
    block = block.parentElement;
  }
  return block || node;
}

function applyLineSpacing(val) {
  const block = getActiveVisualBlock();
  if (block && block !== elVisualBody) {
    block.style.lineHeight = val;
  } else if (elVisualBody) {
    elVisualBody.style.lineHeight = val;
  }
  if (elVisualBody) elVisualBody.focus();
}

function applySpacingPoints(val) {
  const block = getActiveVisualBlock();
  if (block && block !== elVisualBody) {
    block.style.marginBottom = val;
    block.dataset.vspace = val;
  }
  if (elVisualBody) elVisualBody.focus();
}

if (elVSizeSelect) {
  elVSizeSelect.addEventListener('change', (e) => {
    const size = e.target.value;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = size;
      span.appendChild(range.extractContents());
      range.insertNode(span);
    } else {
      const block = getActiveVisualBlock();
      if (block) block.style.fontSize = size;
    }
    if (elVisualBody) elVisualBody.focus();
  });
}

if (elVSpacingSelect) {
  elVSpacingSelect.addEventListener('change', (e) => {
    applyLineSpacing(e.target.value);
  });
}

if (elVPointsSelect) {
  elVPointsSelect.addEventListener('change', (e) => {
    applySpacingPoints(e.target.value);
  });
}

// Smooth Visual Editing & ContentEditable Enter key handling
document.execCommand('defaultParagraphSeparator', false, 'p');

elVisualBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const anchor = sel.anchorNode;
      const parentEl = anchor ? (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor) : null;
      if (parentEl && (parentEl.closest('li') || parentEl.closest('td') || parentEl.closest('th'))) {
        return; // Allow list and table cells normal Enter behavior
      }
    }
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }
});

let visualAutoSaveTimer = null;
elVisualBody.addEventListener('input', () => {
  updateVisualSelectionSnippet();
  if (visualAutoSaveTimer) clearTimeout(visualAutoSaveTimer);
  visualAutoSaveTimer = setTimeout(() => {
    saveContentOnly();
  }, 1200);
});

elVisualBody.addEventListener('mouseup', updateVisualSelectionSnippet);
elVisualBody.addEventListener('keyup', updateVisualSelectionSnippet);
elVisualBody.addEventListener('click', updateVisualSelectionSnippet);

// File info and content loading
async function loadFile() {
  try {
    setStatus('ready', 'Loading...');
    const infoRes = await fetch('/api/file_info');
    currentFileInfo = await infoRes.json();

    elActiveFilename.textContent = currentFileInfo.file_name;
    elActiveFilename.title = currentFileInfo.file_path;

    const contentRes = await fetch('/api/get_content');
    const contentData = await contentRes.json();

    if (editor) {
      editor.setValue(contentData.content);
    }

    renderLatexToVisual(contentData.content);

    if (currentFileInfo.pdf_exists) {
      await renderPdfViewer();
    }

    setStatus('ready', 'Ready');
  } catch (err) {
    console.error('Failed to load file:', err);
    setStatus('error', 'Error loading file');
  }
}

function getCurrentContent() {
  if (currentMode === 'visual') {
    const latex = serializeVisualToLatex();
    if (editor) editor.setValue(latex);
    return latex;
  } else {
    return editor ? editor.getValue() : '';
  }
}

let userDismissedLogs = false;

// Compile
async function triggerCompile() {
  if (isCompiling) return;

  isCompiling = true;
  setStatus('compiling', 'Compiling...');
  elBtnRecompile.disabled = true;

  const content = getCurrentContent();
  const engine = elEngineSelect.value;

  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content, engine: engine })
    });

    const data = await res.json();
    isCompiling = false;
    elBtnRecompile.disabled = false;

    elRawLogText.textContent = data.log || 'No log output.';

    if (data.success) {
      setStatus('success', `Compiled in ${data.duration}`);
      await renderPdfViewer();
      renderIssues(data.errors, data.warnings);

      if (data.errors.length === 0) {
        elLogDrawer.classList.add('collapsed');
        elLogDrawer.style.display = 'none';
      }
    } else {
      setStatus('error', `Errors (${data.errors.length})`);
      renderIssues(data.errors, data.warnings);
      if (!userDismissedLogs) {
        elLogDrawer.style.display = 'flex';
        elLogDrawer.classList.remove('collapsed');
        switchLogTab('tab-errors');
      }
    }
  } catch (err) {
    isCompiling = false;
    elBtnRecompile.disabled = false;
    setStatus('error', 'Compile failed');
    console.error('Compile error:', err);
  }
}

async function saveContentOnly() {
  const content = getCurrentContent();
  try {
    await fetch('/api/save_content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    setStatus('ready', 'Saved');
    setTimeout(() => setStatus('ready', 'Ready'), 1500);
  } catch (err) {
    console.error('Failed to save:', err);
    setStatus('error', 'Save error');
  }
}

function setStatus(type, text) {
  elStatusBadge.className = `status-badge ${type}`;
  elStatusText.textContent = text;
}

function renderIssues(errors, warnings) {
  elErrorsList.innerHTML = '';
  const total = (errors ? errors.length : 0) + (warnings ? warnings.length : 0);
  elErrorCountBadge.textContent = total;

  if (total === 0) {
    elErrorsList.innerHTML = '<div class="empty-log-msg">No compilation issues detected. Everything looks clean!</div>';
    return;
  }

  if (errors && errors.length > 0) {
    errors.forEach(err => {
      const card = document.createElement('div');
      card.className = 'error-card';
      card.innerHTML = `
        <div class="error-info">
          <div class="error-title">Line ${err.line}: ${escapeHtml(err.message)}</div>
          ${err.snippet ? `<div class="error-snippet">${escapeHtml(err.snippet)}</div>` : ''}
        </div>
        <button class="btn-jump" data-line="${err.line}">Jump to Line ${err.line}</button>
      `;
      elErrorsList.appendChild(card);
    });
  }

  if (warnings && warnings.length > 0) {
    warnings.forEach(warn => {
      const card = document.createElement('div');
      card.className = 'error-card warning';
      card.innerHTML = `
        <div class="error-info">
          <div class="error-title">Line ${warn.line}: ${escapeHtml(warn.message)}</div>
        </div>
        <button class="btn-jump" data-line="${warn.line}">Jump to Line ${warn.line}</button>
      `;
      elErrorsList.appendChild(card);
    });
  }

  document.querySelectorAll('.btn-jump').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const line = parseInt(e.target.getAttribute('data-line'), 10);
      setEditorMode('code');
      if (editor && line > 0) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      }
    });
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function switchLogTab(tabId) {
  document.querySelectorAll('.log-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

document.querySelectorAll('.log-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchLogTab(btn.getAttribute('data-tab'));
  });
});

elBtnToggleLog.addEventListener('click', (e) => {
  e.preventDefault();
  if (elLogDrawer.classList.contains('collapsed') || elLogDrawer.style.display === 'none') {
    elLogDrawer.style.display = 'flex';
    elLogDrawer.classList.remove('collapsed');
    userDismissedLogs = false;
  } else {
    elLogDrawer.classList.add('collapsed');
    elLogDrawer.style.display = 'none';
  }
});

function dismissLogDrawer() {
  elLogDrawer.classList.add('collapsed');
  elLogDrawer.style.display = 'none';
  userDismissedLogs = true;
}

if (elBtnCloseLog) {
  elBtnCloseLog.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissLogDrawer();
  });
}

if (elBtnDismissLogs) {
  elBtnDismissLogs.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissLogDrawer();
  });
}

elBtnRecompile.addEventListener('click', () => {
  userDismissedLogs = false;
  triggerCompile();
});

elBtnDownloadPdf.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/api/pdf';
  link.download = currentFileInfo ? currentFileInfo.file_name.replace(/\.tex$/, '.pdf') : 'document.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

async function exportDocx() {
  setStatus('compiling', 'Exporting DOCX...');
  const content = getCurrentContent();
  const lineSpacing = elVSpacingSelect ? parseFloat(elVSpacingSelect.value) : 1.15;
  const pointsVal = elVPointsSelect ? parseFloat(elVPointsSelect.value) : 2.0;

  try {
    const res = await fetch('/api/export_docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content,
        line_spacing: lineSpacing,
        space_after_pt: pointsVal
      })
    });
    const data = await res.json();
    if (data.success) {
      const sizeKb = (data.size_bytes / 1024).toFixed(1);
      setStatus('success', `Exported DOCX (${sizeKb} KB)`);
      const link = document.createElement('a');
      link.href = '/api/docx?t=' + Date.now();
      link.download = data.file_name || 'document.docx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      setStatus('error', 'DOCX export failed');
      alert('DOCX Export error: ' + (data.error || data.message));
    }
  } catch (err) {
    console.error('Failed to export DOCX:', err);
    setStatus('error', 'DOCX export failed');
  }
}

if (elBtnExportDocx) {
  elBtnExportDocx.addEventListener('click', () => exportDocx());
}

// LibreOffice Style Menubar Interactions
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) {
      item.classList.add('open');
    }
  });

  item.addEventListener('mouseenter', () => {
    const anyOpen = document.querySelector('.menu-item.open');
    if (anyOpen && anyOpen !== item) {
      anyOpen.classList.remove('open');
      item.classList.add('open');
    }
  });
});

document.addEventListener('click', () => {
  document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
});

const bindMenuClick = (id, fn) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
      fn();
    });
  }
};

bindMenuClick('m-save', () => {
  if (elAutoCompileChk && elAutoCompileChk.checked) triggerCompile();
  else saveContentOnly();
});
bindMenuClick('m-recompile', () => triggerCompile());
bindMenuClick('m-switch-file', () => elFileSelectorBtn.click());
bindMenuClick('m-export-pdf', () => elBtnDownloadPdf.click());
bindMenuClick('m-export-docx', () => exportDocx());

bindMenuClick('m-undo', () => { document.execCommand('undo', false, null); if (elVisualBody) elVisualBody.focus(); });
bindMenuClick('m-redo', () => { document.execCommand('redo', false, null); if (elVisualBody) elVisualBody.focus(); });
bindMenuClick('m-select-all', () => { document.execCommand('selectAll', false, null); });
bindMenuClick('m-clear-format', () => { document.execCommand('removeFormat', false, null); if (elVisualBody) elVisualBody.focus(); });

bindMenuClick('m-view-visual', () => setEditorMode('visual'));
bindMenuClick('m-view-code', () => setEditorMode('code'));
bindMenuClick('m-view-word-wrap', () => {
  if (currentMode !== 'code') setEditorMode('code');
  if (editor) {
    const currentWrap = editor.getRawOptions ? editor.getRawOptions().wordWrap : editor.getOption(monaco.editor.EditorOption.wordWrap);
    const nextWrap = (currentWrap === 'on') ? 'off' : 'on';
    editor.updateOptions({ wordWrap: nextWrap });
    setStatus('ready', `Word wrap: ${nextWrap}`);
    setTimeout(() => setStatus('ready', 'Ready'), 1200);
  }
});
bindMenuClick('m-view-toggle-pdf', () => updatePdfVisibility(!isPdfHidden));
bindMenuClick('m-view-toggle-log', () => elBtnToggleLog.click());
bindMenuClick('m-view-zoom-visual-in', () => setVisualZoom(visualZoom + 0.1));
bindMenuClick('m-view-zoom-visual-out', () => setVisualZoom(visualZoom - 0.1));
bindMenuClick('m-view-zoom-in', () => elPdfZoomIn.click());
bindMenuClick('m-view-zoom-out', () => elPdfZoomOut.click());
bindMenuClick('m-view-zoom-reset', () => elPdfZoomReset.click());

bindMenuClick('m-ins-entry', () => elVBtnInsertEntry.click());
bindMenuClick('m-ins-table', () => {
  const tableHtml = `<table class="cv-table"><tr><td class="col-date">2024 – Present</td><td class="col-desc"><strong>Title / Position</strong>, Institution, City, Country</td></tr></table><p></p>`;
  document.execCommand('insertHTML', false, tableHtml);
  if (elVisualBody) elVisualBody.focus();
});
bindMenuClick('m-ins-bullet', () => elVBtnBullet.click());
bindMenuClick('m-ins-number', () => elVBtnNumber.click());
bindMenuClick('m-ins-hr', () => elVBtnHr.click());
bindMenuClick('m-ins-link', () => elVBtnLink.click());

bindMenuClick('m-fmt-bold', () => elVBtnBold.click());
bindMenuClick('m-fmt-italic', () => elVBtnItalic.click());
bindMenuClick('m-fmt-underline', () => elVBtnUnderline.click());
bindMenuClick('m-fmt-strike', () => elVBtnStrike.click());
bindMenuClick('m-fmt-sup', () => elVBtnSup.click());
bindMenuClick('m-fmt-sub', () => elVBtnSub.click());

document.querySelectorAll('[data-action="insert-vspace"]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    const val = el.getAttribute('data-val');
    applySpacingPoints(val);
    if (elVPointsSelect) elVPointsSelect.value = val;
  });
});

document.querySelectorAll('.sym-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    const sym = btn.getAttribute('data-sym') || btn.textContent.trim();
    document.execCommand('insertText', false, sym);
    if (elVisualBody) elVisualBody.focus();
  });
});

document.querySelectorAll('[data-action="set-line-spacing"]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    const val = el.getAttribute('data-val');
    applyLineSpacing(val);
    if (elVSpacingSelect) elVSpacingSelect.value = val;
  });
});

document.querySelectorAll('[data-action="set-points"]').forEach(el => {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.menu-item.open').forEach(m => m.classList.remove('open'));
    const val = el.getAttribute('data-val');
    applySpacingPoints(val);
    if (elVPointsSelect) elVPointsSelect.value = val;
  });
});

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
    elThemeIcon.textContent = '🌙';
    if (editor) monaco.editor.setTheme('vs-dark');
  } else {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    elThemeIcon.textContent = '☀️';
    if (editor) monaco.editor.setTheme('vs');
  }
  localStorage.setItem('localleaf-theme', theme);
}

elBtnTheme.addEventListener('click', () => {
  const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

// Resizable Splitter
let isDragging = false;

elSplitter.addEventListener('mousedown', (e) => {
  isDragging = true;
  elSplitter.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const containerRect = document.getElementById('workspace').getBoundingClientRect();
  const offset = e.clientX - containerRect.left;
  const minWidth = 250;
  const maxWidth = containerRect.width - minWidth;

  if (offset >= minWidth && offset <= maxWidth) {
    const leftPercent = (offset / containerRect.width) * 100;
    elEditorPane.style.flex = `0 0 ${leftPercent}%`;
    elPdfPane.style.flex = `0 0 ${100 - leftPercent}%`;
    if (editor) editor.layout();
  }
});

window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    elSplitter.classList.remove('dragging');
    document.body.style.cursor = 'default';
    if (editor) editor.layout();
  }
});

// File Switcher Modal
elFileSelectorBtn.addEventListener('click', async () => {
  elFileModal.classList.remove('hidden');
  elFileList.innerHTML = '<div class="file-list-loading">Scanning workspace for .tex files...</div>';

  try {
    const res = await fetch('/api/browse');
    const data = await res.json();
    renderFileList(data.files || []);
  } catch (err) {
    elFileList.innerHTML = '<div class="empty-log-msg">Failed to scan files.</div>';
  }
});

elBtnCloseModal.addEventListener('click', () => {
  elFileModal.classList.add('hidden');
});

elFileModal.addEventListener('click', (e) => {
  if (e.target === elFileModal) {
    elFileModal.classList.add('hidden');
  }
});

function renderFileList(files) {
  if (files.length === 0) {
    elFileList.innerHTML = '<div class="empty-log-msg">No .tex files found.</div>';
    return;
  }

  elFileList.innerHTML = '';
  files.forEach(f => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-item-name">${escapeHtml(f.name)}</div>
      <div class="file-item-path">${escapeHtml(f.rel_path)}</div>
    `;
    item.addEventListener('click', async () => {
      elFileModal.classList.add('hidden');
      await switchFile(f.path);
    });
    elFileList.appendChild(item);
  });
}

async function switchFile(filePath) {
  try {
    setStatus('compiling', 'Switching file...');
    const res = await fetch('/api/switch_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });
    const data = await res.json();
    if (data.success) {
      await loadFile();
    }
  } catch (err) {
    console.error('Failed to switch file:', err);
  }
}
