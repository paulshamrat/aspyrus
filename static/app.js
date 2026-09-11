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

// Visual Toolbar Buttons
const elVBtnUndo = document.getElementById('v-btn-undo');
const elVBtnRedo = document.getElementById('v-btn-redo');
const elVBtnBold = document.getElementById('v-btn-bold');
const elVBtnItalic = document.getElementById('v-btn-italic');
const elVBtnH2 = document.getElementById('v-btn-h2');
const elVBtnBullet = document.getElementById('v-btn-bullet');
const elVBtnNumber = document.getElementById('v-btn-number');


// Toggle PDF Preview Visibility (Hide / Show)
const elBtnTogglePdf = document.getElementById('btn-toggle-pdf');
const elBtnTogglePdfText = document.getElementById('btn-toggle-pdf-text');
const elWorkspace = document.getElementById('workspace');

let isPdfHidden = localStorage.getItem('localleaf-hide-pdf') === 'true';

function updatePdfVisibility(hide) {
  isPdfHidden = hide;
  if (isPdfHidden) {
    elWorkspace.classList.add('hide-pdf');
    elBtnTogglePdfText.textContent = 'Show PDF';
    elBtnTogglePdf.classList.add('active');
  } else {
    elWorkspace.classList.remove('hide-pdf');
    elBtnTogglePdfText.textContent = 'Hide PDF';
    elBtnTogglePdf.classList.remove('active');
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
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (elAutoCompileChk.checked) {
        triggerCompile();
      } else {
        saveContentOnly();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerCompile();
    }
  });

  // Load initial active file
  loadFile();
});

// Switch Between Code and Visual Modes
function setEditorMode(mode) {
  if (currentMode === mode) return;

  if (mode === 'code') {
    const latexCode = serializeVisualToLatex();
    if (editor) {
      editor.setValue(latexCode);
    }
    elEditorContainer.classList.remove('hidden');
    elVisualContainer.classList.add('hidden');
    elBtnModeCode.classList.add('active');
    elBtnModeVisual.classList.remove('active');
    elVisualToolbar.classList.add('disabled');
    if (editor) editor.layout();
  } else {
    const latexCode = editor ? editor.getValue() : '';
    renderLatexToVisual(latexCode);
    elEditorContainer.classList.add('hidden');
    elVisualContainer.classList.remove('hidden');
    elBtnModeVisual.classList.add('active');
    elBtnModeCode.classList.remove('active');
    elVisualToolbar.classList.remove('disabled');
  }

  currentMode = mode;
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

// PDF.js Canvas Multi-Page Rendering (Works 100% inside VS Code Webview)
async function renderPdfViewer() {
  elPdfPagesContainer.innerHTML = '<div class="pdf-loading-msg">Rendering PDF...</div>';
  const pdfUrl = `/api/pdf?t=${Date.now()}`;

  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    currentPdfDoc = await loadingTask.promise;
    elPdfPagesContainer.innerHTML = '';

    const containerWidth = elPdfPagesContainer.clientWidth - 40; // padding margin
    const targetWidth = Math.max(300, Math.min(containerWidth, 800));

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
    elPdfPagesContainer.innerHTML = `<div class="pdf-loading-msg">Could not load PDF: ${err.message}</div>`;
  }
}

// Clean LaTeX to Visual Parser
function renderLatexToVisual(fullLatex) {
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

  elVisualBody.innerHTML = parseLatexToCleanHtml(body.trim());
}

function parseLatexToCleanHtml(latex) {
  let lines = latex.split('\n');
  let html = '';
  let inItemize = false;
  let inEnumerate = false;
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // Skip comment lines entirely (hiding clutter)
    if (!line || line.startsWith('%')) {
      continue;
    }

    // Skip setup commands
    if (line.startsWith('\\thispagestyle') || line.startsWith('\\setlength') || line.startsWith('\\renewcommand')) {
      continue;
    }

    // Handle Centered Header Block
    if (line.includes('\\begin{center}')) {
      let headerBlockHtml = '<div class="cv-header-block">';
      i++;
      while (i < lines.length && !lines[i].includes('\\end{center}')) {
        let hline = lines[i].trim();
        if (hline && !hline.startsWith('%')) {
          // Extract Name
          let nameMatch = hline.match(/\\textbf\{([^{}]+)\}/);
          if (nameMatch && hline.includes('16pt')) {
            headerBlockHtml += `<div class="cv-name">${escapeHtml(nameMatch[1])}</div>`;
          } else if (hline.includes('Google Scholar') || hline.includes('E-mail') || hline.includes('GitHub')) {
            let contacts = hline
              .replace(/\\href\{([^}]+)\}\{([^}]+)\}/g, '<a href="$1" target="_blank">$2</a>')
              .replace(/\\href\{([^}]+)\}/g, '<a href="$1" target="_blank">$1</a>')
              .replace(/\\;/g, ' ')
              .replace(/\\vert/g, ' | ')
              .replace(/\$/g, '')
              .replace(/\\\\.*$/, '')
              .replace(/\{\\fontsize\{[^}]+\}\{[^}]+\}\\selectfont/g, '')
              .replace(/\}/g, '');
            headerBlockHtml += `<div class="cv-contacts">${contacts}</div>`;
          } else if (hline.includes('Biophysical Society') || hline.includes('Student Member')) {
            headerBlockHtml += `<div class="cv-tag">Biophysical Society (BPS) Student Member</div>`;
          } else if (!hline.startsWith('\\if') && !hline.startsWith('\\fi')) {
            let cleanLine = cleanLatexTypography(hline);
            if (cleanLine) {
              headerBlockHtml += `<div class="cv-address">${cleanLine}</div>`;
            }
          }
        }
        i++;
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
      html += `<h2 class="cv-section-title" data-raw="${escapeHtml(line)}">${escapeHtml(sectionMatch[1])}</h2>`;
      continue;
    }

    // Handle Tabular Environment
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
          html += `<tr><td>${cleanLatexTypography(cells[0])}</td><td>${cleanLatexTypography(cells.slice(1).join('&'))}</td></tr>`;
        } else {
          html += `<tr><td colspan="2">${cleanLatexTypography(row)}</td></tr>`;
        }
      });
      html += '</table>';
      continue;
    }
    if (inTable) {
      let rowText = line.replace(/\\\\.*$/, '').trim();
      if (rowText && !rowText.startsWith('\\if') && !rowText.startsWith('\\fi')) {
        tableRows.push(rowText);
      }
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

    // Handle Title with Date Row: \textbf{Title} \hfill \textbf{Date}
    if (line.includes('\\hfill')) {
      let parts = line.split('\\hfill');
      let titlePart = cleanLatexTypography(parts[0]);
      let datePart = cleanLatexTypography(parts[1]);
      html += `<div class="cv-entry-row"><span class="cv-entry-title">${titlePart}</span><span class="cv-entry-date">${datePart}</span></div>`;
      continue;
    }

    // Normal formatted line
    let clean = cleanLatexTypography(line);
    if (clean && !clean.startsWith('\\if') && !clean.startsWith('\\fi')) {
      html += `<p class="cv-summary">${clean}</p>`;
    }
  }

  if (inItemize) html += '</ul>';
  if (inEnumerate) html += '</ol>';

  return html || '<p>Start typing your CV...</p>';
}

function cleanLatexTypography(str) {
  let s = str;
  // Strip font size wrappers
  s = s.replace(/\{\\fontsize\{[^}]+\}\{[^}]+\}\\selectfont\s*/g, '');
  s = s.replace(/\\par\b/g, '');
  // Clean bracket spacing like [2pt], [1.5pt]
  s = s.replace(/\[\d+(\.\d+)?pt\]/g, '');
  // Line breaks \\
  s = s.replace(/\\\\/g, ' ');
  // Math dollar signs and vert
  s = s.replace(/\$\s*\\;?\\vert\\;?\s*\$/g, ' | ');
  s = s.replace(/\$/g, '');
  // Convert \textbf{...} -> <strong>...</strong>
  s = s.replace(/\\textbf\{([^{}]+)\}/g, '<strong>$1</strong>');
  // Convert \textit{...} -> <em>...</em>
  s = s.replace(/\\textit\{([^{}]+)\}/g, '<em>$1</em>');
  // Convert \href{url}{text} -> <a href="url">text</a>
  s = s.replace(/\\href\{([^{}]+)\}\{([^{}]+)\}/g, '<a href="$1" target="_blank">$2</a>');
  // Escaped characters: \&, \%, \$
  s = s.replace(/\\&/g, '&amp;');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/--/g, '–');
  s = s.replace(/---/g, '—');
  s = s.replace(/\\dots/g, '…');
  s = s.replace(/\{|\}/g, ''); // strip dangling braces
  return s.trim();
}

// Serialize Visual DOM back to valid LaTeX
function serializeVisualToLatex() {
  const preamble = elPreambleTextarea.value.trim();
  let bodyLatex = '';

  const nodes = elVisualBody.childNodes;
  for (let node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const cl = node.classList;
      const tag = node.tagName.toLowerCase();

      if (cl.contains('cv-header-block')) {
        const name = node.querySelector('.cv-name') ? node.querySelector('.cv-name').textContent.trim() : 'Shamrat Kumar Paul';
        const addr = node.querySelector('.cv-address') ? node.querySelector('.cv-address').textContent.trim() : '';
        bodyLatex += `\\begin{center}\n`;
        bodyLatex += `    {\\fontsize{16pt}{18pt}\\selectfont\\textbf{${name}}} \\\\[2.5pt]\n`;
        if (addr) {
          bodyLatex += `    {\\fontsize{9.5pt}{11.5pt}\\selectfont ${addr}} \\\\[1.5pt]\n`;
        }
        bodyLatex += `    {\\fontsize{9.5pt}{11.5pt}\\selectfont\n`;
        bodyLatex += `        E-mail: \\href{mailto:shamrap@g.clemson.edu}{shamrap@g.clemson.edu} $\\;\\vert\\;$\n`;
        bodyLatex += `        \\href{https://scholar.google.com/citations?user=51wTjJAAAAAJ}{Google Scholar} $\\;\\vert\\;$\n`;
        bodyLatex += `        GitHub: \\href{https://github.com/paulshamrat}{https://github.com/paulshamrat/ColabMDA} $\\;\\vert\\;$\n`;
        bodyLatex += `        Phone: (864) 624 2575\n    }\n`;
        bodyLatex += `    \\ifbps\n        \\\\[1.5pt]\n        {\\fontsize{9.5pt}{11.5pt}\\selectfont\\textbf{Biophysical Society (BPS) Student Member}}\n    \\fi\n`;
        bodyLatex += `\\end{center}\n\\vspace{1pt}\n\n`;
      } else if (tag === 'h2' || cl.contains('cv-section-title')) {
        bodyLatex += `\\cvsection{${node.textContent.trim()}}\n`;
      } else if (cl.contains('cv-entry-row')) {
        const title = node.querySelector('.cv-entry-title') ? node.querySelector('.cv-entry-title').textContent.trim() : '';
        const date = node.querySelector('.cv-entry-date') ? node.querySelector('.cv-entry-date').textContent.trim() : '';
        bodyLatex += `\\textbf{${title}} \\hfill \\textbf{${date}} \\\\\n`;
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
          }
        });
        bodyLatex += `\\end{tabular}\n\n`;
      } else if (tag === 'p') {
        const text = deformatHtmlToLatex(node.innerHTML).trim();
        if (text) {
          bodyLatex += `${text}\n\n`;
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
  let s = html;
  s = s.replace(/<strong>(.*?)<\/strong>/gi, '\\textbf{$1}');
  s = s.replace(/<b>(.*?)<\/b>/gi, '\\textbf{$1}');
  s = s.replace(/<em>(.*?)<\/em>/gi, '\\textit{$1}');
  s = s.replace(/<i>(.*?)<\/i>/gi, '\\textit{$1}');
  s = s.replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '\\href{$1}{$2}');
  s = s.replace(/&amp;/g, '\\&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/–/g, '--');
  s = s.replace(/—/g, '---');
  return s.trim();
}

// Visual Toolbar Actions
elVBtnBold.addEventListener('click', () => {
  document.execCommand('bold', false, null);
  elVisualBody.focus();
});

elVBtnItalic.addEventListener('click', () => {
  document.execCommand('italic', false, null);
  elVisualBody.focus();
});

elVBtnUndo.addEventListener('click', () => {
  document.execCommand('undo', false, null);
  elVisualBody.focus();
});

elVBtnRedo.addEventListener('click', () => {
  document.execCommand('redo', false, null);
  elVisualBody.focus();
});

elVBtnBullet.addEventListener('click', () => {
  document.execCommand('insertUnorderedList', false, null);
  elVisualBody.focus();
});

elVBtnNumber.addEventListener('click', () => {
  document.execCommand('insertOrderedList', false, null);
  elVisualBody.focus();
});

elVBtnH2.addEventListener('click', () => {
  document.execCommand('formatBlock', false, '<h2>');
  elVisualBody.focus();
});

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
      }
    } else {
      setStatus('error', `Errors (${data.errors.length})`);
      renderIssues(data.errors, data.warnings);
      elLogDrawer.classList.remove('collapsed');
      switchLogTab('tab-errors');
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

elBtnToggleLog.addEventListener('click', () => {
  elLogDrawer.classList.toggle('collapsed');
});

elBtnCloseLog.addEventListener('click', () => {
  elLogDrawer.classList.add('collapsed');
});

elBtnRecompile.addEventListener('click', triggerCompile);

elBtnDownloadPdf.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/api/pdf';
  link.download = currentFileInfo ? currentFileInfo.file_name.replace(/\.tex$/, '.pdf') : 'document.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
