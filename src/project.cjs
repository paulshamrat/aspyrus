const fs = require('node:fs');
const path = require('node:path');

function projectRoot(document) {
  const dir = fs.realpathSync(path.dirname(document));
  for (let current = dir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.aspyrus.json')) || fs.existsSync(path.join(current, '.localleaf.json')) || fs.existsSync(path.join(current, '.git'))) return current;
    if (path.dirname(current) === current) return dir;
  }
}
function localDependency(document, relative) {
  if (!relative || path.isAbsolute(relative)) return null;
  try {
    const root = projectRoot(document);
    const resolved = fs.realpathSync(path.resolve(path.dirname(document), relative));
    return resolved.startsWith(root + path.sep) && fs.statSync(resolved).isFile() ? resolved : null;
  } catch { return null; }
}
module.exports = { projectRoot, localDependency };
