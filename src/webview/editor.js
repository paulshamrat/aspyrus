import { detectCanvasTypography, parseDocument, serializeDocument, serializeDomBlock, escapeHtml } from '../parser.js';

// Acquire VS Code API
const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

// DOM Elements
const elFileName = document.getElementById('file-name');
const elStatusDot = document.getElementById('status-dot');
const elStatusText = document.getElementById('status-text');
const elPaperCanvas = document.getElementById('paper-canvas');
const elBtnSave = document.getElementById('btn-save');
const elBtnUndo = document.getElementById('btn-undo');
const elBtnRedo = document.getElementById('btn-redo');
const elBtnCompile = document.getElementById('btn-compile');

let parsedDoc = null;
let canvasHistory = [];
let historyIndex = -1;
let isDirty = false;
let editRevision = 0;
let nextSaveId = 0;
let inFlightSave = null;
let isCompiling = false;
let pendingCompile = false;
let builtSource = null;
let builtMode = null;
let buildingSource = null;
let buildingMode = null;
let autoSaveTimer = null;
let currentCitationMode = 'numbers'; // 'numbers' | 'keys' | 'dois'
let currentFileName = '';
let bibContext = { citeNumbers: {}, doiMap: {}, metaMap: {}, isSuperscript: false, labelMap: {} };
let figureUris = {};
let cachedProjectImages = [];
let renderProjectImages = null;
let handleImagePicked = null;

function formatCitationNumbers(nums) {
  if (!bibContext.compressCitations || !nums.every(n => /^\d+$/.test(n))) return nums.join(',');
  nums = [...new Set(nums)];
  const result = [];
  for (let i=0; i<nums.length; i++) {
    let j=i;
    while (j+1<nums.length && Number(nums[j+1]) === Number(nums[j])+1) j++;
    result.push(...(j-i>=2 ? [nums[i]+'–'+nums[j]] : nums.slice(i,j+1)));
    i=j;
  }
  return result.join(',');
}

function updateReferencesDisplay() {
  if (!parsedDoc) return;
  // Parse the current source so pasted/reordered floats also share their
  // caption number with forward references. Never replace the editing DOM.
  const current = parseDocument(serializeDocument(parsedDoc, elPaperCanvas), {
    fileName: currentFileName, labelMap: bibContext.labelMap, labelKinds: bibContext.labelKinds,
  });
  const unchanged = [...elPaperCanvas.children].map(node => [node, parsedDoc.blocks.find(b => String(b.id) === node.dataset.blockId)])
    .filter(([node, block]) => block && node.innerHTML === block.snapshot);
  for (const node of elPaperCanvas.querySelectorAll('.latex-ref')) {
    const key = node.dataset.ref;
    const command = node.dataset.refCommand;
    const value = command === 'pageref' ? bibContext.labelPages?.[key] : current.referenceMap[key];
    const kind = current.referenceKinds[key];
    const resolved = value !== undefined && value !== '' && (command !== 'autoref' || kind);
    node.textContent = resolved ? (command === 'eqref' ? `(${value})` : command === 'autoref' ? `${kind} ${value}` : String(value)) : `[${key}]`;
    node.classList.toggle('ref-resolved', !!resolved);
    node.title = resolved ? `Reference: ${key}` : `Unresolved reference: ${key} — compile to resolve`;
  }
  const floats = current.blocks.filter(block => block.hasCaption);
  elPaperCanvas.querySelectorAll('.latex-float-card').forEach((node, index) => {
    const prefix = node.querySelector('.float-caption-prefix');
    if (prefix && floats[index]) prefix.textContent = floats[index].captionPrefix;
  });
  const equations = current.blocks.filter(block => block.isEquation);
  elPaperCanvas.querySelectorAll('.latex-equation-block').forEach((node, index) => {
    const number = node.querySelector('.equation-num');
    if (number && equations[index]?.displayNumber) number.textContent = `(${equations[index].displayNumber})`;
  });
  // A display-only refresh must not turn untouched paragraphs into rewritten TEX.
  for (const [node, block] of unchanged) block.snapshot = node.innerHTML;
}

let lastCitationsSignature = '';

function getCitationsSignature() {
  if (!elPaperCanvas) return '';
  return [...elPaperCanvas.querySelectorAll('.latex-cite')]
    .map((node) => node.dataset.keys || '')
    .join('|');
}

function updateCitationsDisplay(forceRenumber = false) {
  if (!elPaperCanvas) return;
  updateReferencesDisplay();
  const citeNodes = elPaperCanvas.querySelectorAll('.latex-cite');
  const isSuper = bibContext.isSuperscript;

  // Always re-index citation numbers sequentially in order of first appearance from top to bottom
  const computedNumbers = {};
  let counter = 1;
  for (const node of citeNodes) {
    const rawKeys = node.dataset.keys || '';
    const keys = rawKeys.split(',').map((k) => k.trim()).filter(Boolean);
    for (const k of keys) {
      if (!computedNumbers[k]) {
        computedNumbers[k] = String(counter++);
      }
    }
  }
  if (forceRenumber) {
    bibContext.citeNumbers = { ...computedNumbers };
  }
  const citeNumbers = forceRenumber
    ? computedNumbers
    : { ...computedNumbers, ...bibContext.citeNumbers };

  for (const node of citeNodes) {
    // BibTeX / \revref citation
    const rawKeys = node.dataset.keys || '';
    const keys = rawKeys.split(',').map((k) => k.trim()).filter(Boolean);

    if (currentCitationMode === 'numbers') {
      const nums = keys.map((k) => citeNumbers[k] || '?');
      if (bibContext.sortCitations && nums.every((n) => /^\d+$/.test(n))) {
        nums.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      }
      const displayText = formatCitationNumbers(nums);

      if (isSuper) {
        node.className = 'latex-token latex-cite cite-super';
        const prev = node.previousSibling;
        if (prev && prev.nodeType === 3 && /\s$/.test(prev.textContent || '')) {
          node.classList.add('cite-super-space-collapsed');
        }
        node.textContent = displayText;
      } else {
        node.className = 'latex-token latex-cite cite-bracket';
        node.textContent = `[${displayText}]`;
      }
    } else if (currentCitationMode === 'dois') {
      const dois = keys.map((k) => {
        const d = bibContext.doiMap && bibContext.doiMap[k];
        return d ? (d.startsWith('10.') ? d : `10.${d.split('10.')[1] || d}`) : k;
      });
      node.className = 'latex-token latex-cite cite-doi';
      node.textContent = `[DOI: ${dois.join(', ')}]`;
    } else {
      node.className = 'latex-token latex-cite cite-key';
      node.textContent = `[${rawKeys}]`;
    }

    // Rich Tooltip with author, year, title, DOI
    const metaList = keys.map((k) => {
      const m = bibContext.metaMap && bibContext.metaMap[k];
      if (m && m.title) {
        return `${m.author ? m.author + ' ' : ''}(${m.year || 'n.d.'}): "${m.title}" ${m.doi ? '[DOI: ' + m.doi + ']' : ''}`;
      }
      return (bibContext.doiMap && bibContext.doiMap[k]) ? `DOI: ${bibContext.doiMap[k]}` : `Citekey: ${k}`;
    });
    node.title = metaList.join('\n\n') || `Citation: ${rawKeys}`;
  }
  lastCitationsSignature = getCitationsSignature();
}

let feedbackTimer = null;
function buildStatus() {
  return builtSource === null ? 'Compile to update outputs' : (builtSource === serializeDocument(parsedDoc, elPaperCanvas) && builtMode === currentCitationMode ? 'Outputs up to date' : 'Changes since last build');
}

function setStatus(state, message) {
  if (elStatusText && message && /^(Figure |Clipboard )/.test(message)) {
    elStatusText.classList.add('status-feedback');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => elStatusText.classList.remove('status-feedback'), 5000);
  }
  if (!elStatusDot || !elStatusText) return;
  elStatusDot.className = 'status-dot';
  if (elBtnSave) elBtnSave.className = 'save-btn';

  if (state === 'saved') {
    elStatusText.textContent = message || 'Saved';
  } else if (state === 'dirty') {
    elStatusDot.classList.add('dirty');
    if (elBtnSave) elBtnSave.classList.add('dirty');
    elStatusText.textContent = message || 'Unsaved edits';
  } else if (state === 'saving') {
    elStatusDot.classList.add('saving');
    if (elBtnSave) elBtnSave.classList.add('saving');
    elStatusText.textContent = message || 'Saving...';
  }
}

function markDirty() {
  recordCanvasHistory();
  editRevision += 1;
  if (!isDirty) {
    isDirty = true;
    setStatus('dirty', 'Unsaved edits');
  }
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(checkpointDraft, 750);
}

function applyCanvasTypography(source) {
  const profile = detectCanvasTypography(source);
  elPaperCanvas.classList.toggle('latex-manuscript-profile', profile.isLatexArticle);
  elPaperCanvas.dataset.latexBaseSize = profile.baseSizePt ? String(profile.baseSizePt) : '';
  elPaperCanvas.dataset.latexLineSpacing = profile.usesOneHalfSpacing ? 'onehalf' : '';
  elPaperCanvas.dataset.latexTitleSize = profile.titleSize || '';
  elPaperCanvas.dataset.latexHeadingSize = profile.normalHeadingCommands.length ? 'normal' : '';
  elPaperCanvas.dataset.latexCaptionSize = profile.captionSize || '';
}

function createBlockElement(block) {
  const blockWrapper = document.createElement('div');
  blockWrapper.className = 'canvas-block';
  blockWrapper.dataset.blockId = String(block.id);
  blockWrapper.innerHTML = block.html;
  if (block.hidden) {
    blockWrapper.hidden = true;
    blockWrapper.contentEditable = 'false';
  }

  const preview = blockWrapper.querySelector('.float-image-preview');
  if (preview) {
    preview.title = 'Select figure and caption (Ctrl+X to move)';
    const imagePath = preview.dataset.imagePath || '';
    const uri = figureUris[imagePath];
    if (uri) {
      const image = document.createElement('img');
      image.className = 'float-image';
      image.src = uri;
      image.alt = `Preview of ${imagePath.split('/').pop() || 'figure asset'}`;
      image.draggable = false;
      image.addEventListener('error', () => {
        preview.replaceChildren();
        const message = document.createElement('span');
        message.className = 'float-image-status float-image-error';
        message.textContent = `Preview unavailable: ${imagePath}`;
        preview.appendChild(message);
      });
      preview.replaceChildren(image);
    } else {
      preview.replaceChildren();
      const message = document.createElement('span');
      message.className = 'float-image-status float-image-error';
      message.textContent = `Preview unavailable: ${imagePath}`;
      preview.appendChild(message);
    }
  }

  if (block.protected) {
    blockWrapper.contentEditable = 'false';
  }

  return blockWrapper;
}

function renderDocument(source) {
  pendingFigureWrite = null;
  pendingFigurePaste = null;
  editRevision += 1;
  inFlightSave = null;
  pendingCompile = false;
  applyCanvasTypography(source);
  const parseOptions = {
    fileName: currentFileName || (elFileName ? elFileName.textContent : ''),
    labelMap: (bibContext && bibContext.labelMap) ? bibContext.labelMap : {},
    labelKinds: bibContext.labelKinds || {},
  };
  parsedDoc = parseDocument(source, parseOptions);
  elPaperCanvas.replaceChildren();

  for (const block of parsedDoc.blocks) {
    const blockWrapper = createBlockElement(block);
    elPaperCanvas.appendChild(blockWrapper);
    block.snapshot = blockWrapper.innerHTML;
  }

  // A title-only template still needs a real body insertion point. Native
  // Enter/paste inside a title can otherwise append nodes to its wrapper.
  if (!parsedDoc.blocks.some(block => !block.isTitle && !block.hidden && !block.protected)) {
    const blank = document.createElement('p');
    blank.appendChild(document.createElement('br'));
    const bibliography = [...elPaperCanvas.children].find(node => {
      const block = parsedDoc.blocks.find(b => String(b.id) === node.dataset.blockId);
      return block && /^\\bibliograph(?:y|ystyle)\b/.test(block.raw.trim());
    });
    elPaperCanvas.insertBefore(blank, bibliography || null);
  }
  updateCitationsDisplay();
  // Capture the initial displayed citation mode together with the source.
  const renderedBlocks = new Map(parsedDoc.blocks.map((block) => [String(block.id), block]));
  for (const child of elPaperCanvas.children) {
    const original = renderedBlocks.get(child.dataset.blockId);
    if (original) original.snapshot = child.innerHTML;
  }
  isDirty = false;
  canvasHistory = [];
  historyIndex = -1;
  recordCanvasHistory();
  setStatus('saved', 'Ready');
}

function saveDocument() {
  if (!parsedDoc || !elPaperCanvas || inFlightSave) return;
  setStatus('saving', 'Saving...');

  try {
    const serialized = serializeDocument(parsedDoc, elPaperCanvas);
    if (vscode) {
      inFlightSave = { id: ++nextSaveId, revision: editRevision };
      vscode.postMessage({
        command: 'save',
        saveId: inFlightSave.id,
        content: serialized,
      });
    } else {
      console.log('Saved content length:', serialized.length);
      setStatus('saved', 'Saved (standalone)');
    }
  } catch (err) {
    inFlightSave = null;
    isDirty = true;
    pendingCompile = false;
    console.error('Error saving document:', err);
    setStatus('dirty', 'Error saving');
  }
}

// Formatting commands
function canvasSnapshot() {
  const clone = elPaperCanvas.cloneNode(true);
  clone.querySelectorAll('.figure-selected').forEach((node) => node.classList.remove('figure-selected'));
  const selection = window.getSelection();
  function point(node, offset) {
    const path = [];
    while (node && node !== elPaperCanvas) {
      path.unshift([...node.parentNode.childNodes].indexOf(node));
      node = node.parentNode;
    }
    return node ? { path, offset } : null;
  }
  return { html: clone.innerHTML, anchor: point(selection?.anchorNode, selection?.anchorOffset), focus: point(selection?.focusNode, selection?.focusOffset) };
}

function recordCanvasHistory() {
  if (!elPaperCanvas) return;
  const snapshot = canvasSnapshot();
  if (canvasHistory[historyIndex]?.html === snapshot.html) return;
  canvasHistory.splice(historyIndex + 1);
  canvasHistory.push(snapshot);
  if (canvasHistory.length > 100) canvasHistory.shift();
  historyIndex = canvasHistory.length - 1;
}

function runHistoryCommand(command) {
  const next = historyIndex + (command === 'undo' ? -1 : 1);
  if (next < 0 || next >= canvasHistory.length) return;
  const snapshot = canvasHistory[next];
  historyIndex = next;
  elPaperCanvas.innerHTML = snapshot.html;
  pendingFigureWrite = null;
  pendingFigurePaste = null;
  elPaperCanvas.focus({ preventScroll: true });
  function resolve(point) {
    if (!point) return null;
    let node = elPaperCanvas;
    for (const index of point.path) node = node?.childNodes[index];
    return node ? [node, Math.min(point.offset, node.nodeType === 3 ? node.length : node.childNodes.length)] : null;
  }
  updateReferencesDisplay();
  const anchor = resolve(snapshot.anchor), focus = resolve(snapshot.focus);
  if (anchor && focus) window.getSelection().setBaseAndExtent(...anchor, ...focus);
  editRevision += 1;
  isDirty = true;
  setStatus('dirty', 'Unsaved edits');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(checkpointDraft, 750);
}

window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  runHistoryCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo');
}, true);
elPaperCanvas.addEventListener('beforeinput', (event) => {
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
    event.preventDefault();
    runHistoryCommand(event.inputType === 'historyUndo' ? 'undo' : 'redo');
  } else if (canvasHistory[historyIndex]) {
    // Capture the caret before native typing without recording a new edit.
    const state = canvasSnapshot();
    if (state.html === canvasHistory[historyIndex].html) canvasHistory[historyIndex] = state;
  }
});

function setupHistoryButtons() {
  if (elBtnUndo) {
    elBtnUndo.addEventListener('mousedown', (event) => event.preventDefault());
    elBtnUndo.addEventListener('click', () => runHistoryCommand('undo'));
  }
  if (elBtnRedo) {
    elBtnRedo.addEventListener('mousedown', (event) => event.preventDefault());
    elBtnRedo.addEventListener('click', () => runHistoryCommand('redo'));
  }
}

function setupFormattingButtons() {
  const btnBold = document.getElementById('btn-bold');
  const btnItalic = document.getElementById('btn-italic');
  const btnSuperscript = document.getElementById('btn-superscript');
  const btnSubscript = document.getElementById('btn-subscript');

  if (btnBold) {
    btnBold.addEventListener('mousedown', (event) => event.preventDefault());
    btnBold.addEventListener('click', () => {
      document.execCommand('bold', false, null);
      markDirty();
    });
  }

  if (btnItalic) {
    btnItalic.addEventListener('mousedown', (event) => event.preventDefault());
    btnItalic.addEventListener('click', () => {
      document.execCommand('italic', false, null);
      markDirty();
    });
  }

  if (btnSuperscript) {
    btnSuperscript.addEventListener('mousedown', (event) => event.preventDefault());
    btnSuperscript.addEventListener('click', () => {
      document.execCommand('superscript', false, null);
      markDirty();
    });
  }

  if (btnSubscript) {
    btnSubscript.addEventListener('mousedown', (event) => event.preventDefault());
    btnSubscript.addEventListener('click', () => {
      document.execCommand('subscript', false, null);
      markDirty();
    });
  }
}

let lastContextCaretRange = null;

function insertPlainText(text) {
  if (typeof text !== 'string' || !text) return;
  let sel = window.getSelection();
  if ((!sel || !sel.rangeCount || !elPaperCanvas.contains(sel.anchorNode)) && lastContextCaretRange) {
    elPaperCanvas.focus();
    sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastContextCaretRange);
  } else if (!sel || !sel.rangeCount || !elPaperCanvas.contains(sel.anchorNode)) {
    elPaperCanvas.focus();
  }
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  let success = false;
  try {
    success = document.execCommand('insertText', false, clean);
  } catch {}

  if (!success) {
    const currentSel = window.getSelection();
    if (currentSel && currentSel.rangeCount) {
      const range = currentSel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(clean);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      currentSel.removeAllRanges();
      currentSel.addRange(range);
    }
  }

  elPaperCanvas.dispatchEvent(new Event('input', { bubbles: true }));
  markDirty();
  setStatus('dirty', 'Pasted plain text — Ctrl+S to save');
}

async function pastePlainTextFromClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (typeof text === 'string') {
        insertPlainText(text);
        return;
      }
    }
  } catch {}

  if (vscode && vscode.postMessage) {
    vscode.postMessage({ command: 'requestClipboardPlainText' });
  }
}

let toolbarSelectionRange = null;

function rememberToolbarSelection() {
  const selection = window.getSelection();
  if (selection && selection.rangeCount) {
    toolbarSelectionRange = selection.getRangeAt(0).cloneRange();
  }
}

function restoreToolbarSelection() {
  if (!toolbarSelectionRange) return;
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(toolbarSelectionRange);
}


function applyBlockStyle(style) {
  restoreToolbarSelection();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const container = sel.getRangeAt(0).commonAncestorContainer;
    const element = container.nodeType === 1 ? container : container.parentElement;
    if (element?.closest('.latex-float-card')) return;
  }
  if (style === 'list') {
    document.execCommand('insertUnorderedList', false, null);
  } else {
    document.execCommand('formatBlock', false, style);
    const sel2 = window.getSelection();
    if (sel2 && sel2.anchorNode) {
      const node = sel2.anchorNode.nodeType === 1 ? sel2.anchorNode : sel2.anchorNode.parentElement;
      const heading = node?.closest('h2, h3, h4, h5');
      if (heading) heading.classList.add('latex-heading');
    }
  }
  markDirty();
}

function closeToolbarMenus(except = null) {
  document.querySelectorAll('.toolbar-menu-popover').forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
  document.querySelectorAll('.menu-trigger').forEach((button) => {
    const menu = document.getElementById(button.getAttribute('aria-controls'));
    if (!menu || menu !== except) button.setAttribute('aria-expanded', 'false');
  });
}

function setupToolbarMenus() {
  const menus = [
    ['btn-block-menu', 'block-menu'],
    ['btn-color-menu', 'color-menu'],
    ['btn-highlight-menu', 'highlight-menu'],
    ['btn-cite-mode-menu', 'cite-mode-menu'],
    ['btn-symbol-menu', 'symbol-menu'],
  ];

  menus.forEach(([buttonId, menuId]) => {
    const button = document.getElementById(buttonId);
    const menu = document.getElementById(menuId);
    if (!button || !menu) return;

    button.setAttribute('aria-controls', menuId);
    button.addEventListener('mousedown', rememberToolbarSelection);
    button.addEventListener('click', () => {
      const willOpen = menu.hidden;
      closeToolbarMenus(willOpen ? menu : null);
      menu.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
    });
  });

  document.querySelectorAll('#symbol-menu .symbol-btn').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const sym = button.dataset.symbol;
      if (sym) {
        if (/[αβγδεζηθικλμνξπρστυφχψω]/.test(sym) && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bupgreek\b[^}]*\}/.test(parsedDoc.preamble)) {
          setStatus('dirty', 'Upright Greek labels require \\usepackage{upgreek} in the LaTeX preamble.');
          closeToolbarMenus();
          return;
        }
        restoreToolbarSelection();
        document.execCommand('insertText', false, sym);
        markDirty();
      }
      closeToolbarMenus();
    });
  });

  document.querySelectorAll('#block-menu [data-block]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      applyBlockStyle(button.dataset.block || 'p');
      closeToolbarMenus();
    });
  });

  document.querySelectorAll('#color-menu [data-color]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      applyTextColor(button.dataset.color || 'black');
      closeToolbarMenus();
    });
  });

  document.querySelectorAll('#highlight-menu [data-highlight]').forEach(button => {
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      applyHighlight(button.dataset.highlight !== 'remove');
      closeToolbarMenus();
    });
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.toolbar-menu')) closeToolbarMenus();
  });
}

function applyTextColor(color) {
  restoreToolbarSelection();
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return;

  const range = selection.getRangeAt(0);
  const span = document.createElement('span');
  span.className = 'latex-color';
  span.style.color = color === 'blue' ? '#1976D2' : color === 'red' ? '#D32F2F' : '#000000';
  span.dataset.color = color === "blue" ? "1976D2" : color === "red" ? "D32F2F" : "000000";
  span.dataset.colorModel = "HTML";

  span.appendChild(range.extractContents());
  range.insertNode(span);

  // Restore selection
  selection.removeAllRanges();
  const newRange = document.createRange();
  newRange.selectNodeContents(span);
  selection.addRange(newRange);

  markDirty();
}

function applyHighlight(enabled) {
  restoreToolbarSelection();
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const element = node => node.nodeType === 1 ? node : node.parentElement;
  const block = node => element(node)?.closest('p,h1,h2,h3,h4,h5,h6,.float-caption-body');
  if (!elPaperCanvas.contains(range.commonAncestorContainer) || !block(range.startContainer) || block(range.startContainer) !== block(range.endContainer)) {
    setStatus('dirty', 'Select text within one paragraph or caption to highlight.');
    return;
  }
  if (enabled && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bsoul(?:utf8)?\b[^}]*\}|\\(?:newcommand|renewcommand|providecommand)\s*\{?\\hl\b/.test(parsedDoc.preamble)) {
    setStatus('dirty', 'Highlight requires \\usepackage{soul} in the LaTeX preamble.');
    return;
  }
  if (element(range.startContainer)?.closest('.latex-math') || element(range.endContainer)?.closest('.latex-math')) {
    setStatus('dirty', 'Select the whole math token from surrounding text to highlight it.');
    return;
  }
  // Split existing highlights at selection boundaries so removal affects only
  // the selected text, retaining nested bold/colour formatting on both sides.
  function splitBoundary(start) {
    const node = start ? range.startContainer : range.endContainer;
    const offset = start ? range.startOffset : range.endOffset;
    const mark = element(node)?.closest('mark.latex-highlight');
    if (!mark) return null;
    const tailRange = document.createRange();
    tailRange.selectNodeContents(mark);
    tailRange.setStart(node, offset);
    const tail = mark.cloneNode(false);
    tail.appendChild(tailRange.extractContents());
    mark.after(tail);
    if (start) range.setStartBefore(tail);
    else range.setEndBefore(tail);
    return tail;
  }
  recordCanvasHistory();
  const endTail = splitBoundary(false);
  splitBoundary(true);
  if (endTail) range.setEndBefore(endTail);
  const content = range.extractContents();
  content.querySelectorAll('mark.latex-highlight').forEach(mark => mark.replaceWith(...mark.childNodes));
  const span = document.createElement(enabled ? 'mark' : 'span');
  if (enabled) { span.className = 'latex-highlight'; span.dataset.latexCmd = 'hl'; }
  span.appendChild(content);
  range.insertNode(span);
  elPaperCanvas.querySelectorAll('mark.latex-highlight:empty').forEach(mark => mark.remove());
  selection.removeAllRanges();
  const selected = document.createRange();
  selected.selectNodeContents(span);
  selection.addRange(selected);
  toolbarSelectionRange = selected.cloneRange();
  markDirty();
}

// Global Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    clearTimeout(autoSaveTimer);
    saveDocument();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    triggerCompile();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    pastePlainTextFromClipboard();
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '.') {
    e.preventDefault();
    document.execCommand('superscript', false, null);
    markDirty();
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === ',') {
    e.preventDefault();
    document.execCommand('subscript', false, null);
    markDirty();
  }
});

let compileTimeout = null;

function startCompile() {
  if (isCompiling) return;
  isCompiling = true;
  buildingSource = serializeDocument(parsedDoc, elPaperCanvas);
  buildingMode = currentCitationMode;
  if (elBtnCompile) {
    elBtnCompile.classList.remove('success', 'error');
    elBtnCompile.classList.add('compiling');
    elBtnCompile.title = `Compiling (${currentCitationMode})...`;
  }
  if (elStatusText) elStatusText.textContent = `Compiling (${currentCitationMode})...`;

  clearTimeout(compileTimeout);
  compileTimeout = setTimeout(() => {
    if (isCompiling) {
      isCompiling = false;
      if (elBtnCompile) {
        elBtnCompile.classList.remove('compiling');
        elBtnCompile.classList.add('error');
        elBtnCompile.title = 'Compile timed out (Reload window if extension was updated)';
        setTimeout(() => {
          if (elBtnCompile) {
            elBtnCompile.classList.remove('error');
            elBtnCompile.title = 'Save and build PDF, DOCX and figures (Ctrl+Shift+B)';
          }
        }, 4000);
      }
      if (elStatusText) elStatusText.textContent = 'Reload window required';
      setTimeout(() => {
        if (!isDirty && elStatusText) elStatusText.textContent = buildStatus();
      }, 4000);
    }
  }, 180000);

  vscode.postMessage({
    command: 'compile',
    mode: currentCitationMode,
  });
}

function triggerCompile() {
  if (isCompiling || pendingCompile) return;
  if (isDirty) {
    pendingCompile = true;
    clearTimeout(autoSaveTimer);
    saveDocument();
    return;
  }
  startCompile();
}

// A selection that crosses an image carries its complete figure source.
const figureClipboardType = 'application/x-aspyrus-figure';
const legacyFigureClipboardType = 'application/x-localleaf-figure';
let figureClipboardSource = null;
let pendingFigureWrite = null;
let pendingFigurePaste = null;
let nextClipboardRequestId = 0;
function selectedFigure() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (range.startContainer !== range.endContainer || range.endOffset !== range.startOffset + 1) return null;
  const node = range.startContainer.childNodes[range.startOffset];
  return node?.classList?.contains('canvas-block') && node.querySelector('.latex-float-card') ? node : null;
}

function figureSource(element) {
  const original = element.dataset.figureSource
    ? parseDocument(element.dataset.figureSource).blocks.find((block) => block.hasCaption)
    : parsedDoc.blocks.find((block) => String(block.id) === element.dataset.blockId);
  if (!original) return '';
  return element.innerHTML === original.snapshot ? original.raw : serializeDomBlock(element, original);
}

function selectWholeFigure(figure) {
  const positions = [];
  for (let node = figure.parentElement; node; node = node.parentElement) {
    positions.push([node, node.scrollTop, node.scrollLeft]);
  }
  elPaperCanvas.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNode(figure);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  for (const [node, top, left] of positions) {
    node.scrollTop = top;
    node.scrollLeft = left;
  }
  refreshFigureSelection();
}

function refreshFigureSelection() {
  const figure = selectedFigure();
  elPaperCanvas.querySelectorAll('.figure-selected').forEach((node) => node.classList.remove('figure-selected'));
  if (figure) figure.classList.add('figure-selected');
}

function selectedFigureContent() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!elPaperCanvas.contains(range.startContainer) || !elPaperCanvas.contains(range.endContainer)) return null;
  const figures = [...elPaperCanvas.querySelectorAll('.canvas-block')].filter(node => {
    const preview = node.querySelector('.float-image-preview');
    return preview && range.intersectsNode(preview);
  });
  const whole = selectedFigure();
  if (whole && !figures.includes(whole)) figures.push(whole);
  if (!figures.length) return null; // Caption-only selections keep native text copy.
  for (const figure of figures) {
    if (figure.contains(range.startContainer)) range.setStartBefore(figure);
    if (figure.contains(range.endContainer)) range.setEndAfter(figure);
  }
  const source = selectionSource(range);
  return source ? { range, source, figure: whole, revision: editRevision } : null;
}

function selectionSource(range) {
  let result = '';
  for (const node of elPaperCanvas.childNodes) {
    if (node.hidden || !range.intersectsNode(node)) continue;
    const block = parsedDoc.blocks.find(b => String(b.id) === node.dataset?.blockId);
    if (block?.isTitle) continue;
    const bounds = document.createRange();
    bounds.selectNode(node);
    const clipped = range.cloneRange();
    if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) clipped.setStartBefore(node);
    if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) clipped.setEndAfter(node);
    if (clipped.collapsed) continue;
    if (node.querySelector?.('.latex-float-card')) result += figureSource(node) + '\n\n';
    else if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) === 0 && clipped.compareBoundaryPoints(Range.END_TO_END, bounds) === 0 && block && node.innerHTML === block.snapshot) result += block.raw;
    else {
      const wrapper = document.createElement('div');
      wrapper.appendChild(clipped.cloneContents());
      result += serializeDomBlock(wrapper);
    }
  }
  return result;
}

function removeSelectedContent(operation) {
  if (operation.figure) return removeFigureBlock(operation.figure);
  operation.range.deleteContents();
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(operation.range);
  markDirty();
  return true;
}

function copyFigure(cut) {
  const selected = selectedFigureContent();
  if (!selected || !vscode) return;
  if (pendingFigureWrite) {
    setStatus(isDirty ? 'dirty' : 'saved', 'Clipboard operation in progress');
    return;
  }
  const { source } = selected;
  const requestId = ++nextClipboardRequestId;
  pendingFigureWrite = { ...selected, cut, requestId };
  vscode.postMessage({ command: 'figureClipboardWrite', content: source, requestId });
}

function pasteFigure() {
  const selection = window.getSelection();
  if (!vscode || !selection?.rangeCount || !elPaperCanvas.contains(selection.anchorNode)) return;
  pendingFigurePaste = { range: selection.getRangeAt(0).cloneRange(), requestId: ++nextClipboardRequestId };
  // A paste must not race the clipboard write or removal of the cut block.
  if (!pendingFigureWrite) requestFigurePaste();
}

function requestFigurePaste() {
  vscode.postMessage({ command: 'figureClipboardRead', requestId: pendingFigurePaste.requestId });
}

window.addEventListener('keydown', (event) => {
  if (!elPaperCanvas.contains(document.activeElement)) return;
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if ((key === 'x' || key === 'c') && selectedFigureContent() && vscode) {
    event.preventDefault();
    event.stopImmediatePropagation();
    copyFigure(key === 'x');
  } else if (key === 'v' && (figureClipboardSource || pendingFigureWrite) && vscode) {
    event.preventDefault();
    event.stopImmediatePropagation();
    pasteFigure();
  }
}, true);

// Use the same figure transaction for right-click and keyboard operations.
const figureMenu = document.createElement('div');
figureMenu.className = 'figure-context-menu';
figureMenu.setAttribute('role', 'menu');
figureMenu.hidden = true;
document.body.appendChild(figureMenu);
function hideFigureMenu() { figureMenu.hidden = true; }
figureMenu.addEventListener('mousedown', (event) => event.preventDefault());
for (const [label, action] of [
  ['Cut figure', () => copyFigure(true)],
  ['Copy figure', () => copyFigure(false)],
  ['Paste figure', pasteFigure],
  ['Paste as plain text', pastePlainTextFromClipboard],
]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('role', 'menuitem');
  button.addEventListener('click', () => { hideFigureMenu(); action(); });
  figureMenu.appendChild(button);
}
elPaperCanvas.addEventListener('contextmenu', (event) => {
  hideFigureMenu();
  const selection = window.getSelection();
  const wholeFigure = selectedFigure();
  const preview = event.target.closest('.float-image-preview');

  // Track the exact click position for paste operations
  if (document.caretRangeFromPoint) {
    const ptRange = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (ptRange && elPaperCanvas.contains(ptRange.startContainer)) {
      if (!selection || !selection.rangeCount || selection.isCollapsed || (selection.getRangeAt(0).isPointInRange && !selection.getRangeAt(0).isPointInRange(ptRange.startContainer, ptRange.startOffset))) {
        selection.removeAllRanges();
        selection.addRange(ptRange);
      }
    }
  }
  if (selection && selection.rangeCount && elPaperCanvas.contains(selection.anchorNode)) {
    lastContextCaretRange = selection.getRangeAt(0).cloneRange();
  }

  // Text selection (including captions) owns the native Cut/Copy/Paste menu.
  if (selection?.rangeCount && !selection.isCollapsed && !wholeFigure) {
    const cardBlock = preview?.closest('.canvas-block');
    const range = selection.getRangeAt(0);
    if (!cardBlock || !cardBlock.contains(range.startContainer) || !cardBlock.contains(range.endContainer)) return;
  }
  const card = preview?.closest('.latex-float-card')
    || (wholeFigure?.contains(event.target) ? wholeFigure.querySelector('.latex-float-card') : null);
  if (!card && (event.target.closest('.float-caption-body') || !figureClipboardSource)) return;
  event.preventDefault();
  event.stopPropagation();
  if (card) selectWholeFigure(card.closest('.canvas-block'));
  else {
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && elPaperCanvas.contains(range.startContainer)) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  figureMenu.children[0].hidden = !card;
  figureMenu.children[1].hidden = !card;
  figureMenu.children[2].hidden = !figureClipboardSource || Boolean(card);
  figureMenu.children[3].hidden = false;
  figureMenu.hidden = false;
  const bounds = figureMenu.getBoundingClientRect();
  figureMenu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - bounds.width))}px`;
  figureMenu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - bounds.height))}px`;
});
document.addEventListener('mousedown', (event) => { if (!figureMenu.contains(event.target)) hideFigureMenu(); });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideFigureMenu(); });

if (elPaperCanvas) {
  let dragStart = null;
  elPaperCanvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    dragStart = { y: event.clientY };
    const preview = event.target.closest('.float-image-preview');
    if (!preview || event.shiftKey) return;
    event.preventDefault();
    selectWholeFigure(preview.closest('.canvas-block'));
  });
  document.addEventListener('mouseup', (event) => {
    if (!dragStart) return;
    const start = dragStart;
    dragStart = null;
    if (Math.abs(start.y - event.clientY) < 4) return;
    const selected = selectedFigureContent();
    if (selected) {
      const selection = window.getSelection();
      const backwards = selection.anchorNode === selection.getRangeAt(0).endContainer && selection.anchorOffset === selection.getRangeAt(0).endOffset;
      selection.removeAllRanges();
      selection.addRange(selected.range);
      if (backwards && selection.setBaseAndExtent) selection.setBaseAndExtent(selected.range.endContainer, selected.range.endOffset, selected.range.startContainer, selected.range.startOffset);
      refreshFigureSelection();
    }
  });
  document.addEventListener('selectionchange', refreshFigureSelection);

  for (const type of ['copy', 'cut']) {
    elPaperCanvas.addEventListener(type, (event) => {
      const selected = selectedFigureContent();
      if (!selected) {
        figureClipboardSource = null;
        return;
      }
      if (!event.clipboardData) return;
      const { source } = selected;
      if (!source) return;
      event.preventDefault();
      event.clipboardData.setData(figureClipboardType, source);
      event.clipboardData.setData(legacyFigureClipboardType, source);
      event.clipboardData.setData('text/plain', source);
      const payload = document.createElement('div');
      payload.dataset.aspyrusFigure = source;
      payload.dataset.localleafFigure = source;
      event.clipboardData.setData('text/html', payload.outerHTML);
      figureClipboardSource = source;
      if (type === 'cut') removeSelectedContent(selected);
    });
  }

  elPaperCanvas.addEventListener('paste', (event) => {
    let source = event.clipboardData?.getData(figureClipboardType) || event.clipboardData?.getData(legacyFigureClipboardType);
    if (!source) {
      const html = event.clipboardData?.getData('text/html') || '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      source = doc.querySelector('[data-aspyrus-figure]')?.dataset.aspyrusFigure || doc.querySelector('[data-localleaf-figure]')?.dataset.localleafFigure;
    }
    if (!source) {
      const plain = event.clipboardData?.getData('text/plain') || '';
      // VS Code's clipboard bridge transfers plain text between webviews.
      // Accept complete figure environments, never partial macros or a document.
      if (isFigureFragment(plain)) source = plain;
    }
    if (!source) {
      if (event.shiftKey) {
        const plain = event.clipboardData?.getData('text/plain');
        if (typeof plain === 'string') {
          event.preventDefault();
          insertPlainText(plain);
        }
      }
      return;
    }
    event.preventDefault();
    insertFigureSource(source);
  });

  elPaperCanvas.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const selection = window.getSelection();
      if (!selection?.anchorNode) return;
      const anchor = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
      const captionBody = anchor.closest('.float-caption-body');
      if (captionBody) {
        if (event.shiftKey) return; // Shift+Enter allows newline inside caption
        event.preventDefault();
        const cardBlock = captionBody.closest('.canvas-block');
        if (!cardBlock) return;

        let nextBlock = cardBlock.nextElementSibling;
        while (nextBlock && nextBlock.hidden) {
          nextBlock = nextBlock.nextElementSibling;
        }

        if (nextBlock && nextBlock.classList.contains('canvas-block') && !nextBlock.querySelector('.latex-float-card')) {
          const target = nextBlock.querySelector('p, h2, h3, h4, h5') || nextBlock;
          const range = document.createRange();
          range.setStart(target, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else {
          const newWrapper = document.createElement('div');
          newWrapper.className = 'canvas-block';
          const p = document.createElement('p');
          p.className = 'latex-paragraph';
          p.appendChild(document.createElement('br'));
          newWrapper.appendChild(p);
          cardBlock.after(newWrapper);

          const range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          markDirty();
        }
        return;
      }
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const selected = selectedFigureContent();
    if (selected) {
      event.preventDefault();
      removeSelectedContent(selected);
      return;
    }
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    const anchor = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    const heading = anchor.closest('h2, h3, h4, h5');
    if (!heading || heading.textContent.replace(/\u200b/g, '').trim()) return;
    event.preventDefault();
    // Keep a normal editable line at this position, with native undo support.
    if (document.execCommand('formatBlock', false, 'p')) markDirty();
  });
}

function removeFigureBlock(figure) {
  if (!figure || !elPaperCanvas.contains(figure)) return false;
  const placeholder = document.createElement('p');
  placeholder.appendChild(document.createElement('br'));
  figure.replaceWith(placeholder);
  const range = document.createRange();
  range.setStart(placeholder, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  if (figure.isConnected) return false;
  markDirty();
  return true;
}

function isFigureFragment(source) {
  if (!source || /\\(?:documentclass|begin\{document\}|end\{document\})/.test(source)) return false;
  const begins = source.match(/\\begin\{figure\*?\}/g) || [];
  const ends = source.match(/\\end\{figure\*?\}/g) || [];
  return begins.length > 0 && begins.length === ends.length && parseDocument(source).blocks.some(block => block.hasCaption && block.imagePath);
}

function insertFigureSource(source) {
  if (!isFigureFragment(source)) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !elPaperCanvas.contains(selection.anchorNode)) return false;
  let anchor = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
  if (anchor.closest('.float-caption-body')) {
    setStatus(isDirty ? 'dirty' : 'saved', 'Figure paste needs a position outside a caption');
    return false;
  }
  const caret = selection.getRangeAt(0).cloneRange();
  if (!caret.collapsed) {
    setStatus(isDirty ? 'dirty' : 'saved', 'Figure paste needs a destination caret');
    return false;
  }
  const fragment = document.createDocumentFragment();
  const parsed = parseDocument(source, { fileName: currentFileName });
  for (const block of parsed.blocks) {
    const wrapper = createBlockElement(block);
    wrapper.removeAttribute('data-block-id');
    wrapper.querySelectorAll('[data-block-id]').forEach(node => node.removeAttribute('data-block-id'));
    wrapper.dataset.clipboardSource = block.raw;
    if (block.hasCaption) wrapper.dataset.figureSource = block.raw;
    wrapper.dataset.clipboardSnapshot = wrapper.innerHTML;
    fragment.appendChild(wrapper);
  }
  const inserted = [...fragment.children];
  const last = fragment.lastChild;
  // Lift insertion to canvas level, splitting all surrounding prose wrappers.
  let top = anchor;
  while (top.parentElement && top.parentElement !== elPaperCanvas) top = top.parentElement;
  if (top !== elPaperCanvas && top.parentElement === elPaperCanvas) {
    if (top.querySelector('[data-cmd="title"]')) {
      const blank = [...elPaperCanvas.children].find(node => node.tagName === 'P' && !node.textContent.trim());
      if (blank) blank.before(fragment); else top.after(fragment);
    } else {
      const tail = caret.cloneRange();
      tail.setEnd(top, top.childNodes.length);
      const after = top.cloneNode(false);
      after.removeAttribute('data-block-id');
      after.removeAttribute('data-clipboard-source');
      after.removeAttribute('data-clipboard-snapshot');
      after.appendChild(tail.extractContents());
      top.after(fragment, after);
    }
  } else caret.insertNode(fragment);
  const figures = parseDocument(serializeDocument(parsedDoc, elPaperCanvas), { fileName: currentFileName }).blocks.filter(item => item.hasCaption);
  elPaperCanvas.querySelectorAll('.float-caption-prefix').forEach((prefix, index) => {
    if (figures[index]) prefix.textContent = figures[index].captionPrefix;
  });
  updateReferencesDisplay();
  for (const wrapper of inserted) wrapper.dataset.clipboardSnapshot = wrapper.innerHTML;
  const afterRange = document.createRange();
  afterRange.setStartAfter(last);
  afterRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(afterRange);
  markDirty();
  vscode?.postMessage({ command: 'resolveFigurePreviews', content: serializeDocument(parsedDoc, elPaperCanvas), revision: editRevision });
  setStatus('dirty', 'Figure content pasted — Ctrl+S to save');
  return true;
}

function isTableFragment(source) {
  if (!source || /\\(?:documentclass|begin\{document\}|end\{document\})/.test(source)) return false;
  const begins = source.match(/\\begin\{(?:table\*?|tabular\*?|tabularx|longtable)\}/g) || [];
  const ends = source.match(/\\end\{(?:table\*?|tabular\*?|tabularx|longtable)\}/g) || [];
  return begins.length > 0 && begins.length === ends.length;
}

function insertTableSource(source) {
  if (!isTableFragment(source)) return false;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !elPaperCanvas.contains(selection.anchorNode)) return false;
  let anchor = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
  if (anchor.closest('.float-caption-body, .latex-table')) {
    setStatus(isDirty ? 'dirty' : 'saved', 'Table insertion needs a position outside floats');
    return false;
  }
  const caret = selection.getRangeAt(0).cloneRange();
  const fragment = document.createDocumentFragment();
  const parsed = parseDocument(source, { fileName: currentFileName });
  for (const block of parsed.blocks) {
    const wrapper = createBlockElement(block);
    wrapper.removeAttribute('data-block-id');
    wrapper.querySelectorAll('[data-block-id]').forEach(node => node.removeAttribute('data-block-id'));
    wrapper.dataset.clipboardSource = block.raw;
    if (block.hasCaption) wrapper.dataset.figureSource = block.raw;
    wrapper.dataset.clipboardSnapshot = wrapper.innerHTML;
    fragment.appendChild(wrapper);
  }
  const inserted = [...fragment.children];
  const last = fragment.lastChild;
  // Lift insertion to canvas level, splitting all surrounding prose wrappers.
  let top = anchor;
  while (top.parentElement && top.parentElement !== elPaperCanvas) top = top.parentElement;
  if (top !== elPaperCanvas && top.parentElement === elPaperCanvas) {
    if (top.querySelector('[data-cmd="title"]')) {
      const blank = [...elPaperCanvas.children].find(node => node.tagName === 'P' && !node.textContent.trim());
      if (blank) blank.before(fragment); else top.after(fragment);
    } else {
      const tail = caret.cloneRange();
      tail.setEnd(top, top.childNodes.length);
      const after = top.cloneNode(false);
      after.removeAttribute('data-block-id');
      after.removeAttribute('data-clipboard-source');
      after.removeAttribute('data-clipboard-snapshot');
      after.appendChild(tail.extractContents());
      top.after(fragment, after);
    }
  } else caret.insertNode(fragment);

  const parsedAll = parseDocument(serializeDocument(parsedDoc, elPaperCanvas), { fileName: currentFileName });
  const floats = parsedAll.blocks.filter(item => item.hasCaption);
  elPaperCanvas.querySelectorAll('.latex-float-card').forEach((card, index) => {
    const prefix = card.querySelector('.float-caption-prefix');
    if (prefix && floats[index]) prefix.textContent = floats[index].captionPrefix;
  });
  updateReferencesDisplay();
  for (const wrapper of inserted) wrapper.dataset.clipboardSnapshot = wrapper.innerHTML;
  const afterRange = document.createRange();
  afterRange.setStartAfter(last);
  afterRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(afterRange);
  markDirty();
  setStatus('dirty', 'Table inserted — Ctrl+S to save');
  return true;
}

// Table cell keyboard navigation (Tab / Shift+Tab)
if (elPaperCanvas) {
  elPaperCanvas.addEventListener('keydown', (e) => {
    const target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    const cell = target?.closest('th, td');
    if (!cell) return;
    const table = cell.closest('table.latex-table');
    if (!table) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      const allCells = [...table.querySelectorAll('th, td')];
      const currentIndex = allCells.indexOf(cell);
      if (currentIndex >= 0) {
        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + allCells.length) % allCells.length
          : (currentIndex + 1) % allCells.length;
        allCells[nextIndex].focus();
        const sel = window.getSelection();
        sel.selectAllChildren(allCells[nextIndex]);
      }
    }
  });
}

function restoreCaptionEditing() {
  elPaperCanvas.querySelectorAll('.float-caption-body').forEach((caption) => {
    caption.contentEditable = 'true';
  });
}

// Canvas input listener
if (elPaperCanvas) {
  elPaperCanvas.addEventListener('input', () => {
    restoreCaptionEditing();
    const currentSig = getCitationsSignature();
    if (currentSig !== lastCitationsSignature) {
      lastCitationsSignature = currentSig;
      updateCitationsDisplay(true);
    }
    markDirty();
  });
}

if (elBtnSave) {
  elBtnSave.addEventListener('click', () => {
    clearTimeout(autoSaveTimer);
    saveDocument();
  });
}

if (elBtnCompile) {
  elBtnCompile.addEventListener('click', () => {
    triggerCompile();
  });
}

// Draft recovery is separate from writing the manuscript.
function checkpointDraft() {
  if (isDirty && parsedDoc && vscode) {
    vscode.postMessage({ command: 'checkpoint', content: serializeDocument(parsedDoc, elPaperCanvas) });
  }
}
window.addEventListener('blur', checkpointDraft);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) checkpointDraft();
});


// Citation mode controls
function setCitationMode(mode) {
  if (!['numbers', 'keys', 'dois'].includes(mode)) return;
  currentCitationMode = mode;
  const citeModeTrigger = document.getElementById('btn-cite-mode-menu');
  const btnNum = document.getElementById('btn-mode-num');
  const btnKey = document.getElementById('btn-mode-key');
  const btnDoi = document.getElementById('btn-mode-doi');
  const allBtns = [btnNum, btnKey, btnDoi].filter(Boolean);

  if (citeModeTrigger) {
    const numSymbol = bibContext.isSuperscript ? '¹²³' : '[1]';
    const symbols = { numbers: numSymbol, keys: '@', dois: 'DOI' };
    const descriptions = { numbers: 'numbers', keys: 'BibTeX key', dois: 'DOI' };
    citeModeTrigger.textContent = symbols[mode];
    citeModeTrigger.title = `Citation display: ${descriptions[mode]}`;
  }
  allBtns.forEach((b) => b.classList.remove('active'));
  if (mode === 'numbers' && btnNum) btnNum.classList.add('active');
  if (mode === 'keys' && btnKey) btnKey.classList.add('active');
  if (mode === 'dois' && btnDoi) btnDoi.classList.add('active');
  updateCitationsDisplay();
  if (!isDirty && elStatusText) elStatusText.textContent = buildStatus();
  if (vscode && typeof vscode.getState === 'function' && typeof vscode.setState === 'function') {
    try {
      const state = vscode.getState() || {};
      vscode.setState({ ...state, citationMode: mode });
    } catch {}
  }
}

function setupCitationModeButtons() {
  const btnNum = document.getElementById('btn-mode-num');
  const btnKey = document.getElementById('btn-mode-key');
  const btnDoi = document.getElementById('btn-mode-doi');
  const btnRefreshCites = document.getElementById('btn-refresh-citations');

  if (btnNum) btnNum.addEventListener('click', () => setCitationMode('numbers'));
  if (btnKey) btnKey.addEventListener('click', () => setCitationMode('keys'));
  if (btnDoi) btnDoi.addEventListener('click', () => setCitationMode('dois'));

  if (btnRefreshCites) {
    btnRefreshCites.addEventListener('mousedown', (e) => e.preventDefault());
    btnRefreshCites.addEventListener('click', () => {
      updateCitationsDisplay(true);
      markDirty();
      setStatus('saved', 'References refreshed and renumbered');
    });
  }

  document.querySelectorAll('#cite-mode-menu [data-cite-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setCitationMode(button.dataset.citeMode || 'numbers');
      closeToolbarMenus();
    });
  });
}

// Inbound messages from VS Code extension
window.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  switch (message.command) {
    case 'requestRestore':
      if (parsedDoc) vscode?.postMessage({ command: 'restore', content: serializeDocument(parsedDoc, elPaperCanvas) });
      break;
    case 'init': {
      if (elFileName && message.fileName) {
        elFileName.textContent = message.fileName;
      }
      currentFileName = message.fileName || '';
      bibContext = message.bibContext || bibContext;
      figureUris = message.figureUris || {};
      if (message.projectImages) cachedProjectImages = message.projectImages;
      const savedState = (vscode && typeof vscode.getState === 'function') ? vscode.getState() : null;
      const initialMode = message.mode || savedState?.citationMode || 'numbers';
      renderDocument(message.content || '');
      setCitationMode(initialMode);
      if (vscode && message.filePath && typeof vscode.setState === 'function') {
        try {
          vscode.setState({ filePath: message.filePath, fileName: message.fileName, citationMode: initialMode });
        } catch {}
      }
      break;
    }
    case 'projectImages': {
      cachedProjectImages = message.images || [];
      if (typeof renderProjectImages === 'function') {
        renderProjectImages(cachedProjectImages);
      }
      break;
    }
    case 'imagePicked': {
      if (typeof handleImagePicked === 'function') {
        handleImagePicked(message.imagePath, message.webviewUri);
      }
      break;
    }
    case 'saveSuccess': {
      if (!inFlightSave || message.saveId !== inFlightSave.id) break;
      const savedRevision = inFlightSave.revision;
      inFlightSave = null;
      if (editRevision !== savedRevision) {
        clearTimeout(autoSaveTimer);
        isDirty = true;
        setStatus('dirty', 'Unsaved edits');
        if (pendingCompile) saveDocument();
        else checkpointDraft();
        break;
      }
      isDirty = false;
      setStatus('saved', 'Saved — ' + buildStatus());
      if (message.bibContext) {
        bibContext = message.bibContext;
        updateCitationsDisplay();
      }
      // Keep raw source and its original DOM snapshot paired. Updating just
      // the snapshot makes a later save restore the pre-edit raw source.
      // Keeping the baseline also preserves native selection and undo history.
      if (pendingCompile) {
        pendingCompile = false;
        startCompile();
      }
      break;
    }
    case 'refreshAssets': {
      builtSource = null;
      vscode?.postMessage({command: 'resolveFigurePreviews', content: serializeDocument(parsedDoc, elPaperCanvas), revision: editRevision});
      if (!isDirty && !isCompiling) setStatus('saved', 'Assets changed — compile to update outputs');
      break;
    }
    case 'figurePreviews': {
      if (message.revision !== editRevision) break;
      figureUris = message.figureUris || {};
      for (const preview of elPaperCanvas.querySelectorAll('.float-image-preview')) {
        const uri = figureUris[preview.dataset.imagePath];
        if (uri ? preview.querySelector('img')?.getAttribute('src') === uri : !preview.querySelector('img')) continue;
        const wrapper = preview.closest('.canvas-block');
        const original = parsedDoc.blocks.find(block => String(block.id) === wrapper?.dataset.blockId);
        const pristine = wrapper?.innerHTML === wrapper?.dataset.clipboardSnapshot;
        const originalPristine = original && wrapper.innerHTML === original.snapshot;
        const img = document.createElement('img');
        img.className = 'float-image'; img.src = uri; img.draggable = false;
        img.alt = 'Figure preview';
        if (uri) preview.replaceChildren(img);
        else { const fallback = document.createElement('span'); fallback.textContent = 'Figure preview unavailable'; preview.replaceChildren(fallback); }
        if (pristine) wrapper.dataset.clipboardSnapshot = wrapper.innerHTML;
        if (originalPristine) original.snapshot = wrapper.innerHTML;
      }
      if (historyIndex >= 0) canvasHistory[historyIndex] = canvasSnapshot();
      break;
    }
    case 'figureClipboardWritten': {
      const operation = pendingFigureWrite;
      if (!operation || message.requestId !== operation.requestId) break;
      pendingFigureWrite = null;
      figureClipboardSource = operation.source;
      if (operation.cut) {
        if (operation.revision !== editRevision || (operation.figure ? !operation.figure.isConnected || figureSource(operation.figure).trimEnd() !== operation.source.trimEnd() : selectionSource(operation.range) !== operation.source)) {
          pendingFigurePaste = null;
          figureClipboardSource = null;
          setStatus(isDirty ? 'dirty' : 'saved', 'Figure changed — select it and cut again');
          break;
        }
        if (!removeSelectedContent(operation)) {
          pendingFigurePaste = null;
          figureClipboardSource = null;
          setStatus(isDirty ? 'dirty' : 'saved', 'Figure could not be cut');
          break;
        }
        setStatus('dirty', 'Figure cut — choose a position and paste');
      } else {
        setStatus(isDirty ? 'dirty' : 'saved', 'Figure copied — choose a position and paste');
      }
      if (pendingFigurePaste) requestFigurePaste();
      break;
    }
    case 'figureClipboardRead': {
      if (!pendingFigurePaste || message.requestId !== pendingFigurePaste.requestId) break;
      const { range } = pendingFigurePaste;
      pendingFigurePaste = null;
      if (!elPaperCanvas.contains(range.startContainer)) break;
      elPaperCanvas.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (isFigureFragment(message.content)) insertFigureSource(message.content);
      else {
        figureClipboardSource = null;
        if (document.execCommand('insertText', false, message.content || '')) markDirty();
      }
      break;
    }
    case 'figureClipboardError': {
      if (message.requestId !== pendingFigureWrite?.requestId && message.requestId !== pendingFigurePaste?.requestId) break;
      pendingFigureWrite = null;
      pendingFigurePaste = null;
      setStatus(isDirty ? 'dirty' : 'saved', 'Clipboard operation failed');
      break;
    }
    case 'recoveryError': {
      setStatus('dirty', 'Recovery unavailable — save your work');
      break;
    }
    case 'saveError': {
      if (!inFlightSave || message.saveId !== inFlightSave.id) break;
      inFlightSave = null;
      pendingCompile = false;
      isDirty = true;
      setStatus('dirty', 'Error saving');
      break;
    }
    case 'compileResult': {
      clearTimeout(compileTimeout);
      isCompiling = false;
      if (elBtnCompile) {
        elBtnCompile.classList.remove('compiling');
      }
      if (message.success) {
        builtSource = buildingSource;
        builtMode = buildingMode;
        if (elBtnCompile) {
          elBtnCompile.classList.add('success');
          elBtnCompile.title = message.message || `Compiled (${currentCitationMode}) ✓`;
          setTimeout(() => {
            if (elBtnCompile) {
              elBtnCompile.classList.remove('success');
              elBtnCompile.title = 'Save and build PDF, DOCX and figures (Ctrl+Shift+B)';
            }
          }, 2500);
        }
        if (elStatusText) elStatusText.textContent = isDirty || buildingSource !== serializeDocument(parsedDoc, elPaperCanvas) || buildingMode !== currentCitationMode ? 'Changes since last build' : (message.message || 'Compiled ✓');
        if (message.bibContext) {
          bibContext = message.bibContext;
          updateCitationsDisplay();
        }
        setTimeout(() => {
          if (!isDirty && !isCompiling && elStatusText) elStatusText.textContent = buildStatus();
        }, 3000);
      } else {
        if (elBtnCompile) {
          elBtnCompile.classList.add('error');
          elBtnCompile.title = message.message || 'Compile failed';
          setTimeout(() => {
            if (elBtnCompile) {
              elBtnCompile.classList.remove('error');
              elBtnCompile.title = 'Save and build PDF, DOCX and figures (Ctrl+Shift+B)';
            }
          }, 3500);
        }
        if (elStatusText) elStatusText.textContent = message.message || 'Build failed';
        setTimeout(() => {
          if (!isDirty && !isCompiling && elStatusText) elStatusText.textContent = buildStatus();
        }, 4000);
      }
      break;
    }
    case 'externalUpdate': {
      checkpointDraft();
      if (message.fileName) currentFileName = message.fileName;
      bibContext = message.bibContext || bibContext;
      // LaTeX source is authoritative. A genuine raw-editor change must
      // replace even a stale/dirty canvas, otherwise Ctrl+S can restore DOM
      // blocks that no longer exist in the source.
      clearTimeout(autoSaveTimer);
      if (message.figureUris) figureUris = message.figureUris;
      renderDocument(message.content || '');
      setStatus('saved', 'Updated from TeX — ' + buildStatus());
      break;
    }
    case 'clipboardPlainText': {
      insertPlainText(message.text || '');
      break;
    }
  }
});

// Citation Modal / Picker Controller
function setupCitationModal() {
  const elBtnAddCitation = document.getElementById('btn-add-citation');
  const elModal = document.getElementById('cite-modal');
  const elModalTitle = document.getElementById('cite-modal-title');
  const elBtnCloseModal = document.getElementById('btn-close-modal');
  const elBtnCancelModal = document.getElementById('btn-cancel-modal');
  const elBtnConfirmCite = document.getElementById('btn-confirm-cite');
  const elCurrentKeysSection = document.getElementById('current-keys-section');
  const elCurrentKeysList = document.getElementById('current-keys-list');
  const elSearchInput = document.getElementById('cite-search-input');
  const elResultsList = document.getElementById('citation-results-list');

  if (!elModal || !elSearchInput || !elResultsList) return;

  let editingCiteNode = null;
  let editingKeys = [];
  let selectedResultKey = null;
  let savedCaretRange = null;

  function openCitationModal(targetNode = null) {
    editingCiteNode = targetNode;
    selectedResultKey = null;

    if (targetNode) {
      elModalTitle.textContent = 'Edit Citation';
      elBtnConfirmCite.textContent = 'Update Citation';
      const rawKeys = targetNode.dataset.keys || '';
      editingKeys = rawKeys.split(',').map((k) => k.trim()).filter(Boolean);
      elCurrentKeysSection.style.display = 'block';
      renderCurrentKeys();
      elBtnConfirmCite.disabled = false;
    } else {
      elModalTitle.textContent = 'Insert Citation';
      elBtnConfirmCite.textContent = 'Insert Citation';
      editingKeys = [];
      elCurrentKeysSection.style.display = 'none';
      elBtnConfirmCite.disabled = true;

      if (!savedCaretRange) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && elPaperCanvas.contains(sel.anchorNode)) {
          savedCaretRange = sel.getRangeAt(0).cloneRange();
        } else {
          savedCaretRange = null;
        }
      }
    }

    elSearchInput.value = '';
    renderResults('');
    elModal.style.display = 'flex';
    setTimeout(() => elSearchInput.focus(), 60);
  }

  function closeCitationModal() {
    elModal.style.display = 'none';
    editingCiteNode = null;
    savedCaretRange = null;
    selectedResultKey = null;
    editingKeys = [];
  }

  function renderCurrentKeys() {
    elCurrentKeysList.replaceChildren();
    if (editingKeys.length === 0) {
      const emptySpan = document.createElement('span');
      emptySpan.style.fontSize = '12px';
      emptySpan.style.color = 'var(--text-muted)';
      emptySpan.textContent = '(No references remaining - citation badge will be removed)';
      elCurrentKeysList.appendChild(emptySpan);
      return;
    }

    for (let i = 0; i < editingKeys.length; i++) {
      const key = editingKeys[i];
      const m = bibContext.metaMap && bibContext.metaMap[key];
      const chip = document.createElement('div');
      chip.className = 'current-key-chip';
      chip.title = m?.title || key;

      const label = document.createElement('span');
      label.textContent = m?.author
        ? `${m.author.split(' ')[0]} (${m.year || 'n.d.'}) - ${key}`
        : key;
      chip.appendChild(label);

      const btnRemove = document.createElement('span');
      btnRemove.className = 'chip-remove-btn';
      btnRemove.innerHTML = '&times;';
      btnRemove.title = `Remove ${key}`;
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        editingKeys.splice(i, 1);
        renderCurrentKeys();
      });
      chip.appendChild(btnRemove);

      elCurrentKeysList.appendChild(chip);
    }
  }

  function renderResults(query) {
    elResultsList.replaceChildren();
    const q = (query || '').trim().toLowerCase();
    const allEntries = Object.values(bibContext.metaMap || {});

    let matches = [];
    if (!q) {
      matches = allEntries.slice(0, 25);
    } else {
      matches = allEntries
        .filter((m) => {
          return (
            m.key.toLowerCase().includes(q) ||
            (m.title && m.title.toLowerCase().includes(q)) ||
            (m.author && m.author.toLowerCase().includes(q)) ||
            (m.doi && m.doi.toLowerCase().includes(q)) ||
            (m.year && m.year.includes(q))
          );
        })
        .slice(0, 30);
    }

    if (matches.length === 0 && q) {
      const item = document.createElement('div');
      item.className = 'cite-result-item';
      item.innerHTML = `
        <div class="cite-result-title">+ Add "<strong>${escapeHtml(query.trim())}</strong>" as custom CiteKey or DOI</div>
        <div class="cite-result-meta">Manual reference entry</div>
      `;
      item.addEventListener('click', () => {
        selectResult(query.trim());
        if (editingCiteNode) {
          elSearchInput.value = '';
          renderResults('');
        } else {
          confirmCitationModal();
        }
      });
      elResultsList.appendChild(item);
      return;
    }

    for (const m of matches) {
      const item = document.createElement('div');
      item.className =
        'cite-result-item' + (selectedResultKey === m.key ? ' selected' : '');
      const authorYear = [m.author, m.year].filter(Boolean).join(', ');
      item.innerHTML = `
        <div class="cite-result-title">${m.title ? escapeHtml(m.title) : escapeHtml(m.key)}</div>
        <div class="cite-result-meta">${authorYear ? escapeHtml(authorYear) + ' &bull; ' : ''}<code>${escapeHtml(m.key)}</code>${m.doi ? ' &bull; DOI: ' + escapeHtml(m.doi) : ''}</div>
      `;

      item.addEventListener('click', () => {
        selectResult(m.key);
      });

      item.addEventListener('dblclick', () => {
        selectResult(m.key);
        confirmCitationModal();
      });

      elResultsList.appendChild(item);
    }
  }

  function selectResult(key) {
    if (editingCiteNode) {
      if (!editingKeys.includes(key)) {
        editingKeys.push(key);
        renderCurrentKeys();
        elSearchInput.value = '';
        renderResults('');
      }
    } else {
      selectedResultKey = key;
      elBtnConfirmCite.disabled = false;
      for (const child of elResultsList.children) {
        child.classList.toggle(
          'selected',
          child.innerHTML.includes(escapeHtml(key)),
        );
      }
    }
  }

  function confirmCitationModal() {
    if (editingCiteNode) {
      if (editingKeys.length === 0) {
        editingCiteNode.remove();
      } else {
        const keysStr = editingKeys.join(',');
        const isRev = editingCiteNode.dataset.latex?.startsWith('\\revref');
        editingCiteNode.dataset.keys = keysStr;
        editingCiteNode.dataset.latex = isRev
          ? `\\revref{${keysStr}}`
          : `\\cite{${keysStr}}`;
      }
      updateCitationsDisplay(true);
      clearTimeout(autoSaveTimer);
      checkpointDraft();
      closeCitationModal();
    } else {
      if (!selectedResultKey) return;
      const macro = 'cite';

      const span = document.createElement('span');
      span.className = 'latex-token latex-cite';
      span.contentEditable = 'false';
      span.dataset.keys = selectedResultKey;
      span.dataset.latex = `\\${macro}{${selectedResultKey}}`;
      span.textContent = `[${selectedResultKey}]`;

      if (savedCaretRange && elPaperCanvas.contains(savedCaretRange.startContainer)) {
        savedCaretRange.deleteContents();
        savedCaretRange.insertNode(span);
        const sel = window.getSelection();
        if (sel) {
          const afterRange = document.createRange();
          afterRange.setStartAfter(span);
          afterRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(afterRange);
        }
      } else {
        // Fallback: safely append inside the last editable paragraph before the bibliography
        const editableNodes = [...elPaperCanvas.querySelectorAll('p, h2, h3, h4, .float-caption-body')].filter((el) => {
          return !el.closest('.latex-front-matter') && !el.closest('[data-hidden="true"]');
        });
        const target = editableNodes[editableNodes.length - 1];
        if (target) {
          target.appendChild(span);
        } else {
          const p = document.createElement('p');
          p.appendChild(span);
          const bibNode = [...elPaperCanvas.children].find((node) => {
            const block = parsedDoc?.blocks?.find((b) => String(b.id) === node.dataset.blockId);
            return block && /^\\bibliograph(?:y|ystyle)\b/.test(block.raw?.trim() || '');
          });
          elPaperCanvas.insertBefore(p, bibNode || null);
        }
      }

      updateCitationsDisplay(true);
      clearTimeout(autoSaveTimer);
      checkpointDraft();
      closeCitationModal();
    }
  }

  // Event Listeners
  if (elBtnAddCitation) {
    elBtnAddCitation.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && elPaperCanvas.contains(sel.anchorNode)) {
        savedCaretRange = sel.getRangeAt(0).cloneRange();
      }
    });
    elBtnAddCitation.addEventListener('click', () => openCitationModal(null));
  }

  if (elBtnCloseModal) {
    elBtnCloseModal.addEventListener('click', closeCitationModal);
  }

  if (elBtnCancelModal) {
    elBtnCancelModal.addEventListener('click', closeCitationModal);
  }

  if (elBtnConfirmCite) {
    elBtnConfirmCite.addEventListener('click', confirmCitationModal);
  }

  elModal.addEventListener('click', (e) => {
    if (e.target === elModal) closeCitationModal();
  });

  elSearchInput.addEventListener('input', (e) => {
    renderResults(e.target.value);
  });

  elSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCitationModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = elResultsList.querySelector('.cite-result-item');
      if (firstItem) {
        firstItem.click();
        if (!editingCiteNode) confirmCitationModal();
      }
    }
  });

  // Click on citation badge in canvas opens editor
  if (elPaperCanvas) {
    elPaperCanvas.addEventListener('click', (e) => {
      const citeBadge = e.target.closest('.latex-cite');
      if (citeBadge) {
        e.preventDefault();
        e.stopPropagation();
        openCitationModal(citeBadge);
      }
    });
  }

  // Keyboard shortcut: Ctrl+Shift+C
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      openCitationModal(null);
    }
  });
}

// Figure Insertion Modal Controller
function setupFigureModal() {
  const elBtnAddFigure = document.getElementById('btn-add-figure');
  const elModal = document.getElementById('figure-modal');
  const elBtnClose = document.getElementById('btn-close-figure-modal');
  const elBtnCancel = document.getElementById('btn-cancel-figure-modal');
  const elBtnConfirm = document.getElementById('btn-confirm-figure');
  const elPathInput = document.getElementById('figure-path-input');
  const elBtnBrowse = document.getElementById('btn-browse-image');
  const elCaptionInput = document.getElementById('figure-caption-input');
  const elLabelInput = document.getElementById('figure-label-input');
  const elImagesSection = document.getElementById('figure-project-images-section');
  const elImagesList = document.getElementById('figure-images-list');

  if (!elModal || !elPathInput || !elBtnConfirm) return;

  let savedCaretRange = null;

  function suggestLabel(imagePath) {
    if (!imagePath) return '';
    const base = imagePath.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
    const slug = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return slug ? `fig:${slug}` : 'fig:figure';
  }

  function updateConfirmState() {
    elBtnConfirm.disabled = !elPathInput.value.trim();
  }

  function selectImage(path, uri) {
    elPathInput.value = path;
    if (!elLabelInput.value.trim()) {
      elLabelInput.value = suggestLabel(path);
    }
    updateConfirmState();
    if (elImagesList) {
      elImagesList.querySelectorAll('.figure-image-item').forEach((item) => {
        item.classList.toggle('selected', item.dataset.path === path);
      });
    }
  }

  renderProjectImages = function(images) {
    if (!elImagesList || !elImagesSection) return;
    elImagesList.replaceChildren();
    if (!images || images.length === 0) {
      elImagesSection.style.display = 'none';
      return;
    }
    elImagesSection.style.display = 'block';
    for (const img of images) {
      const item = document.createElement('div');
      item.className = 'figure-image-item' + (elPathInput.value.trim() === img.relativePath ? ' selected' : '');
      item.dataset.path = img.relativePath;

      if (img.webviewUri) {
        const thumb = document.createElement('img');
        thumb.className = 'figure-image-thumb';
        thumb.src = img.webviewUri;
        thumb.alt = img.name;
        item.appendChild(thumb);
      } else {
        const ext = img.name.split('.').pop() || 'IMG';
        const placeholder = document.createElement('div');
        placeholder.className = 'figure-image-placeholder';
        placeholder.textContent = ext.slice(0, 4);
        item.appendChild(placeholder);
      }

      const info = document.createElement('div');
      info.className = 'figure-image-info';

      const name = document.createElement('div');
      name.className = 'figure-image-name';
      name.textContent = img.name;
      info.appendChild(name);

      const relPath = document.createElement('div');
      relPath.className = 'figure-image-path';
      relPath.textContent = img.relativePath;
      info.appendChild(relPath);

      item.appendChild(info);

      item.addEventListener('click', () => {
        selectImage(img.relativePath, img.webviewUri);
      });
      item.addEventListener('dblclick', () => {
        selectImage(img.relativePath, img.webviewUri);
        confirmFigureModal();
      });

      elImagesList.appendChild(item);
    }
  };

  handleImagePicked = function(imagePath, webviewUri) {
    selectImage(imagePath, webviewUri);
  };

  function openFigureModal() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && elPaperCanvas.contains(sel.anchorNode)) {
      savedCaretRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedCaretRange = null;
    }

    elPathInput.value = '';
    elCaptionInput.value = '';
    elLabelInput.value = '';
    elBtnConfirm.disabled = true;

    // Request fresh project images from host
    vscode?.postMessage({ command: 'getProjectImages' });
    renderProjectImages(cachedProjectImages);

    elModal.style.display = 'flex';
    setTimeout(() => elPathInput.focus(), 60);
  }

  function closeFigureModal() {
    elModal.style.display = 'none';
    savedCaretRange = null;
  }

  function confirmFigureModal() {
    const imgPath = elPathInput.value.trim();
    if (!imgPath) return;

    const captionText = elCaptionInput.value.trim() || 'Figure caption.';
    const labelText = elLabelInput.value.trim();

    const latexSnippet = [
      '\\begin{figure}[htbp]',
      '  \\centering',
      `  \\includegraphics[width=\\textwidth,keepaspectratio]{${imgPath}}`,
      `  \\caption{${captionText}}`,
      labelText ? `  \\label{${labelText}}` : null,
      '\\end{figure}\n\n',
    ].filter(Boolean).join('\n');

    // Restore caret position
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedCaretRange && elPaperCanvas.contains(savedCaretRange.startContainer)) {
      let anchor = savedCaretRange.startContainer.nodeType === 1 ? savedCaretRange.startContainer : savedCaretRange.startContainer.parentElement;
      if (anchor && anchor.closest('.float-caption-body, .latex-float-card')) {
        const cardBlock = anchor.closest('.latex-float-card')?.closest('.canvas-block') || anchor.closest('.canvas-block');
        const r = document.createRange();
        if (cardBlock && cardBlock.nextSibling) {
          r.setStartBefore(cardBlock.nextSibling);
        } else if (cardBlock) {
          r.setStartAfter(cardBlock);
        } else {
          r.selectNodeContents(elPaperCanvas);
        }
        r.collapse(true);
        sel.addRange(r);
      } else {
        sel.addRange(savedCaretRange);
      }
    } else {
      const range = document.createRange();
      const lastBlock = elPaperCanvas.lastElementChild;
      if (lastBlock) {
        range.selectNodeContents(lastBlock);
        range.collapse(false);
      } else {
        range.selectNodeContents(elPaperCanvas);
        range.collapse(false);
      }
      sel.addRange(range);
    }

    insertFigureSource(latexSnippet);
    closeFigureModal();
  }

  if (elBtnAddFigure) {
    elBtnAddFigure.addEventListener('click', openFigureModal);
  }
  if (elBtnClose) {
    elBtnClose.addEventListener('click', closeFigureModal);
  }
  if (elBtnCancel) {
    elBtnCancel.addEventListener('click', closeFigureModal);
  }
  if (elBtnConfirm) {
    elBtnConfirm.addEventListener('click', confirmFigureModal);
  }
  if (elBtnBrowse) {
    elBtnBrowse.addEventListener('click', () => {
      vscode?.postMessage({ command: 'pickImage' });
    });
  }

  elPathInput.addEventListener('input', () => {
    updateConfirmState();
    if (!elLabelInput.value.trim() && elPathInput.value.trim()) {
      elLabelInput.value = suggestLabel(elPathInput.value.trim());
    }
  });

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      closeFigureModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!elBtnConfirm.disabled) confirmFigureModal();
    }
  };

  elPathInput.addEventListener('keydown', handleKeydown);
  elCaptionInput.addEventListener('keydown', handleKeydown);
  elLabelInput.addEventListener('keydown', handleKeydown);

  elModal.addEventListener('click', (e) => {
    if (e.target === elModal) closeFigureModal();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFigureModal();
    }
  });
}

// Table Insertion Modal Controller
function setupTableModal() {
  const elBtnAddTable = document.getElementById('btn-add-table');
  const elModal = document.getElementById('table-modal');
  const elBtnClose = document.getElementById('btn-close-table-modal');
  const elBtnCancel = document.getElementById('btn-cancel-table-modal');
  const elBtnConfirm = document.getElementById('btn-confirm-table');
  const elRowsInput = document.getElementById('table-rows-input');
  const elColsInput = document.getElementById('table-cols-input');
  const elCaptionInput = document.getElementById('table-caption-input');
  const elLabelInput = document.getElementById('table-label-input');
  const elBooktabsCheckbox = document.getElementById('table-booktabs-checkbox');

  if (!elModal || !elBtnConfirm) return;

  let savedCaretRange = null;

  function suggestTableLabel(caption) {
    if (!caption) return 'tab:table';
    const slug = caption.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    return slug ? `tab:${slug}` : 'tab:table';
  }

  function openTableModal() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && elPaperCanvas.contains(sel.anchorNode)) {
      savedCaretRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedCaretRange = null;
    }

    if (elRowsInput) elRowsInput.value = '3';
    if (elColsInput) elColsInput.value = '3';
    if (elCaptionInput) elCaptionInput.value = '';
    if (elLabelInput) elLabelInput.value = '';
    if (elBooktabsCheckbox) elBooktabsCheckbox.checked = true;

    elModal.style.display = 'flex';
    setTimeout(() => {
      if (elCaptionInput) elCaptionInput.focus();
      else if (elRowsInput) elRowsInput.focus();
    }, 60);
  }

  function closeTableModal() {
    elModal.style.display = 'none';
    savedCaretRange = null;
  }

  function confirmTableModal() {
    const numRows = Math.max(1, Math.min(50, parseInt(elRowsInput?.value || '3', 10) || 3));
    const numCols = Math.max(1, Math.min(20, parseInt(elColsInput?.value || '3', 10) || 3));
    const captionText = elCaptionInput?.value.trim() || 'Table caption.';
    const labelText = elLabelInput?.value.trim();
    const useBooktabs = elBooktabsCheckbox ? elBooktabsCheckbox.checked : true;

    const colSpec = 'l'.repeat(numCols);
    const lines = [];
    lines.push('\\begin{table}[htbp]');
    lines.push('  \\centering');
    lines.push(`  \\caption{${captionText}}`);
    if (labelText) {
      lines.push(`  \\label{${labelText}}`);
    }
    lines.push(`  \\begin{tabular}{${colSpec}}`);
    if (useBooktabs) {
      lines.push('    \\toprule');
    }

    // Header row
    const headers = [];
    for (let c = 1; c <= numCols; c++) {
      headers.push(`\\textbf{Header ${c}}`);
    }
    lines.push('    ' + headers.join(' & ') + ' \\\\');

    if (useBooktabs) {
      lines.push('    \\midrule');
    }

    // Data rows
    for (let r = 1; r <= numRows; r++) {
      const cells = [];
      for (let c = 1; c <= numCols; c++) {
        cells.push(`Item ${r}.${c}`);
      }
      lines.push('    ' + cells.join(' & ') + ' \\\\');
    }

    if (useBooktabs) {
      lines.push('    \\bottomrule');
    }
    lines.push('  \\end{tabular}');
    lines.push('\\end{table}\n\n');

    const latexSnippet = lines.join('\n');

    // Restore caret position
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (savedCaretRange && elPaperCanvas.contains(savedCaretRange.startContainer)) {
      let anchor = savedCaretRange.startContainer.nodeType === 1 ? savedCaretRange.startContainer : savedCaretRange.startContainer.parentElement;
      if (anchor && anchor.closest('.float-caption-body, .latex-float-card')) {
        const cardBlock = anchor.closest('.latex-float-card')?.closest('.canvas-block') || anchor.closest('.canvas-block');
        const r = document.createRange();
        if (cardBlock && cardBlock.nextSibling) {
          r.setStartBefore(cardBlock.nextSibling);
        } else if (cardBlock) {
          r.setStartAfter(cardBlock);
        } else {
          r.selectNodeContents(elPaperCanvas);
        }
        r.collapse(true);
        sel.addRange(r);
      } else {
        sel.addRange(savedCaretRange);
      }
    } else {
      const range = document.createRange();
      const lastBlock = elPaperCanvas.lastElementChild;
      if (lastBlock) {
        range.selectNodeContents(lastBlock);
        range.collapse(false);
      } else {
        range.selectNodeContents(elPaperCanvas);
        range.collapse(false);
      }
      sel.addRange(range);
    }

    insertTableSource(latexSnippet);
    closeTableModal();
  }

  if (elBtnAddTable) {
    elBtnAddTable.addEventListener('click', openTableModal);
  }
  if (elBtnClose) {
    elBtnClose.addEventListener('click', closeTableModal);
  }
  if (elBtnCancel) {
    elBtnCancel.addEventListener('click', closeTableModal);
  }
  if (elBtnConfirm) {
    elBtnConfirm.addEventListener('click', confirmTableModal);
  }

  if (elCaptionInput) {
    elCaptionInput.addEventListener('input', () => {
      if (!elLabelInput.value.trim() && elCaptionInput.value.trim()) {
        elLabelInput.value = suggestTableLabel(elCaptionInput.value.trim());
      }
    });
  }

  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      closeTableModal();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      confirmTableModal();
    }
  };

  [elRowsInput, elColsInput, elCaptionInput, elLabelInput].forEach((input) => {
    input?.addEventListener('keydown', handleKeydown);
  });

  elModal.addEventListener('click', (e) => {
    if (e.target === elModal) closeTableModal();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      openTableModal();
    }
  });
}

// Theme Synchronization & Manual Toggle
function setupThemeManager() {
  try {
    const btnTheme = document.getElementById('btn-theme-toggle');
    const STORAGE_KEY = 'aspyrus_theme_preference'; // 'auto' | 'light' | 'dark'
    const LEGACY_STORAGE_KEY = 'localleaf_theme_preference';

    let preference = 'auto';
    try {
      preference = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || 'auto';
    } catch {}

    function getEffectiveVsCodeTheme() {
      const body = document.body;
      if (body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast')) {
        return 'dark';
      }
      if (body.classList.contains('vscode-light') || body.classList.contains('vscode-high-contrast-light')) {
        return 'light';
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    }

    function updateThemeButton(pref = preference) {
      if (!btnTheme) return;
      const effectiveTheme = (pref === 'dark' || (pref === 'auto' && getEffectiveVsCodeTheme() === 'dark'))
        ? 'dark'
        : 'light';
      const isDark = effectiveTheme === 'dark';
      btnTheme.setAttribute('data-theme', effectiveTheme);
      btnTheme.setAttribute('data-preference', pref);
      btnTheme.title = pref === 'auto'
        ? 'Theme: Auto (' + (isDark ? 'Dark' : 'Light') + ', synced with VS Code)\nClick to toggle Light/Dark, Shift+Click to keep Auto'
        : 'Theme: ' + (pref === 'dark' ? 'Dark' : 'Light') + ' (manual override)\nClick to toggle, Shift+Click to sync with VS Code';

      const sunIcon = btnTheme.querySelector('.theme-icon-sun');
      const moonIcon = btnTheme.querySelector('.theme-icon-moon');
      if (sunIcon && moonIcon) {
        sunIcon.style.display = isDark ? 'inline-block' : 'none';
        moonIcon.style.display = isDark ? 'none' : 'inline-block';
      }
    }

    function applyTheme(pref) {
      preference = pref;
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {}

      const body = document.body;
      body.classList.toggle('theme-dark', pref === 'dark');
      body.classList.toggle('theme-light', pref === 'light');
      updateThemeButton(pref);
    }

    // VS Code changes its body class when the active theme changes. In auto mode
    // refresh only the icon; changing classes here would retrigger this observer
    // and can lock the webview in a mutation loop.
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver((mutations) => {
        if (preference !== 'auto') return;
        if (mutations.some((mutation) => mutation.attributeName === 'class')) {
          updateThemeButton('auto');
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    // System theme changes
    if (window.matchMedia) {
      try {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', () => {
            if (preference === 'auto') applyTheme('auto');
          });
        } else if (typeof mq.addListener === 'function') {
          mq.addListener(() => {
            if (preference === 'auto') applyTheme('auto');
          });
        }
      } catch {}
    }

    if (btnTheme) {
      btnTheme.addEventListener('click', (e) => {
        if (e.shiftKey) {
          applyTheme('auto');
          return;
        }

        const currentEffective = (preference === 'dark' || (preference === 'auto' && getEffectiveVsCodeTheme() === 'dark'))
          ? 'dark'
          : 'light';

        const nextTheme = currentEffective === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
      });
    }

    // Initial application
    applyTheme(preference);
  } catch (err) {
    console.error('[Aspyrus] Theme manager setup error:', err);
  }
}

// Initialize UI
setupHistoryButtons();
setupFormattingButtons();
setupToolbarMenus();
setupCitationModeButtons();
setupCitationModal();
setupFigureModal();
setupTableModal();
setupThemeManager();

// Notify VS Code that webview is ready to receive document
if (vscode) {
  vscode.postMessage({ command: 'ready' });
}

