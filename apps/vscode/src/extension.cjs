const vscode = require('vscode');
const { spawn } = require('node:child_process');

function activate(context) {
  const output = vscode.window.createOutputChannel('LocalLeaf');
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand('localleaf.open', async (uri) => {
      const document = vscode.window.activeTextEditor?.document;
      const target = uri || document?.uri;
      if (!target || target.scheme !== 'file' || !target.fsPath.toLowerCase().endsWith('.tex')) {
        vscode.window.showErrorMessage('Open a local .tex file first.');
        return;
      }
      if (
        document?.uri.toString() === target.toString() &&
        document.isDirty &&
        !(await document.save())
      )
        return;
      const python = vscode.workspace.getConfiguration('localleaf').get('pythonPath', 'python3');
      const process = spawn(
        python,
        ['-m', 'localleaf', target.fsPath, '--no-browser', '--port', '0'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let buffer = '',
        settled = false;
      const timer = setTimeout(() => fail('Backend startup timed out.'), 15000);
      function fail(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        process.kill();
        output.appendLine(message);
        vscode.window.showErrorMessage(
          'LocalLeaf could not start. Install the backend and configure localleaf.pythonPath. See LocalLeaf output.',
        );
      }
      process.on('error', (e) => fail(e.message));
      process.on('exit', (code) => {
        if (!settled) fail(`Backend exited (${code}).`);
      });
      process.stderr.on('data', (data) => output.append(data.toString()));
      process.stdout.on('data', async (data) => {
        output.append(data.toString());
        buffer += data.toString();
        const match = buffer.match(/LOCALLEAF_URL=(http:\/\/127\.0\.0\.1:\d+\/[^\r\n]*)/);
        if (!match || settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          const external = await vscode.env.asExternalUri(vscode.Uri.parse(match[1]));
          const url = external
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
          const panel = vscode.window.createWebviewPanel(
            'localleaf',
            'LocalLeaf',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true },
          );
          panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style></head><body><iframe title="LocalLeaf editor" src="${url}"></iframe></body></html>`;
          panel.onDidDispose(() => process.kill());
          context.subscriptions.push(panel, { dispose: () => process.kill() });
        } catch (e) {
          process.kill();
          vscode.window.showErrorMessage(e.message);
        }
      });
      context.subscriptions.push({ dispose: () => process.kill() });
    }),
  );
}
module.exports = { activate };
