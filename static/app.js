// LocalLeaf - Overleaf-Style Local LaTeX Editor Client

let editor = null;
let currentFileInfo = null;
let isCompiling = false;
let currentMode = 'visual'; // 'code' or 'visual'
let currentPreamble = '';

// DOM Elements
const elActiveFilename = document.getElementById('active-filename');
const elFileSelectorBtn = document.getElementById('file-selector-btn');
const elBtnRecompile = document.getElementById('btn-recompile');
const elBtnFirstCompile = document.getElementById('btn-first-compile');
const elEngineSelect = document.getElementById('engine-select');
const elStatusBadge = document.getElementById('status-badge');
const elStatusText = document.getElementById('status-text');
const elAutoCompileChk = document.getElementById('auto-compile-chk');
const elPdfFrame = document.getElementById('pdf-frame');
const elPdfPlaceholder = document.getElementById('pdf-placeholder');
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
const elPreambleCard = document.getElementById('preamble-card');
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

// Setup Monaco AMD loader
require.config({ paths: { 'vs': '/monaco/vs' } });

require(['vs/editor/editor.main'], function () {
  // Register LaTeX language & monarch tokens for syntax highlighting
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

  // Keybindings in Monaco
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

  // Global keybinding for Visual Mode (Ctrl+S / Ctrl+Enter)
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

// Switch Between Code and Visual Modes (Overleaf Style)
function setEditorMode(mode) {
  if (currentMode === mode) return;

  if (mode === 'code') {
    // Sync from Visual to Code
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
    // Sync from Code to Visual
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

// Parse LaTeX to Visual DOM
function renderLatexToVisual(fullLatex) {
  // Split at \begin{document}
  const beginDocIdx = fullLatex.indexOf('\\begin{document}');
  let preamble = '';
  let body = fullLatex;

  if (beginDocIdx !== -1) {
    preamble = fullLatex.substring(0, beginDocIdx).trim();
    body = fullLatex.substring(beginDocIdx + '\\begin{document}'.length);
  }

  // Strip trailing \end{document}
  const endDocIdx = body.lastIndexOf('\\end{document}');
  if (endDocIdx !== -1) {
    body = body.substring(0, endDocIdx);
  }

  currentPreamble = preamble;
  elPreambleTextarea.value = preamble;

  // Convert LaTeX body into visual HTML
  elVisualBody.innerHTML = convertLatexBodyToHtml(body.trim());
}

// Convert Body string to Visual HTML
function convertLatexBodyToHtml(latex) {
  const lines = latex.split('\n');
  let html = '';
  let inItemize = false;
  let inEnumerate = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (!line) {
      continue;
    }

    // List environments
    if (line.startsWith('\\begin{itemize}')) {
      inItemize = true;
      html += '<ul>';
      continue;
    }
    if (line.startsWith('\\end{itemize}')) {
      inItemize = false;
      html += '</ul>';
      continue;
    }
    if (line.startsWith('\\begin{enumerate}')) {
      inEnumerate = true;
      html += '<ol>';
      continue;
    }
    if (line.startsWith('\\end{enumerate}')) {
      inEnumerate = false;
      html += '</ol>';
      continue;
    }

    // List items
    if (line.startsWith('\\item')) {
      const itemContent = line.replace(/^\\item\s*/, '');
      const formatted = formatInlineLatex(itemContent);
      if (inItemize || inEnumerate) {
        html += `<li>${formatted}</li>`;
      } else {
        html += `<ul><li>${formatted}</li></ul>`;
      }
      continue;
    }

    // Headings: \cvsection{...}, \section{...}, \makerubric{...}
    let sectionMatch = line.match(/^\\(?:cvsection|section\*?)\{(.*?)\}/);
    if (sectionMatch) {
      html += `<h2 class="v-section" data-raw="${escapeHtml(line)}">${escapeHtml(sectionMatch[1])}</h2>`;
      continue;
    }

    let rubricMatch = line.match(/^\\makerubric\{(.*?)\}/);
    if (rubricMatch) {
      html += `<h2 class="v-section" data-raw="${escapeHtml(line)}">${escapeHtml(rubricMatch[1].toUpperCase())}</h2>`;
      continue;
    }

    let subSectionMatch = line.match(/^\\(?:cvsubsection|subsection\*?)\{(.*?)\}/);
    if (subSectionMatch) {
      html += `<h3 class="v-subsection" data-raw="${escapeHtml(line)}">${escapeHtml(subSectionMatch[1])}</h3>`;
      continue;
    }

    // LaTeX Macros / Setup lines like \thispagestyle, \entry, etc.
    if (line.startsWith('\\') && (line.includes('\\begin{center}') || line.includes('\\end{center}') || line.includes('\\if') || line.includes('\\fi') || line.includes('\\makeheaders'))) {
      html += `<div class="latex-block-token" contenteditable="false" data-raw="${escapeHtml(line)}">${escapeHtml(line)}</div>`;
      continue;
    }

    // Normal paragraph text
    const formatted = formatInlineLatex(line);
    html += `<p>${formatted}</p>`;
  }

  return html || '<p>Start typing your document...</p>';
}

// Convert inline LaTeX tokens (\textbf, \textit, \href) to HTML tags
function formatInlineLatex(str) {
  let res = escapeHtml(str);

  // \textbf{...} -> <b>...</b>
  res = res.replace(/\\textbf\{([^{}]+)\}/g, '<b>$1</b>');
  // \textit{...} -> <i>...</i>
  res = res.replace(/\\textit\{([^{}]+)\}/g, '<i>$1</i>');
  // \href{url}{text} -> <a href="url">text</a>
  res = res.replace(/\\href\{([^{}]+)\}\{([^{}]+)\}/g, '<a href="$1" target="_blank">$2</a>');
  // \\ line breaks -> <br>
  res = res.replace(/\\\\/g, '<br>');

  return res;
}

// Serialize Visual DOM back to valid LaTeX
function serializeVisualToLatex() {
  const preamble = elPreambleTextarea.value.trim();
  let bodyLatex = '';

  const nodes = elVisualBody.childNodes;
  for (let node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();

      if (tag === 'h2') {
        const raw = node.getAttribute('data-raw');
        const text = node.textContent.trim();
        if (raw && raw.startsWith('\\makerubric')) {
          bodyLatex += `${raw}\n\n`;
        } else {
          bodyLatex += `\\cvsection{${text}}\n`;
        }
      } else if (tag === 'h3') {
        const text = node.textContent.trim();
        bodyLatex += `\\subsection{${text}}\n`;
      } else if (tag === 'ul') {
        bodyLatex += '\\begin{itemize}\n';
        node.querySelectorAll('li').forEach(li => {
          bodyLatex += `    \\item ${deformatHtmlToLatex(li.innerHTML)}\n`;
        });
        bodyLatex += '\\end{itemize}\n\n';
      } else if (tag === 'ol') {
        bodyLatex += '\\begin{enumerate}\n';
        node.querySelectorAll('li').forEach(li => {
          bodyLatex += `    \\item ${deformatHtmlToLatex(li.innerHTML)}\n`;
        });
        bodyLatex += '\\end{enumerate}\n\n';
      } else if (node.classList.contains('latex-block-token')) {
        const raw = node.getAttribute('data-raw') || node.textContent;
        bodyLatex += `${raw}\n`;
      } else if (tag === 'p') {
        const text = deformatHtmlToLatex(node.innerHTML).trim();
        if (text) {
          bodyLatex += `${text}\n\n`;
        }
      } else {
        const text = deformatHtmlToLatex(node.innerHTML).trim();
        if (text) bodyLatex += `${text}\n`;
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) bodyLatex += `${text}\n`;
    }
  }

  // Assemble full document
  let fullDoc = '';
  if (preamble) {
    fullDoc += preamble + '\n\n';
  }
  fullDoc += '\\begin{document}\n\n';
  fullDoc += bodyLatex.trim() + '\n\n';
  fullDoc += '\\end{document}\n';

  return fullDoc;
}

// Convert HTML tags (<b>, <i>, <a>, <br>) back to LaTeX commands
function deformatHtmlToLatex(html) {
  let s = html;
  s = s.replace(/<b>(.*?)<\/b>/gi, '\\textbf{$1}');
  s = s.replace(/<strong>(.*?)<\/strong>/gi, '\\textbf{$1}');
  s = s.replace(/<i>(.*?)<\/i>/gi, '\\textit{$1}');
  s = s.replace(/<em>(.*?)<\/em>/gi, '\\textit{$1}');
  s = s.replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '\\href{$1}{$2}');
  s = s.replace(/<br\s*\/?>/gi, ' \\\\\n');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  return s.trim();
}

// Visual Toolbar Action Helpers
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

    // Render into Visual Mode
    renderLatexToVisual(contentData.content);

    if (currentFileInfo.pdf_exists) {
      refreshPdfViewer();
    } else {
      elPdfPlaceholder.classList.remove('hidden');
      elPdfFrame.style.display = 'none';
    }

    setStatus('ready', 'Ready');
  } catch (err) {
    console.error('Failed to load file:', err);
    setStatus('error', 'Error loading file');
  }
}

// Get current editor content based on active mode
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

    // Render raw log
    elRawLogText.textContent = data.log || 'No log output.';

    if (data.success) {
      setStatus('success', `Compiled in ${data.duration}`);
      refreshPdfViewer();
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

// Save content only
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

// Refresh PDF preview
function refreshPdfViewer() {
  elPdfPlaceholder.classList.add('hidden');
  elPdfFrame.style.display = 'block';
  elPdfFrame.src = `/api/pdf?t=${Date.now()}`;
}

// Status badge helper
function setStatus(type, text) {
  elStatusBadge.className = `status-badge ${type}`;
  elStatusText.textContent = text;
}

// Render errors and warnings
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

// Log drawer tabs
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

// Recompile buttons
elBtnRecompile.addEventListener('click', triggerCompile);
if (elBtnFirstCompile) {
  elBtnFirstCompile.addEventListener('click', triggerCompile);
}

// Download PDF button
elBtnDownloadPdf.addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = '/api/pdf';
  link.download = currentFileInfo ? currentFileInfo.file_name.replace(/\.tex$/, '.pdf') : 'document.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Theme switcher
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
