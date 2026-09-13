import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import { RichDocument } from './rich-latex.js';
import { escapeHtml } from './latex.js';

let editor = null;
let currentFileInfo = null;
let isCompiling = false;
let currentMode = 'visual'; // 'code' or 'visual'
let selectedFile = null;
let savedContent = '';
let pendingWrite = Promise.resolve();
let visualAutoSaveTimer = null;
let lastActiveVisualSnippet = '';
let userDismissedLogs = false;
let richDocument = null;

// DOM Elements
const elActiveFilename = document.getElementById('active-filename');
const elFileSelectorBtn = document.getElementById('file-selector-btn');
const elBtnRecompile = document.getElementById('btn-recompile');
const elEngineSelect = document.getElementById('engine-select') || { value: 'pdflatex' };
const elStatusBadge = document.getElementById('status-badge');
const elStatusText = document.getElementById('status-text');
const elAutoCompileChk = document.getElementById('auto-compile-chk');
const elBtnToggleLog = document.getElementById('btn-toggle-log');
const elBtnCloseLog = document.getElementById('btn-close-log');
const elBtnDismissLogs = document.getElementById('btn-dismiss-logs');
const elBtnTheme = document.getElementById('btn-theme');
const elThemeIcon = document.getElementById('theme-icon');
const elLogDrawer = document.getElementById('log-drawer');
const elErrorsList = document.getElementById('errors-list');
const elRawLogText = document.getElementById('raw-log-text');
const elErrorCountBadge = document.getElementById('error-count-badge');
const elFileModal = document.getElementById('file-modal');
const elBtnCloseModal = document.getElementById('btn-close-modal');
const elFileList = document.getElementById('file-list');
const elFileSearchInput = document.getElementById('file-search-input');

// Mode Switch Elements
const elBtnModeCode = document.getElementById('btn-mode-code');
const elBtnModeVisual = document.getElementById('btn-mode-visual');
const elEditorContainer = document.getElementById('editor-container');
const elVisualContainer = document.getElementById('visual-container');

// Visual Canvas Elements
const elPreambleTextarea = { value: '' };
const elVisualBody = document.getElementById('visual-body');

function documentUrl(path) {
  const query = selectedFile ? `?file=${encodeURIComponent(selectedFile)}` : '';
  return `${path}${query}`;
}

async function writeDocument(path, content, extra = {}) {
  const file = currentFileInfo?.file_path || selectedFile;
  const revision = currentFileInfo?.revision;
  const body = { file, revision, content, ...extra };

  pendingWrite = pendingWrite.then(async () => {
    const response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LocalLeaf': '1',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Write operation failed');
    }

    if (currentFileInfo && data.revision) {
      currentFileInfo.revision = data.revision;
    }
    savedContent = content;
    return data;
  });

  return pendingWrite;
}

function updateVisualSelectionSnippet() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const node = sel.anchorNode;
  if (!node || !elVisualBody || !elVisualBody.contains(node)) return;

  let text = '';
  if (node.nodeType === Node.TEXT_NODE) {
    text = node.textContent.trim();
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    text = node.textContent.trim();
  }

  if (text.length > 3) {
    lastActiveVisualSnippet = text;
  }
}

if (elVisualBody) {
  elVisualBody.addEventListener('mouseup', updateVisualSelectionSnippet);
  elVisualBody.addEventListener('keyup', updateVisualSelectionSnippet);
}

function jumpCodeEditorToSnippet(snippet) {
  if (!editor || !snippet) return;
  const model = editor.getModel();
  if (!model) return;

  const cleanSnippet = snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40);
  const matches = model.findMatches(cleanSnippet, true, false, false, null, true);

  if (matches && matches.length > 0) {
    const targetLine = matches[0].range.startLineNumber;
    editor.revealLineInCenter(targetLine);
    editor.setPosition({ lineNumber: targetLine, column: matches[0].range.startColumn });
    editor.focus();
  }
}

function jumpVisualEditorToText(text) {
  if (!text || !elVisualBody) return;
  const words = text
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return;

  const targetSearch = words.slice(0, 3).join(' ').toLowerCase();
  const walker = document.createTreeWalker(elVisualBody, NodeFilter.SHOW_ELEMENT);
  let matchNode = null;
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (['P', 'H1', 'H2', 'H3', 'H4', 'LI', 'TR', 'DIV'].includes(el.tagName)) {
      if (el.textContent.toLowerCase().includes(targetSearch)) {
        matchNode = el;
        break;
      }
    }
  }

  if (matchNode) {
    matchNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    matchNode.classList.add('visual-highlight-jump');
    setTimeout(() => matchNode.classList.remove('visual-highlight-jump'), 1500);
  }
}

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
        currentLineText = lineContent
          .replace(
            /\\(?:textbf|textit|href|cvsection|begin|end|item|rule|fontsize|selectfont)\b[^{}]*(\{[^}]*\})?/g,
            ' ',
          )
          .trim();
      }
    }
    const latexCode = editor ? editor.getValue() : '';
    renderLatexToVisual(latexCode);
    elEditorContainer.classList.add('hidden');
    elVisualContainer.classList.remove('hidden');
    elBtnModeVisual.classList.add('active');
    elBtnModeCode.classList.remove('active');
    currentMode = 'visual';

    if (currentLineText) {
      setTimeout(() => jumpVisualEditorToText(currentLineText), 40);
    }
  }
}

if (elBtnModeCode) elBtnModeCode.addEventListener('click', () => setEditorMode('code'));
if (elBtnModeVisual) elBtnModeVisual.addEventListener('click', () => setEditorMode('visual'));

function renderLatexToVisual(source) {
  richDocument = new RichDocument(elVisualBody, elPreambleTextarea);
  richDocument.render(source);
}

function serializeVisualToLatex() {
  return richDocument ? richDocument.serialize() : editor?.getValue() || '';
}

function getCurrentContent() {
  if (currentMode === 'visual') {
    return serializeVisualToLatex();
  } else {
    return editor ? editor.getValue() : '';
  }
}

function setStatus(type, text) {
  if (elStatusBadge) elStatusBadge.className = `status-badge ${type}`;
  if (elStatusText) elStatusText.textContent = text;
}

function renderIssues(errors, warnings) {
  if (!elErrorsList) return;
  elErrorsList.innerHTML = '';
  const total = (errors ? errors.length : 0) + (warnings ? warnings.length : 0);
  if (elErrorCountBadge) elErrorCountBadge.textContent = total;

  if (total === 0) {
    elErrorsList.innerHTML =
      '<div class="empty-log-msg">No compilation issues detected. Everything looks clean!</div>';
    return;
  }

  if (errors && errors.length > 0) {
    errors.forEach((err) => {
      const item = document.createElement('div');
      item.className = 'error-item';
      item.innerHTML = `
        <div class="error-msg">${escapeHtml(err.message)}</div>
        <div class="error-line">Line ${err.line}</div>
        ${err.snippet ? `<div class="error-snippet">${escapeHtml(err.snippet)}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        if (currentMode !== 'code') setEditorMode('code');
        if (editor) {
          editor.revealLineInCenter(err.line);
          editor.setPosition({ lineNumber: err.line, column: 1 });
          editor.focus();
        }
      });
      elErrorsList.appendChild(item);
    });
  }

  if (warnings && warnings.length > 0) {
    warnings.forEach((warn) => {
      const item = document.createElement('div');
      item.className = 'error-item warning';
      item.innerHTML = `
        <div class="error-msg">${escapeHtml(warn.message)}</div>
        <div class="error-line">Line ${warn.line}</div>
      `;
      elErrorsList.appendChild(item);
    });
  }
}

function switchLogTab(tabId) {
  document.querySelectorAll('.log-tabs .tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function dismissLogDrawer() {
  if (!elLogDrawer) return;
  elLogDrawer.classList.add('collapsed');
  elLogDrawer.style.display = 'none';
  userDismissedLogs = true;
}

// Unified Compile: Compiles PDF and companion DOCX
async function triggerCompile() {
  if (isCompiling) return;

  isCompiling = true;
  setStatus('compiling', 'Compiling PDF & DOCX...');
  if (elBtnRecompile) elBtnRecompile.disabled = true;

  const content = getCurrentContent();
  const engine = elEngineSelect.value || 'pdflatex';

  try {
    const data = await writeDocument('compile', content, { engine });
    isCompiling = false;
    if (elBtnRecompile) elBtnRecompile.disabled = false;

    if (elRawLogText) elRawLogText.textContent = data.log || 'No log output.';

    if (data.success) {
      const docxLabel = data.docx_success ? ' (PDF + DOCX)' : '';
      setStatus('success', `Ready${docxLabel} in ${data.duration}`);
      renderIssues(data.errors, data.warnings);

      if (data.errors && data.errors.length === 0) {
        if (elLogDrawer) {
          elLogDrawer.classList.add('collapsed');
          elLogDrawer.style.display = 'none';
        }
      }
    } else {
      setStatus('error', `Errors (${data.errors ? data.errors.length : 1})`);
      renderIssues(data.errors, data.warnings);
      if (!userDismissedLogs && elLogDrawer) {
        elLogDrawer.style.display = 'flex';
        elLogDrawer.classList.remove('collapsed');
        switchLogTab('tab-errors');
      }
    }
  } catch (err) {
    isCompiling = false;
    if (elBtnRecompile) elBtnRecompile.disabled = false;
    setStatus('error', err.message);
    console.error('Compile error:', err);
  }
}

async function saveContentOnly() {
  const content = getCurrentContent();
  try {
    await writeDocument('save', content);
    setStatus('ready', 'Saved');
    setTimeout(() => setStatus('ready', 'Ready'), 1500);
  } catch (err) {
    console.error('Failed to save:', err);
    setStatus('error', err.message);
  }
}

function scheduleAutoCompile() {
  clearTimeout(visualAutoSaveTimer);
  visualAutoSaveTimer = setTimeout(() => {
    if (elAutoCompileChk && elAutoCompileChk.checked) {
      triggerCompile();
    } else {
      saveContentOnly();
    }
  }, 1200);
}

function toggleWordWrap() {
  if (!editor) return;
  const currentWrap = editor.getRawOptions
    ? editor.getRawOptions().wordWrap
    : editor.getOption(monaco.editor.EditorOption.wordWrap);
  const nextWrap = currentWrap === 'on' ? 'off' : 'on';
  editor.updateOptions({ wordWrap: nextWrap });
  setStatus('ready', `Word wrap: ${nextWrap}`);
  setTimeout(() => setStatus('ready', 'Ready'), 1200);
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
    if (elThemeIcon) elThemeIcon.textContent = '🌙';
    if (editor) monaco.editor.setTheme('vs-dark');
  } else {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    if (elThemeIcon) elThemeIcon.textContent = '☀️';
    if (editor) monaco.editor.setTheme('vs');
  }
  localStorage.setItem('localleaf-theme', theme);
}

async function loadFile() {
  setStatus('compiling', 'Loading...');
  try {
    const res = await fetch(documentUrl('/api/document'));
    if (!res.ok) throw new Error('Failed to load document');
    const data = await res.json();
    currentFileInfo = data;
    savedContent = data.content;

    if (elActiveFilename) elActiveFilename.textContent = data.file_name;
    document.title = `${data.file_name} — LocalLeaf`;

    if (data.engine && elEngineSelect) elEngineSelect.value = data.engine;

    if (editor) {
      editor.setValue(data.content);
    }
    renderLatexToVisual(data.content);

    setStatus('ready', 'Ready');
  } catch (err) {
    console.error('Load error:', err);
    setStatus('error', err.message);
  }
}

function renderFileList(files) {
  if (!elFileList) return;
  if (files.length === 0) {
    elFileList.innerHTML = '<div class="empty-log-msg">No .tex files found.</div>';
    return;
  }

  elFileList.innerHTML = '';
  files.forEach((f) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-item-name">${escapeHtml(f.name)}</div>
      <div class="file-item-path">${escapeHtml(f.rel_path)}</div>
    `;
    item.addEventListener('click', async () => {
      if (elFileModal) elFileModal.classList.add('hidden');
      await switchFile(f.path);
    });
    elFileList.appendChild(item);
  });
}

async function switchFile(filePath) {
  clearTimeout(visualAutoSaveTimer);
  try {
    await pendingWrite;
    if (getCurrentContent() !== savedContent) await writeDocument('save', getCurrentContent());
    const response = await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LocalLeaf': '1' },
      body: JSON.stringify({ file: filePath }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    selectedFile = data.file_path;
    await loadFile();
  } catch (error) {
    setStatus('error', error.message);
  }
}

// App Initialization
async function init() {
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
    renderWhitespace: 'selection',
  });

  editor.addAction({
    id: 'toggle-word-wrap-action',
    label: 'Toggle Word Wrap (Alt+Z)',
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
    run: function () {
      toggleWordWrap();
    },
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
    if (elAutoCompileChk && elAutoCompileChk.checked) {
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
      if (elAutoCompileChk && elAutoCompileChk.checked) {
        triggerCompile();
      } else {
        saveContentOnly();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      triggerCompile();
    } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      setEditorMode(currentMode === 'visual' ? 'code' : 'visual');
    } else if (e.key === 'Escape') {
      dismissLogDrawer();
      if (elFileModal && !elFileModal.classList.contains('hidden')) {
        elFileModal.classList.add('hidden');
      }
    }
  });

  // UI Event Listeners
  if (elBtnRecompile) {
    elBtnRecompile.addEventListener('click', () => {
      userDismissedLogs = false;
      triggerCompile();
    });
  }

  if (elBtnToggleLog) {
    elBtnToggleLog.addEventListener('click', (e) => {
      e.preventDefault();
      if (!elLogDrawer) return;
      if (elLogDrawer.classList.contains('collapsed') || elLogDrawer.style.display === 'none') {
        elLogDrawer.style.display = 'flex';
        elLogDrawer.classList.remove('collapsed');
        userDismissedLogs = false;
      } else {
        elLogDrawer.classList.add('collapsed');
        elLogDrawer.style.display = 'none';
      }
    });
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

  if (elBtnTheme) {
    elBtnTheme.addEventListener('click', () => {
      const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
      applyTheme(current === 'light' ? 'dark' : 'light');
    });
  }

  document.querySelectorAll('.log-tabs .tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchLogTab(btn.getAttribute('data-tab'));
    });
  });

  // File Selector Modal
  if (elFileSelectorBtn) {
    elFileSelectorBtn.addEventListener('click', async () => {
      if (!elFileModal) return;
      elFileModal.classList.remove('hidden');
      if (elFileList) {
        elFileList.innerHTML =
          '<div class="file-list-loading">Scanning workspace for .tex files...</div>';
      }

      try {
        const res = await fetch(documentUrl('/api/browse'));
        const data = await res.json();
        renderFileList(data.files || []);
      } catch (_err) {
        if (elFileList) {
          elFileList.innerHTML = '<div class="empty-log-msg">Failed to scan files.</div>';
        }
      }
    });
  }

  if (elBtnCloseModal) {
    elBtnCloseModal.addEventListener('click', () => {
      if (elFileModal) elFileModal.classList.add('hidden');
    });
  }

  if (elFileModal) {
    elFileModal.addEventListener('click', (e) => {
      if (e.target === elFileModal) {
        elFileModal.classList.add('hidden');
      }
    });
  }

  if (elFileSearchInput) {
    elFileSearchInput.addEventListener('input', () => {
      if (!elFileList) return;
      for (const item of elFileList.children) {
        item.hidden = !item.textContent
          .toLowerCase()
          .includes(elFileSearchInput.value.toLowerCase());
      }
    });
  }

  // Visual Content Change Observer
  if (elVisualBody) {
    new MutationObserver(() => {
      if (currentMode === 'visual' && currentFileInfo && getCurrentContent() !== savedContent) {
        scheduleAutoCompile();
      }
    }).observe(elVisualBody, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'data-align', 'data-vspace'],
    });
  }

  await loadFile();
}

init();
