const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');

function activate(context) {
  // Track open panels per file URI string
  const activePanels = new Map();

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
    const uriString = doc.uri.toString();

    // If panel already exists for this document, reveal it
    if (activePanels.has(uriString)) {
      const existingPanel = activePanels.get(uriString);
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

    activePanels.set(uriString, panel);

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
      panel.webview.postMessage({
        command: 'init',
        filePath: doc.fileName,
        fileName: fileName,
        content: doc.getText(),
        isDirty: doc.isDirty,
      });
    }

    let isInternalSave = false;

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
      if (!message) return;

      if (message.command === 'ready') {
        sendInit();
      } else if (message.command === 'save') {
        try {
          isInternalSave = true;
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length),
          );
          edit.replace(doc.uri, fullRange, message.content);
          const success = await vscode.workspace.applyEdit(edit);
          if (success) {
            await doc.save();
            panel.webview.postMessage({
              command: 'saveSuccess',
              timestamp: Date.now(),
            });
          } else {
            vscode.window.showErrorMessage('LocalLeaf: Could not apply changes to file.');
          }
        } catch (err) {
          vscode.window.showErrorMessage(`LocalLeaf save error: ${err.message}`);
        } finally {
          isInternalSave = false;
        }
      }
    });

    // Listen for external file modifications
    const docChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === doc.uri.toString() && !isInternalSave) {
        panel.webview.postMessage({
          command: 'externalUpdate',
          content: event.document.getText(),
        });
      }
    });

    panel.onDidDispose(() => {
      docChangeSubscription.dispose();
      activePanels.delete(uriString);
    });
  });

  context.subscriptions.push(openCommand);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
