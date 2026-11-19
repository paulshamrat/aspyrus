const path = require('node:path');
const fs = require('node:fs');
const child_process = require('node:child_process');
const { projectRoot } = require('./project.cjs');
const activeRoots = new Set();

function run(program, args, cwd, output) {
  return new Promise((resolve, reject) => child_process.execFile(program, args,
    { cwd, timeout: 180000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (stdout) output.appendLine?.(stdout);
      if (error) return reject(new Error(stderr || stdout || error.message));
      resolve(stdout);
    }));
}
async function compileManuscript({texFilePath, mode = 'numbers', output = console, trusted = false}) {
  if (!['numbers', 'dois', 'keys'].includes(mode)) throw new Error('Unknown citation mode');
  const root = projectRoot(texFilePath);
  if (activeRoots.has(root)) throw new Error('Another Aspyrus build is running in this project');
  activeRoots.add(root);
  const start = Date.now();
  try {
    const configPath = fs.existsSync(path.join(root, '.aspyrus.json'))
      ? path.join(root, '.aspyrus.json')
      : path.join(root, '.localleaf.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
    const buildScript = path.join(root, 'scripts', 'build.py');
    const scriptedBuild = !fs.existsSync(configPath) && fs.existsSync(buildScript)
      && /^ASPYRUS_BUILD_ENTRY = True$/m.test(fs.readFileSync(buildScript, 'utf8'));
    if (scriptedBuild) {
      if (!trusted) throw new Error('Trust this workspace before running its manuscript build script');
      const relative = path.relative(fs.realpathSync(root), fs.realpathSync(buildScript));
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Manuscript build script escapes the project');
      await run('python3', [buildScript, '--aspyrus-root', path.dirname(__dirname), '--mode', mode], root, output);
      const dir = path.dirname(texFilePath), stem = path.basename(texFilePath, '.tex');
      const pdfPath = path.join(dir, stem + '.pdf'), docxPath = path.join(dir, stem + '.docx');
      const deck = path.join(root, 'assets', 'figures', 'figures.pdf');
      for (const file of [pdfPath, docxPath]) {
        if (!fs.existsSync(file) || !fs.statSync(file).size || fs.statSync(file).mtimeMs < start - 1000) throw new Error(`Build did not create a current output: ${file}`);
      }
      return {success:true, pdfPath, docxPath, figuresPath:fs.existsSync(deck) ? deck : null, message:`Built manuscript through scripts/build.py`, elapsed:((Date.now()-start)/1000).toFixed(1)};
    }
    const prepare = config.prepare;
    if (prepare !== undefined && (!Array.isArray(prepare) || !prepare.length || prepare.some(arg => typeof arg !== 'string' || !arg || arg.includes('\0')))) {
      throw new Error('Aspyrus prepare must be a nonempty array of command arguments');
    }
    if (prepare && !trusted) throw new Error('Trust this workspace before running its configured Aspyrus preparation command');
    await run('python3', ['-c', `import shutil, importlib.util, sys
missing = [x for x in ['pdflatex','bibtex','pandoc','pdftotext','pdfinfo'] if not shutil.which(x)]
missing += [x for x in ['pypandoc','docx'] if importlib.util.find_spec(x) is None]
if missing: sys.exit('Aspyrus requires: ' + ', '.join(missing) + '. Install LaTeX, Pandoc, Poppler and Python pypandoc/python-docx; see Aspyrus README.')`], root, output);
    if (prepare) await run(prepare[0], prepare.slice(1), root, output);
    output.appendLine?.(`[Aspyrus] Building PDF, DOCX and figures: ${texFilePath}`);
    await run('python3', [path.join(__dirname, 'tools', 'export.py'), 'compile', texFilePath, '--mode', mode], root, output);
    const dir = path.dirname(texFilePath), stem = path.basename(texFilePath, '.tex');
    const pdfPath = path.join(dir, stem + '.pdf'), docxPath = path.join(dir, stem + '.docx');
    const record = JSON.parse(fs.readFileSync(path.join(dir, `.${stem}-export.json`), 'utf8'));
    const hasFigures = typeof record.checks.figure_pdf === 'object';
    const figuresPath = hasFigures ? path.join(dir, 'figures.pdf') : null;
    for (const file of [pdfPath, docxPath, figuresPath].filter(Boolean)) {
      if (!fs.existsSync(file) || !fs.statSync(file).size || fs.statSync(file).mtimeMs < start - 1000) throw new Error(`Build did not create a current output: ${file}`);
    }
    return {success:true, pdfPath, docxPath, figuresPath, message:`Built ${stem}.pdf, ${stem}.docx${hasFigures ? ' and figures.pdf' : ' (no figures)'}`, elapsed:((Date.now()-start)/1000).toFixed(1)};
  } finally { activeRoots.delete(root); }
}
module.exports = { compileManuscript };
