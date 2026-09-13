import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'backend/src/localleaf/assets');
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const item of ['index.html', 'styles.css'])
  await cp(path.join(root, 'editor', item), path.join(assets, item));
// Monaco ships an embedded sanitizer. Resolve that module to our audited version.
const sanitizer = {
  name: 'patched-monaco-sanitizer',
  setup(builder) {
    builder.onResolve({ filter: /dompurify\/dompurify\.js$/ }, () => ({
      path: path.join(root, 'node_modules/dompurify/dist/purify.es.mjs'),
    }));
  },
};
await build({
  entryPoints: {
    app: path.join(root, 'editor/src/app.js'),
    'editor.worker': path.join(root, 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js'),
  },
  outdir: path.join(assets, 'src'),
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  loader: { '.ttf': 'file' },
  external: ['/vendor/*'],
  plugins: [sanitizer],
  metafile: true,
}).then((result) => {
  if (
    !Object.keys(result.metafile.inputs).some((name) =>
      name.endsWith('dompurify/dist/purify.es.mjs'),
    )
  )
    throw new Error('Patched sanitizer was not bundled');
});
for (const dependency of ['monaco-editor', 'dompurify']) {
  await cp(
    path.join(root, 'node_modules', dependency, 'LICENSE'),
    path.join(assets, 'vendor', dependency + '-LICENSE'),
  );
}
await cp(
  path.join(root, 'node_modules/monaco-editor/ThirdPartyNotices.txt'),
  path.join(assets, 'vendor/monaco-ThirdPartyNotices.txt'),
);
console.log('Built offline editor assets with patched sanitizer.');
