import { RichDocument } from './rich-latex.js';
import { escapeHtml } from './latex.js';

let currentFileInfo = null;
let isCompiling = false;
let selectedFile =
  typeof window !== 'undefined' && window.location
    ? new URLSearchParams(window.location.search).get('file')
    : null;
let savedContent = '';
let pendingWrite = Promise.resolve();
let visualAutoSaveTimer = null;
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

  pendingWrite = pendingWrite
    .catch(() => {})
    .then(async () => {
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

function renderLatexToVisual(source) {
  richDocument = new RichDocument(elVisualBody, elPreambleTextarea);
  richDocument.render(source);
}

function serializeVisualToLatex() {
  return richDocument ? richDocument.serialize() : savedContent;
}

function getCurrentContent() {
  return serializeVisualToLatex();
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

// Unified Compile: Generates PDF and companion DOCX
async function triggerCompile() {
  if (isCompiling) return;

  let content;
  try {
    content = getCurrentContent();
  } catch (err) {
    setStatus('error', err.message);
    return;
  }

  isCompiling = true;
  setStatus('compiling', 'Compiling PDF & DOCX...');
  if (elBtnRecompile) elBtnRecompile.disabled = true;

  try {
    const engine = elEngineSelect?.value || 'pdflatex';
    const data = await writeDocument('compile', content, { engine });

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
    setStatus('error', err.message);
    console.error('Compile error:', err);
  } finally {
    isCompiling = false;
    if (elBtnRecompile) elBtnRecompile.disabled = false;
  }
}

async function saveContentOnly() {
  try {
    const content = getCurrentContent();
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

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
    if (elThemeIcon) elThemeIcon.textContent = '🌙';
  } else {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
    if (elThemeIcon) elThemeIcon.textContent = '☀️';
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

    renderLatexToVisual(data.content);
    setStatus('ready', 'Ready');
  } catch (err) {
    console.error('Load error:', err);
    setStatus('error', err.message);
  }
}

// Reload from disk if modified externally (e.g. by VS Code or AI agent)
async function checkForExternalUpdates() {
  if (isCompiling) return;
  try {
    const res = await fetch(documentUrl('/api/document'));
    if (!res.ok) return;
    const data = await res.json();
    if (currentFileInfo && data.revision !== currentFileInfo.revision) {
      // Check if user has unsaved local visual edits
      let currentLocal = savedContent;
      try {
        currentLocal = getCurrentContent();
      } catch {
        // If local DOM is in an intermediate state, don't overwrite user edits
        return;
      }
      if (currentLocal === savedContent) {
        // Safe to seamlessly reload
        currentFileInfo = data;
        savedContent = data.content;
        renderLatexToVisual(data.content);
        setStatus('ready', 'Updated from disk');
        setTimeout(() => setStatus('ready', 'Ready'), 1500);
      }
    }
  } catch {
    // Ignore transient poll errors
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

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (elAutoCompileChk && elAutoCompileChk.checked) {
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
    }
  });

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
      try {
        if (currentFileInfo && getCurrentContent() !== savedContent) {
          scheduleAutoCompile();
        }
      } catch (err) {
        setStatus('error', err.message);
      }
    }).observe(elVisualBody, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'data-align', 'data-vspace'],
    });
  }

  // Window focus listener to immediately reload if file was changed in VS Code
  window.addEventListener('focus', () => {
    checkForExternalUpdates();
  });

  // Background poll every 2 seconds for external edits
  const updatePoll = setInterval(checkForExternalUpdates, 2000);
  if (updatePoll && typeof updatePoll.unref === 'function') {
    updatePoll.unref();
  }

  await loadFile();
}

init();
