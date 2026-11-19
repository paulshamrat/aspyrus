const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function directory(root, file) {
  return path.join(root, 'recovery', createHash('sha256').update(fs.realpathSync(file)).digest('hex'));
}
function list(root, file) {
  const dir = directory(root, file);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { return [{ ...JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), name }]; }
    catch { return []; }
  }).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
}
function checkpoint(root, file, content, kind = 'saved') {
  const previous = list(root, file);
  if (previous.find((entry) => entry.kind === kind)?.content === content) return;
  const dir = directory(root, file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const time = Math.max(Date.now(), (previous[0]?.time || 0) + 1);
  const name = `${time}-${randomUUID()}.json`;
  const temporary = path.join(dir, `${name}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify({ time, kind, content }), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, path.join(dir, name));
  // Separate budgets keep typing checkpoints from evicting saved versions.
  for (const entry of previous.filter((item) => item.kind === kind).slice(99)) {
    fs.unlinkSync(path.join(dir, entry.name));
  }
}
module.exports = { checkpoint, list };
