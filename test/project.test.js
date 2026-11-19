import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {projectRoot, localDependency} = require('../src/project.cjs');

test('shared figure resolution stays inside canonical project including symlinks', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localleaf-paths-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.writeFileSync(path.join(root, '.localleaf.json'), '{}');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'panel.png'), 'image');
  fs.symlinkSync('/etc/passwd', path.join(root, 'assets', 'escaped.png'));
  for (const name of ['main', 'supplementary']) {
    fs.mkdirSync(path.join(root, name));
    const doc = path.join(root, name, `${name}.tex`);
    fs.writeFileSync(doc, 'document');
    assert.equal(projectRoot(doc), root);
    assert.equal(localDependency(doc, '../assets/panel.png'), path.join(root, 'assets', 'panel.png'));
    assert.equal(localDependency(doc, '../assets/escaped.png'), null);
    assert.equal(localDependency(doc, '/etc/passwd'), null);
    assert.equal(localDependency(doc, '../../../etc/passwd'), null);
  }
});

test('bundled templates exist and parse valid LaTeX blocks', (t) => {
  const mainTemplate = fs.readFileSync(path.join('example', 'main', 'main.tex'), 'utf8');
  assert.ok(mainTemplate.includes(String.raw`\documentclass`), 'main.tex must have documentclass');
  assert.ok(mainTemplate.includes(String.raw`\begin{document}`), 'main.tex must have begin{document}');
  assert.ok(mainTemplate.includes(String.raw`\begin{figure}`), 'main.tex must have sample figure');
  assert.ok(mainTemplate.includes(String.raw`\bibliography`), 'main.tex must have bibliography');

  const suppTemplate = fs.readFileSync(path.join('example', 'supplementary', 'supplementary.tex'), 'utf8');
  assert.ok(suppTemplate.includes(String.raw`\documentclass`), 'supplementary.tex must have documentclass');
  assert.ok(suppTemplate.includes(String.raw`\renewcommand{\thefigure}{S\arabic{figure}}`), 'supplementary.tex must have S figure numbering');
  assert.ok(suppTemplate.includes(String.raw`\begin{document}`), 'supplementary.tex must have begin{document}');
  assert.ok(suppTemplate.includes(String.raw`\bibliography`), 'supplementary.tex must have bibliography');

  for (const name of ['main', 'supplementary']) {
    const document = path.resolve('example', name, `${name}.tex`);
    const content = fs.readFileSync(document, 'utf8');
    const images = [...content.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)];
    assert.ok(images.length > 0);
    for (const image of images) {
      assert.ok(image[1].startsWith(`../assets/figures/${name}/`));
      assert.ok(localDependency(document, image[1]), `missing starter image: ${image[1]}`);
    }
  }
});
