import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'backend/src/localleaf/assets');
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });

for (const item of ['index.html', 'styles.css']) {
  await cp(path.join(root, 'editor', item), path.join(assets, item));
}

await build({
  entryPoints: {
    app: path.join(root, 'editor/src/app.js'),
  },
  outdir: path.join(assets, 'src'),
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
});

console.log('Built lightweight LocalLeaf visual editor assets.');
