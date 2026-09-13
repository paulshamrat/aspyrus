const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

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
      const configured = vscode.workspace
        .getConfiguration('localleaf', target)
        .get('pythonPath', '');
      const root = vscode.workspace.getWorkspaceFolder(target)?.uri.fsPath;
      const localPython = root
        ? path.join(
            root,
            '.venv',
            process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
          )
        : '';
      const python =
        configured ||
        (localPython && existsSync(localPython)
          ? localPython
          : process.platform === 'win32'
            ? 'python'
            : 'python3');
      output.appendLine(`Starting LocalLeaf with Python: ${python}`);
      const backend = spawn(
        python,
        ['-m', 'localleaf', target.fsPath, '--no-browser', '--port', '0'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let buffer = '',
        stderr = '',
        settled = false;
      const timer = setTimeout(() => fail('Backend startup timed out.'), 15000);
      function fail(message) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        backend.kill();
        output.appendLine(message);
        const detail = stderr.trim().split('\n').slice(-2).join(' ').slice(0, 500) || message;
        output.show(true);
        vscode.window.showErrorMessage(
          `LocalLeaf could not start using ${python}: ${detail}. Check localleaf.pythonPath in Settings.`,
        );
      }
      backend.on('error', (e) => fail(e.message));
      backend.on('exit', (code) => {
        if (!settled) fail(`Backend exited (${code}).`);
      });
      backend.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-4000);
        output.append(data.toString());
      });
      backend.stdout.on('data', async (data) => {
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
          panel.onDidDispose(() => backend.kill());
          context.subscriptions.push(panel, { dispose: () => backend.kill() });
        } catch (e) {
          backend.kill();
          vscode.window.showErrorMessage(e.message);
        }
      });
      context.subscriptions.push({ dispose: () => backend.kill() });
    }),
  );
}
module.exports = { activate };
