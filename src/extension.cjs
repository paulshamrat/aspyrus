const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');

function isSameFile(uriA, uriB) {
  if (!uriA || !uriB) return false;
  if (uriA.toString() === uriB.toString()) return true;
  try {
    return fs.realpathSync(uriA.fsPath) === fs.realpathSync(uriB.fsPath);
  } catch {
    return false;
  }
}

function activate(context) {
  const output = vscode.window.createOutputChannel('LocalLeaf');
  context.subscriptions.push(output);

  // Map of canonical file path -> WebviewPanel
  const activePanels = new Map();

  function setupPanel(panel, doc) {
    const realFilePath = fs.realpathSync(doc.uri.fsPath);
    const fileName = path.basename(doc.fileName);
    activePanels.set(realFilePath, panel);

    output.appendLine(`[LocalLeaf] Opened editor panel for: ${realFilePath}`);

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

    panel.webview.html = htmlContent;

    function sendInit() {
      output.appendLine(`[LocalLeaf] Sending document content (${doc.getText().length} chars)`);
      panel.webview.postMessage({
        command: 'init',
        filePath: realFilePath,
        fileName: fileName,
        content: doc.getText(),
        isDirty: doc.isDirty,
      });
    }

    let isInternalSave = false;

    // Handle messages from the webview
    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
      if (!message) return;

      if (message.command === 'ready') {
        sendInit();
      } else if (message.command === 'save') {
        output.appendLine(`[LocalLeaf] Received save request (${(message.content || '').length} chars)`);
        try {
          isInternalSave = true;

          // 1. Guaranteed file save on disk
          fs.writeFileSync(realFilePath, message.content, 'utf8');

          // 2. Synchronize open VS Code editor buffer if open
          try {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              doc.positionAt(0),
              doc.positionAt(doc.getText().length),
            );
            edit.replace(doc.uri, fullRange, message.content);
            await vscode.workspace.applyEdit(edit);
            await doc.save();
          } catch (editErr) {
            output.appendLine(`[LocalLeaf] WorkspaceEdit warning: ${editErr.message}`);
          }

          // 3. Confirm back to webview immediately
          panel.webview.postMessage({
            command: 'saveSuccess',
            timestamp: Date.now(),
          });
          output.appendLine(`[LocalLeaf] Save successful for ${realFilePath}`);
        } catch (err) {
          output.appendLine(`[LocalLeaf] Save error: ${err.message}`);
          vscode.window.showErrorMessage(`LocalLeaf save error: ${err.message}`);
        } finally {
          setTimeout(() => {
            isInternalSave = false;
          }, 300);
        }
      }
    });

    // Two-way sync: listen for external edits in the raw LaTeX editor
    let externalUpdateDebounce = null;
    const docChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (isSameFile(event.document.uri, doc.uri) && !isInternalSave) {
        clearTimeout(externalUpdateDebounce);
        externalUpdateDebounce = setTimeout(() => {
          output.appendLine(`[LocalLeaf] Synchronizing raw editor change to webview...`);
          panel.webview.postMessage({
            command: 'externalUpdate',
            content: event.document.getText(),
          });
        }, 200);
      }
    });

    panel.onDidDispose(() => {
      clearTimeout(externalUpdateDebounce);
      messageListener.dispose();
      docChangeSubscription.dispose();
      activePanels.delete(realFilePath);
      output.appendLine(`[LocalLeaf] Panel disposed for: ${realFilePath}`);
    });
  }

  const openCommand = vscode.commands.registerCommand('localleaf.open', async (uri) => {
    let targetUri = uri;
    if (!targetUri && vscode.window.activeTextEditor) {
      targetUri = vscode.window.activeTextEditor.document.uri;
    }

    if (!targetUri || targetUri.scheme !== 'file' || !targetUri.fsPath.toLowerCase().endsWith('.tex')) {
      vscode.window.showInformationMessage('Please open or select a .tex file to edit in LocalLeaf.');
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
      'localleaf.editor',
      `Edit: ${fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview')),
        ],
      },
    );

    context.subscriptions.push(panel);
    setupPanel(panel, doc);
  });

  context.subscriptions.push(openCommand);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
