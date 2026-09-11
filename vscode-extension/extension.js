const vscode = require('vscode');
const http = require('http');
const cp = require('child_process');

let serverProcess = null;

function ensureServerRunning(filePath) {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:4848/api/file_info', (res) => {
      if (res.statusCode === 200) {
        if (filePath) {
          switchFile(filePath).then(() => resolve(true));
        } else {
          resolve(true);
        }
      } else {
        startServer(filePath, resolve);
      }
    });

    req.on('error', () => {
      startServer(filePath, resolve);
    });

    req.setTimeout(600, () => {
      req.destroy();
      startServer(filePath, resolve);
    });
  });
}

function startServer(filePath, callback) {
  const serverScript = '/home/paul/tools/localleaf/server.py';
  const args = [serverScript, '--no-browser', '--port', '4848'];
  if (filePath) {
    args.push(filePath);
  }

  serverProcess = cp.spawn('/home/paul/miniforge3/bin/python3', args, {
    detached: true,
    stdio: 'ignore'
  });
  serverProcess.unref();

  setTimeout(() => callback(true), 500);
}

function switchFile(filePath) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ file_path: filePath });
    const req = http.request(
      'http://127.0.0.1:4848/api/switch_file',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      },
      () => resolve()
    );
    req.on('error', () => resolve());
    req.write(postData);
    req.end();
  });
}

function activate(context) {
  let disposable = vscode.commands.registerCommand('localleaf.openVisualEditor', async (uri) => {
    let filePath = uri ? uri.fsPath : null;
    if (!filePath && vscode.window.activeTextEditor) {
      filePath = vscode.window.activeTextEditor.document.uri.fsPath;
    }

    await ensureServerRunning(filePath);

    // Open Webview Panel inside VS Code
    const panel = vscode.window.createWebviewPanel(
      'localleafVisualEditor',
      '🍃 Visual LaTeX Editor',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #1e1e1e;
          }
          iframe {
            width: 100%;
            height: 100%;
            border: none;
          }
        </style>
      </head>
      <body>
        <iframe src="http://localhost:4848"></iframe>
      </body>
      </html>
    `;
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
