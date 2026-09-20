import { parseDocument, serializeDocument } from '../parser.js';

// Acquire VS Code API
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

// DOM Elements
const elFileName = document.getElementById('file-name');
const elStatusDot = document.getElementById('status-dot');
const elStatusText = document.getElementById('status-text');
const elPaperCanvas = document.getElementById('paper-canvas');
const elBtnSave = document.getElementById('btn-save');

let parsedDoc = null;
let isDirty = false;
let autoSaveTimer = null;

function setStatus(state, message) {
  if (!elStatusDot || !elStatusText) return;
  elStatusDot.className = 'status-dot';

  if (state === 'saved') {
    elStatusText.textContent = message || 'Saved';
  } else if (state === 'dirty') {
    elStatusDot.classList.add('dirty');
    elStatusText.textContent = message || 'Unsaved edits';
  } else if (state === 'saving') {
    elStatusDot.classList.add('saving');
    elStatusText.textContent = message || 'Saving...';
  }
}

function markDirty() {
  if (!isDirty) {
    isDirty = true;
    setStatus('dirty', 'Unsaved edits');
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveDocument();
  }, 1800);
}

function renderDocument(source) {
  parsedDoc = parseDocument(source);
  elPaperCanvas.replaceChildren();

  for (const block of parsedDoc.blocks) {
    if (block.hidden) continue;

    const blockWrapper = document.createElement('div');
    blockWrapper.className = 'canvas-block';
    blockWrapper.dataset.blockId = String(block.id);
    blockWrapper.innerHTML = block.html;

    if (block.protected) {
      blockWrapper.contentEditable = 'false';
    }

    elPaperCanvas.appendChild(blockWrapper);
    block.snapshot = blockWrapper.innerHTML;
  }

  isDirty = false;
  setStatus('saved', 'Ready');
}

function saveDocument() {
  if (!parsedDoc || !elPaperCanvas) return;
  setStatus('saving', 'Saving...');

  try {
    const serialized = serializeDocument(parsedDoc, elPaperCanvas);
    if (vscode) {
      vscode.postMessage({
        command: 'save',
        content: serialized,
      });
    } else {
      console.log('Saved content length:', serialized.length);
      setStatus('saved', 'Saved (standalone)');
    }
  } catch (err) {
    console.error('Error saving document:', err);
    setStatus('dirty', 'Error saving');
  }
}

// Formatting commands
function setupFormattingButtons() {
  const btnBold = document.getElementById('btn-bold');
  const btnItalic = document.getElementById('btn-italic');
  const btnUnderline = document.getElementById('btn-underline');
  const btnH2 = document.getElementById('btn-h2');
  const btnH3 = document.getElementById('btn-h3');
  const btnList = document.getElementById('btn-list');

  if (btnBold) {
    btnBold.addEventListener('click', () => {
      document.execCommand('bold', false, null);
      markDirty();
    });
  }

  if (btnItalic) {
    btnItalic.addEventListener('click', () => {
      document.execCommand('italic', false, null);
      markDirty();
    });
  }

  if (btnUnderline) {
    btnUnderline.addEventListener('click', () => {
      document.execCommand('underline', false, null);
      markDirty();
    });
  }

  if (btnH2) {
    btnH2.addEventListener('click', () => {
      document.execCommand('formatBlock', false, 'h2');
      markDirty();
    });
  }

  if (btnH3) {
    btnH3.addEventListener('click', () => {
      document.execCommand('formatBlock', false, 'h3');
      markDirty();
    });
  }

  if (btnList) {
    btnList.addEventListener('click', () => {
      document.execCommand('insertUnorderedList', false, null);
      markDirty();
    });
  }

  // Color dots: Black, Blue, Red
  document.querySelectorAll('.color-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      const color = dot.dataset.color || 'blue';
      applyTextColor(color);
    });
  });
}

function applyTextColor(color) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  span.className = 'latex-color';
  span.style.color = color === 'blue' ? '#0055D4' : color === 'red' ? '#E41A1C' : '#000000';
  span.dataset.color = color;

  span.appendChild(range.extractContents());
  range.insertNode(span);

  // Restore selection
  selection.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  selection.addRange(newRange);

  markDirty();
}

// Global Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    clearTimeout(autoSaveTimer);
    saveDocument();
  }
});

// Canvas input listener
if (elPaperCanvas) {
  elPaperCanvas.addEventListener('input', () => {
    markDirty();
  });
}

if (elBtnSave) {
  elBtnSave.addEventListener('click', () => {
    clearTimeout(autoSaveTimer);
    saveDocument();
  });
}

// Inbound messages from VS Code extension
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  switch (message.command) {
    case 'init': {
      if (elFileName && message.fileName) {
        elFileName.textContent = message.fileName;
      }
      renderDocument(message.content || '');
      break;
    }
    case 'saveSuccess': {
      isDirty = false;
      setStatus('saved', 'Saved');
      // Update snapshots to current DOM innerHTML
      if (parsedDoc && elPaperCanvas) {
        for (const child of elPaperCanvas.children) {
          const id = Number(child.dataset.blockId);
          if (!isNaN(id) && parsedDoc.blocks[id]) {
            parsedDoc.blocks[id].snapshot = child.innerHTML;
          }
        }
      }
      break;
    }
    case 'externalUpdate': {
      // If user hasn't made unsaved edits, seamlessly reload from disk
      if (!isDirty) {
        renderDocument(message.content || '');
        setStatus('saved', 'Updated from disk');
      } else {
        setStatus('dirty', 'Disk changed (unsaved edits)');
      }
      break;
    }
  }
});

// Initialize UI
setupFormattingButtons();

// Notify VS Code that webview is ready to receive document
if (vscode) {
  vscode.postMessage({ command: 'ready' });
}
