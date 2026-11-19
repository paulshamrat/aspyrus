let vscode;
try {
  vscode = require('vscode');
} catch {}
const path = require('node:path');
const fs = require('node:fs');
const child_process = require('node:child_process');
const recovery = require('./recovery.cjs');
const { projectRoot, localDependency } = require('./project.cjs');
const { compileManuscript } = require('./compiler.cjs');

function isSameFile(uriA, uriB) {
  if (!uriA || !uriB) return false;
  if (uriA.toString() === uriB.toString()) return true;
  try {
    return fs.realpathSync(uriA.fsPath) === fs.realpathSync(uriB.fsPath);
  } catch {
    return false;
  }
}

function getBibContext(texFilePath, content) {
  if (content === undefined || content === null) {
    try {
      if (fs.existsSync(texFilePath)) {
        content = fs.readFileSync(texFilePath, 'utf8');
      }
    } catch {}
  }
  content = content || '';

  const dir = path.dirname(texFilePath);
  const stem = path.basename(texFilePath, path.extname(texFilePath));

  const isSuperscript =
    /\\usepackage\[[^\]]*super[^\]]*\]\{natbib\}/.test(content) ||
    /\\usepackage\[[^\]]*superscript[^\]]*\]\{cite\}/.test(content);

  const citeNumbers = {};
  const labelMap = {};
  const labelPages = {};
  const labelKinds = {};
  const auxCandidates = [
    path.join(dir, '.aspyrus_build', `${stem}.aux`),
    path.join(dir, '.localleaf_build', `${stem}.aux`),
    path.join(dir, `${stem}.aux`),
  ];
  for (const candidate of auxCandidates) {
    if (fs.existsSync(candidate)) {
      try {
        const auxText = fs.readFileSync(candidate, 'utf8');
        const regex = /\\bibcite\{([^}]+)\}\{([^}]*)\}/g;
        let m;
        while ((m = regex.exec(auxText)) !== null) {
          const key = m[1];
          let val = m[2];
          const match = val.match(/^\{?([^{}]+)/);
          if (match) val = match[1];
          if (!citeNumbers[key]) {
            citeNumbers[key] = val;
          }
        }
        const labelRegex = /\\newlabel\{([^}]+)\}\{\{([^}]*)\}\{([^}]*)\}/g;
        let lm;
        while ((lm = labelRegex.exec(auxText)) !== null) {
          const key = lm[1];
          let val = lm[2];
          const match = val.match(/^\{?([^{}]+)/);
          if (match) val = match[1];
          if (!labelMap[key]) {
            labelMap[key] = val;
            labelPages[key] = lm[3];
            // Hyperref appends an anchor after the (possibly nested) title.
            let i = labelRegex.lastIndex;
            if (auxText[i] === '{') {
              let depth = 1;
              for (i++; i < auxText.length && depth; i++) {
                if (auxText[i] === '\\') { i++; continue; }
                if (auxText[i] === '{') depth++;
                if (auxText[i] === '}') depth--;
              }
              const anchor = auxText.slice(i).match(/^\{([A-Za-z]+)[.*]/)?.[1];
              const kinds = {figure: 'Figure', table: 'Table', equation: 'Equation', section: 'section', subsection: 'subsection', subsubsection: 'subsubsection', appendix: 'Appendix'};
              if (kinds[anchor]) labelKinds[key] = kinds[anchor];
            }
          }
        }
      } catch {}
    }
  }

  // Cross-document label resolution for \externaldocument
  const extDocMatches = [...content.matchAll(/\\externaldocument(?:\[[^\]]*\])*\{([^}]+)\}/g)];
  for (const em of extDocMatches) {
    const rawTarget = em[1].trim();
    const extCandidates = [
      path.resolve(dir, rawTarget.endsWith('.aux') ? rawTarget : rawTarget + '.aux'),
      path.resolve(dir, path.dirname(rawTarget), '.aspyrus_build', path.basename(rawTarget) + '.aux'),
      path.resolve(dir, path.dirname(rawTarget), '.localleaf_build', path.basename(rawTarget) + '.aux'),
    ];
    for (const cand of extCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const extAuxText = fs.readFileSync(cand, 'utf8');
          const extLabelRegex = /\\newlabel\{([^}]+)\}\{\{([^}]*)\}\{([^}]*)\}/g;
          let elm;
          while ((elm = extLabelRegex.exec(extAuxText)) !== null) {
            const key = elm[1];
            let val = elm[2];
            const match = val.match(/^\{?([^{}]+)/);
            if (match) val = match[1];
            if (!labelMap[key]) {
              labelMap[key] = val;
              labelPages[key] = elm[3];
              let i = extLabelRegex.lastIndex;
              if (extAuxText[i] === '{') {
                let depth = 1;
                for (i++; i < extAuxText.length && depth; i++) {
                  if (extAuxText[i] === '\\') { i++; continue; }
                  if (extAuxText[i] === '{') depth++;
                  if (extAuxText[i] === '}') depth--;
                }
                const anchor = extAuxText.slice(i).match(/^\{([A-Za-z]+)[.*]/)?.[1];
                const kinds = {figure: 'Figure', table: 'Table', equation: 'Equation', section: 'section', subsection: 'subsection', subsubsection: 'subsubsection', appendix: 'Appendix'};
                if (kinds[anchor]) labelKinds[key] = kinds[anchor];
              }
            }
          }
        } catch {}
        break;
      }
    }
  }

  // Dynamic fallback: discover citations in document body in appearance order
  let counter = 1;
  for (const n of Object.values(citeNumbers)) {
    const parsed = parseInt(n, 10);
    if (!isNaN(parsed) && parsed >= counter) counter = parsed + 1;
  }
  const docBody = content.includes('\\begin{document}')
    ? content.slice(content.indexOf('\\begin{document}'))
    : content;
  const citeRegex = /\\(?:cite[a-z*]*|revref)\s*\{([^}]+)\}/g;
  let cm;
  while ((cm = citeRegex.exec(docBody)) !== null) {
    const rawKeys = cm[1].split(',');
    for (let k of rawKeys) {
      k = k.trim();
      if (k && !k.startsWith('#') && !citeNumbers[k]) {
        citeNumbers[k] = String(counter++);
      }
    }
  }

  const doiMap = {};
  const metaMap = {};
  const declared = [...content.matchAll(/\\bibliography\{([^}]+)\}/g)].flatMap(m => m[1].split(','));
  const bibPaths = declared.map(name => localDependency(texFilePath, name.trim() + '.bib')).filter(Boolean);
  if (!bibPaths.length) {
    for (const name of ['references.bib', 'references/references.bib']) {
      const candidate = localDependency(texFilePath, path.relative(dir, path.join(projectRoot(texFilePath), name)));
      if (candidate) bibPaths.push(candidate);
    }
  }
  for (const bibPath of bibPaths) {
    if (!fs.existsSync(bibPath)) continue;
    try {
      const bibText = fs.readFileSync(bibPath, 'utf8');
      const entryRegex = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)(?=\n@|\n*$)/g;
      let em;
      while ((em = entryRegex.exec(bibText)) !== null) {
        const key = em[2].trim();
        const body = em[3];

        const getField = (fieldName) => {
          const idx = body.search(new RegExp('\\b' + fieldName + '\\s*=', 'i'));
          if (idx === -1) return '';
          const after = body.slice(idx).replace(new RegExp('^\\b' + fieldName + '\\s*=\\s*', 'i'), '');
          if (after.startsWith('{')) {
            let depth = 0;
            let val = '';
            for (let i = 0; i < after.length; i++) {
              if (after[i] === '{') depth++;
              else if (after[i] === '}') {
                depth--;
                if (depth === 0) return val.slice(1).trim();
              }
              val += after[i];
            }
            return val.slice(1).trim();
          } else if (after.startsWith('"')) {
            const end = after.indexOf('"', 1);
            return end !== -1 ? after.slice(1, end).trim() : '';
          } else {
            const m = after.match(/^([^,\n]+)/);
            return m ? m[1].trim() : '';
          }
        };

        const doi = getField('doi');
        const title = getField('title').replace(/[{}\\]/g, '');
        const author = getField('author').replace(/[{}\\]/g, '');
        const year = getField('year').replace(/[{}\\]/g, '');
        const journal = getField('journal') || getField('booktitle');

        if (doi) doiMap[key] = doi;
        metaMap[key] = {
          key,
          doi,
          title,
          author: author
            ? author.split(' and ')[0] + (author.includes(' and ') ? ' et al.' : '')
            : '',
          year,
          journal: journal ? journal.replace(/[{}\\]/g, '') : '',
        };
      }
    } catch {}
  }

  return {
    citeNumbers,
    doiMap,
    metaMap,
    isSuperscript,
    sortCitations: /\\usepackage\[[^\]]*sort[^\]]*\]\{natbib\}/.test(content),
    compressCitations: /\\usepackage\[[^\]]*sort&compress[^\]]*\]\{natbib\}/.test(content),
    labelMap,
    labelPages,
    labelKinds,
  };
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Aspyrus');
  context.subscriptions.push(output);

  // Map of canonical file path -> WebviewPanel
  const activePanels = new Map();

  function figureUrisForDocument(panel, documentPath, content) {
    const figureUris = {};
    const pattern = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
    for (const match of content.matchAll(pattern)) {
      const relativePath = match[1].trim();
      if (!relativePath || path.isAbsolute(relativePath)) continue;
      const resolved = localDependency(documentPath, relativePath);
      if (!resolved) continue;
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(resolved).toLowerCase())) continue;
      const stamp = fs.statSync(resolved);
      figureUris[relativePath] = panel.webview.asWebviewUri(vscode.Uri.file(resolved)).toString() + `?v=${stamp.mtimeMs}-${stamp.size}`;
    }
    return figureUris;
  }

  function discoverProjectImages(panel, texFilePath) {
    const images = [];
    const root = projectRoot(texFilePath);
    const docDir = path.dirname(texFilePath);
    const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf']);

    function scanDir(dir, depth = 0) {
      if (depth > 4) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(full, depth + 1);
          } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
            const rel = path.relative(docDir, full);
            let webviewUri = null;
            if (['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(entry.name).toLowerCase())) {
              try {
                const stamp = fs.statSync(full);
                webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(full)).toString() + `?v=${stamp.mtimeMs}-${stamp.size}`;
              } catch {}
            }
            images.push({
              name: entry.name,
              relativePath: rel,
              webviewUri,
            });
          }
        }
      } catch {}
    }

    for (const sub of ['assets/figures', 'assets', 'figures', 'images', '']) {
      const target = sub ? path.join(root, sub) : docDir;
      if (fs.existsSync(target)) scanDir(target, 0);
    }

    const seen = new Set();
    return images.filter((img) => {
      if (seen.has(img.relativePath)) return false;
      seen.add(img.relativePath);
      return true;
    });
  }

  function setupPanel(panel, doc) {
    const realFilePath = fs.realpathSync(doc.uri.fsPath);
    const fileName = path.basename(doc.fileName);
    activePanels.set(realFilePath, panel);

    output.appendLine(`[Aspyrus] Opened editor panel for: ${realFilePath}`);

    // Ensure webview options are configured (critical for restored/deserialized panels!)
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview')),
        vscode.Uri.file(projectRoot(realFilePath)),
      ],
    };

    // Read HTML template and resolve webview URIs
    const webviewDir = path.join(context.extensionPath, 'src', 'webview');
    const htmlPath = path.join(webviewDir, 'index.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const stylesUri = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewDir, 'styles.css')),
    );
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewDir, 'bundle.js')),
    );

    htmlContent = htmlContent
      .replace('{{stylesUri}}', stylesUri.toString())
      .replace('{{scriptUri}}', scriptUri.toString());

    // Compare exact content across asynchronous VS Code document-change events.
    // A timer-based guard can suppress a real raw-TeX edit made just after a
    // canvas save, leaving stale canvas content that could overwrite the edit.
    let lastCanvasContent = doc.getText();

    function sendInit() {
      const content = doc.getText();
      lastCanvasContent = content;
      output.appendLine(`[Aspyrus] Sending document content (${content.length} chars)`);
      const exportRecordPath = path.join(path.dirname(realFilePath), `.${path.basename(realFilePath, path.extname(realFilePath))}-export.json`);
      let savedMode = 'numbers';
      try {
        if (fs.existsSync(exportRecordPath)) {
          const data = JSON.parse(fs.readFileSync(exportRecordPath, 'utf8'));
          if (['numbers', 'dois', 'keys'].includes(data.mode)) savedMode = data.mode;
        }
      } catch {}
      panel.webview.postMessage({
        command: 'init',
        filePath: realFilePath,
        fileName: fileName,
        content: content,
        isDirty: doc.isDirty,
        bibContext: getBibContext(realFilePath, content),
        figureUris: figureUrisForDocument(panel, realFilePath, content),
        mode: savedMode,
        projectImages: discoverProjectImages(panel, realFilePath),
      });
    }

    // Handle messages from the webview BEFORE setting html
    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
      if (!message) return;

      if (message.command === 'ready') {
        doc = await vscode.workspace.openTextDocument(doc.uri);
        sendInit();
      } else if (message.command === 'getProjectImages') {
        panel.webview.postMessage({
          command: 'projectImages',
          images: discoverProjectImages(panel, realFilePath),
        });
      } else if (message.command === 'pickImage') {
        try {
          if (typeof vscode?.window?.showOpenDialog === 'function') {
            const root = projectRoot(realFilePath);
            const defaultDir = path.join(root, 'assets');
            const uris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              filters: {
                'Images': ['png', 'jpg', 'jpeg', 'webp', 'pdf'],
              },
              defaultUri: fs.existsSync(defaultDir) ? vscode.Uri.file(defaultDir) : vscode.Uri.file(path.dirname(realFilePath)),
              openLabel: 'Select Figure Image',
            });
            if (uris && uris.length > 0) {
              const selectedPath = fs.realpathSync(uris[0].fsPath);
              if (!selectedPath.startsWith(root + path.sep) && selectedPath !== root) {
                vscode.window?.showErrorMessage?.(`Aspyrus: Selected image must be within project boundary (${root})`);
                return;
              }
              const rel = path.relative(path.dirname(realFilePath), selectedPath);
              let webviewUri = null;
              if (['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(selectedPath).toLowerCase())) {
                try {
                  const stamp = fs.statSync(selectedPath);
                  webviewUri = panel.webview.asWebviewUri(vscode.Uri.file(selectedPath)).toString() + `?v=${stamp.mtimeMs}-${stamp.size}`;
                } catch {}
              }
              panel.webview.postMessage({
                command: 'imagePicked',
                imagePath: rel,
                webviewUri,
              });
            }
          }
        } catch (err) {
          vscode.window?.showErrorMessage?.(`Aspyrus: ${err.message}`);
        }
      } else if (message.command === 'figureClipboardWrite' || message.command === 'figureClipboardRead') {
        output.appendLine(`[Aspyrus] Figure clipboard: ${message.command}`);
        try {
          if (message.command === 'figureClipboardWrite') {
            await vscode.env.clipboard.writeText(String(message.content || ''));
            output.appendLine('[Aspyrus] Figure clipboard write complete');
            panel.webview.postMessage({ command: 'figureClipboardWritten', requestId: message.requestId });
          } else {
            panel.webview.postMessage({ command: 'figureClipboardRead', requestId: message.requestId, content: await vscode.env.clipboard.readText() });
          }
        } catch (err) {
          panel.webview.postMessage({ command: 'figureClipboardError', requestId: message.requestId });
          output.appendLine(`[Aspyrus] Clipboard error: ${err.message}`);
        }
      } else if (message.command === 'requestClipboardPlainText') {
        try {
          const text = await vscode.env.clipboard.readText();
          panel.webview.postMessage({ command: 'clipboardPlainText', text });
        } catch (err) {
          output.appendLine(`[Aspyrus] Plain text clipboard error: ${err.message}`);
        }
      } else if (message.command === 'resolveFigurePreviews') {
        panel.webview.postMessage({ command: 'figurePreviews', revision: message.revision,
          figureUris: figureUrisForDocument(panel, realFilePath, String(message.content || '')) });
      } else if (message.command === 'checkpoint') {
        try {
          doc = await vscode.workspace.openTextDocument(doc.uri);
          recovery.checkpoint(context.globalStorageUri.fsPath, realFilePath, doc.getText(), 'saved');
          recovery.checkpoint(context.globalStorageUri.fsPath, realFilePath, String(message.content), 'draft');
        } catch (err) {
          panel.webview.postMessage({ command: 'recoveryError' });
          output.appendLine(`[Aspyrus] Recovery checkpoint failed: ${err.message}`);
        }
      } else if (message.command === 'restore') {
        try {
          doc = await vscode.workspace.openTextDocument(doc.uri);
          const root = context.globalStorageUri.fsPath;
          recovery.checkpoint(root, realFilePath, doc.getText(), 'saved');
          if (typeof message.content === 'string') recovery.checkpoint(root, realFilePath, message.content, 'draft');
          const entries = recovery.list(root, realFilePath);
          const picked = await vscode.window.showQuickPick(entries.map((entry) => ({
            label: new Date(entry.time).toLocaleString(),
            description: `${entry.kind === 'draft' ? 'Canvas draft' : 'Before save'} · ${entry.content.length} characters`,
            entry,
          })), { title: 'Aspyrus: restore a version (current content is checkpointed)', placeHolder: 'Choose the version to restore' });
          if (!picked) return;
          // Capture edits made while the picker was open before replacing them.
          doc = await vscode.workspace.openTextDocument(doc.uri);
          recovery.checkpoint(root, realFilePath, doc.getText(), 'saved');
          const edit = new vscode.WorkspaceEdit();
          edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), picked.entry.content);
          if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not restore document');
          doc = await vscode.workspace.openTextDocument(doc.uri);
          if (!await doc.save() || doc.isDirty) throw new Error('Could not save restored document');
          sendInit();
        } catch (err) {
          vscode.window.showErrorMessage(`Aspyrus recovery error: ${err.message}`);
        }
      } else if (message.command === 'save') {
        output.appendLine(`[Aspyrus] Received save request (${(message.content || '').length} chars)`);
        try {
          // A retained canvas can outlive the original TextDocument handle.
          doc = await vscode.workspace.openTextDocument(doc.uri);
          const content = String(message.content ?? '');
          lastCanvasContent = content;
          recovery.checkpoint(context.globalStorageUri.fsPath, realFilePath, fs.readFileSync(realFilePath, 'utf8'), 'saved');
          recovery.checkpoint(context.globalStorageUri.fsPath, realFilePath, doc.getText(), 'saved');
          const matchingDocs = (vscode.workspace.textDocuments || [doc])
            .filter((d) => !d.isClosed && isSameFile(d.uri, doc.uri));
          if (!matchingDocs.includes(doc)) matchingDocs.push(doc);
          const edit = new vscode.WorkspaceEdit();
          let hasEdits = false;
          for (const target of matchingDocs) {
            if (target.getText() !== content) {
              edit.replace(target.uri, new vscode.Range(target.positionAt(0), target.positionAt(target.getText().length)), content);
              hasEdits = true;
            }
          }
          if (hasEdits && !await vscode.workspace.applyEdit(edit)) throw new Error('Could not update the TEX editor buffer');
          for (const target of matchingDocs) {
            const live = await vscode.workspace.openTextDocument(target.uri);
            if (live.getText() !== content) throw new Error('TEX changed during Save; review the current document');
            if (live.isDirty && !await live.save()) throw new Error('The TEX editor could not save; your edits remain in its buffer');
          }
          if (fs.readFileSync(realFilePath, 'utf8') !== content) {
            fs.writeFileSync(realFilePath, content, 'utf8');
          }
          doc = await vscode.workspace.openTextDocument(doc.uri);
          const liveDocs = (vscode.workspace.textDocuments || [doc])
            .filter((d) => !d.isClosed && isSameFile(d.uri, doc.uri));
          if (doc.isDirty || doc.getText() !== content || liveDocs.some((d) => d.isDirty || d.getText() !== content)
              || fs.readFileSync(realFilePath, 'utf8') !== content) {
            throw new Error('Save is not confirmed; the TEX document still has changes');
          }

          // 3. Compute fresh citation context immediately
          const freshBib = getBibContext(realFilePath, message.content);

          // 4. Confirm back to webview with updated citation context
          panel.webview.postMessage({
            command: 'saveSuccess',
            saveId: message.saveId,
            timestamp: Date.now(),
            bibContext: freshBib,
          });
          output.appendLine(`[Aspyrus] Save successful for ${realFilePath}`);
        } catch (err) {
          output.appendLine(`[Aspyrus] Save error: ${err.message}`);
          panel.webview.postMessage({ command: 'saveError', saveId: message.saveId });
          vscode.window.showErrorMessage(`Aspyrus save error: ${err.message}`);
        }
      } else if (message.command === 'compile') {
        const mode = message.mode || 'numbers';
        output.appendLine(`[Aspyrus] Received compile request (mode: ${mode}) for: ${realFilePath}`);

        try {
          const openDocs = vscode.workspace.textDocuments || [];
          for (const targetDoc of openDocs.filter((d) => isSameFile(d.uri, doc.uri))) {
            if (targetDoc.isDirty && !await targetDoc.save()) throw new Error('Save the document before building');
          }
          const res = await compileManuscript({
            texFilePath: realFilePath,
            trusted: vscode.workspace.isTrusted === true,
            mode,
            output,
          });

          const freshBib = getBibContext(realFilePath);
          panel.webview.postMessage({
            command: 'compileResult',
            success: true,
            message: res.message || `Compiled (${mode}) ✓`,
            bibContext: freshBib,
          });
          if (vscode && vscode.window) {
            vscode.window.setStatusBarMessage(
              `Aspyrus: ${res.message} (${res.elapsed}s)`,
              5000
            );
          }
        } catch (err) {
          output.appendLine(`[Aspyrus] Compile failed: ${err.message}`);
          try {
            panel.webview.postMessage({
              command: 'compileResult',
              success: false,
              message: 'Compile failed',
            });
          } catch {}
          if (vscode && vscode.window) {
            vscode.window.showErrorMessage(
              `Aspyrus Compile Error: ${err.message}`
            );
          }
        }
      }
    });

    // Set webview HTML content
    panel.webview.html = htmlContent;

    // The webview requests its initial source with 'ready'. Its DOM is retained
    // while hidden; focus/visibility changes must never replace unsaved edits.

    // Two-way sync: listen for external edits in the raw LaTeX editor
    let externalUpdateDebounce = null;
    const docChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (!isSameFile(event.document.uri, doc.uri)) return;

      const updatedContent = event.document.getText();
      // A canvas-originated WorkspaceEdit echoes through this event. Ignore
      // only that exact content rather than every edit during a timer window.
      if (updatedContent === lastCanvasContent) return;

      lastCanvasContent = updatedContent;
      clearTimeout(externalUpdateDebounce);
      externalUpdateDebounce = setTimeout(() => {
        panel.webview.postMessage({
          command: 'externalUpdate',
          content: updatedContent,
          figureUris: figureUrisForDocument(panel, realFilePath, updatedContent),
          bibContext: getBibContext(realFilePath, updatedContent),
        });
      }, 200);
    });

    const assetWatcher = vscode.workspace.createFileSystemWatcher?.(new vscode.RelativePattern(projectRoot(realFilePath), '**/*.{png,jpg,jpeg,webp}'));
    const refreshAssets = () => panel.webview.postMessage({command: 'refreshAssets'});
    assetWatcher?.onDidChange(refreshAssets);
    assetWatcher?.onDidCreate(refreshAssets);
    assetWatcher?.onDidDelete(refreshAssets);
    panel.onDidDispose(() => {
      assetWatcher?.dispose();
      clearTimeout(externalUpdateDebounce);
      messageListener.dispose();
      docChangeSubscription.dispose();
      activePanels.delete(realFilePath);
      output.appendLine(`[Aspyrus] Panel disposed for: ${realFilePath}`);
    });
  }

  const openHandler = async (uri) => {
    let targetUri = uri;
    if (!targetUri && vscode.window.activeTextEditor) {
      targetUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath.toLowerCase().endsWith('.tex')) {
      vscode.window.showInformationMessage('Please open or select a .tex file to edit in Aspyrus.');
      return;
    }

    const doc = await vscode.workspace.openTextDocument(targetUri);
    const realFilePath = fs.realpathSync(doc.uri.fsPath);

    // If panel already exists for this document, reveal it
    if (activePanels.has(realFilePath)) {
      const existingPanel = activePanels.get(realFilePath);
      existingPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const fileName = path.basename(doc.fileName);
    const panel = vscode.window.createWebviewPanel(
      'aspyrus.editor',
      `Edit: ${fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview')),
          vscode.Uri.file(projectRoot(realFilePath)),
        ],
      },
    );

    context.subscriptions.push(panel);
    setupPanel(panel, doc);
  };

  const openCommand = vscode.commands.registerCommand('aspyrus.open', openHandler);

  const restoreHandler = () => {
    const panel = [...activePanels.values()].find((entry) => entry.active);
    if (!panel) {
      vscode.window.showInformationMessage('Focus an Aspyrus canvas before restoring a version.');
      return;
    }
    panel.webview.postMessage({ command: 'requestRestore' });
  };
  const restoreCommand = vscode.commands.registerCommand('aspyrus.restore', restoreHandler);

  const pastePlainTextHandler = async () => {
    const panel = [...activePanels.values()].find((entry) => entry.active) || activePanels.values().next().value;
    if (!panel) return;
    try {
      const text = await vscode.env.clipboard.readText();
      panel.webview.postMessage({ command: 'clipboardPlainText', text });
    } catch (err) {
      vscode.window.showErrorMessage(`Aspyrus: ${err.message}`);
    }
  };
  const pastePlainTextCommand = vscode.commands.registerCommand('aspyrus.pastePlainText', pastePlainTextHandler);

  async function createTemplateFile(templateRelPath, defaultFileName, targetUri) {
    let destDir = null;
    if (targetUri && targetUri.fsPath) {
      try {
        const stat = fs.statSync(targetUri.fsPath);
        destDir = stat.isDirectory() ? targetUri.fsPath : path.dirname(targetUri.fsPath);
      } catch {}
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      destDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    const templatePath = path.join(__dirname, '..', 'example', templateRelPath);
    let content = '';
    if (fs.existsSync(templatePath)) {
      content = fs.readFileSync(templatePath, 'utf8');
    }

    if (!destDir) {
      const doc = await vscode.workspace.openTextDocument({ language: 'latex', content });
      await vscode.window.showTextDocument(doc);
      return;
    }

    const targetFile = path.join(destDir, defaultFileName);
    if (fs.existsSync(targetFile)) {
      const choice = await vscode.window.showWarningMessage(
        `Aspyrus: ${defaultFileName} already exists in ${path.basename(destDir)}. Open existing document?`,
        'Open Existing',
        'Cancel'
      );
      if (choice === 'Open Existing') {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetFile));
        await vscode.commands.executeCommand('aspyrus.open', doc.uri);
      }
      return;
    }

    fs.writeFileSync(targetFile, content, 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetFile));
    await vscode.commands.executeCommand('aspyrus.open', doc.uri);
    vscode.window.showInformationMessage(`Aspyrus: Created ${defaultFileName}`);
  }

  const newManuscriptHandler = (uri) => {
    return createTemplateFile(path.join('main', 'main.tex'), 'main.tex', uri);
  };
  const newManuscriptCommand = vscode.commands.registerCommand('aspyrus.newManuscript', newManuscriptHandler);

  const newSupplementaryHandler = (uri) => {
    return createTemplateFile(path.join('supplementary', 'supplementary.tex'), 'supplementary.tex', uri);
  };
  const newSupplementaryCommand = vscode.commands.registerCommand('aspyrus.newSupplementary', newSupplementaryHandler);

  context.subscriptions.push(
    openCommand,
    restoreCommand,
    pastePlainTextCommand,
    newManuscriptCommand,
    newSupplementaryCommand
  );

  // Restore Aspyrus webview panels across window reloads / restarts
  const deserializeHandler = async (webviewPanel, state) => {
    output.appendLine(`[Aspyrus] Restoring webview panel: ${webviewPanel.title}`);
    try {
      let filePath = state?.filePath;
      if (!filePath && webviewPanel.title.startsWith('Edit: ')) {
        const titleName = webviewPanel.title.replace('Edit: ', '').trim();
        for (const editor of vscode.window.visibleTextEditors) {
          if (path.basename(editor.document.fileName) === titleName) {
            filePath = fs.realpathSync(editor.document.uri.fsPath);
            break;
          }
        }
        if (!filePath) {
          const files = await vscode.workspace.findFiles(`**/${titleName}`, '**/node_modules/**', 1);
          if (files.length > 0) {
            filePath = fs.realpathSync(files[0].fsPath);
          }
        }
      }

      if (filePath && fs.existsSync(filePath)) {
        const doc = await vscode.workspace.openTextDocument(filePath);
        setupPanel(webviewPanel, doc);
      } else {
        output.appendLine(`[Aspyrus] Could not resolve file for deserialized panel: ${webviewPanel.title}`);
      }
    } catch (err) {
      output.appendLine(`[Aspyrus] Error restoring webview panel: ${err.message}`);
    }
  };

  const serializer = vscode.window.registerWebviewPanelSerializer('aspyrus.editor', {
    deserializeWebviewPanel: deserializeHandler,
  });

  context.subscriptions.push(serializer);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  getBibContext,
};
