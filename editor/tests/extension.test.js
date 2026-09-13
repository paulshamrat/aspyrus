import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import path from 'node:path';

test('extension honors configured Python and reports the actual startup failure', async () => {
  let command,
    launched,
    message,
    shown = false;
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => {};
  const target = { scheme: 'file', fsPath: '/project/main.tex' };
  const vscode = {
    commands: {
      registerCommand: (_id, callback) => {
        command = callback;
        return { dispose() {} };
      },
    },
    workspace: {
      getConfiguration: (_name, resource) => {
        assert.equal(resource, target);
        return { get: () => '/installed/python' };
      },
      getWorkspaceFolder: () => undefined,
    },
    window: {
      createOutputChannel: () => ({
        appendLine() {},
        append() {},
        show() {
          shown = true;
        },
      }),
      showErrorMessage: (text) => {
        message = text;
      },
    },
  };
  // The CommonJS entry point exports activate through module.exports.
  const sandbox = {
    module: { exports: {} },
    process: { platform: 'linux' },
    setTimeout,
    clearTimeout,
    require: (name) =>
      ({
        vscode: vscode,
        'node:path': path,
        'node:fs': { existsSync: () => false },
        'node:child_process': {
          spawn: (...args) => {
            launched = args;
            return child;
          },
        },
      })[name],
  };
  runInNewContext(readFileSync('vscode/src/extension.cjs', 'utf8'), sandbox);
  sandbox.module.exports.activate({ subscriptions: [] });
  await command(target);
  assert.equal(launched[0], '/installed/python');
  child.stderr.emit('data', 'No module named localleaf\n');
  child.emit('exit', 1);
  assert.match(message, /No module named localleaf/);
  assert.match(message, /installed\/python/);
  assert.equal(shown, true);
});
