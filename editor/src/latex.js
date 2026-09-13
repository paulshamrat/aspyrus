// A deliberately bounded visual editor. Unrecognized source is never reconstructed.
export const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const escapeLatex = (text) =>
  text.replace(
    /[\\{}$&#%_^~]/g,
    (c) =>
      ({
        '\\': '\\textbackslash{}',
        '{': '\\{',
        '}': '\\}',
        $: '\\$',
        '&': '\\&',
        '#': '\\#',
        '%': '\\%',
        _: '\\_',
        '^': '\\textasciicircum{}',
        '~': '\\textasciitilde{}',
      })[c],
  );

function inline(text) {
  let html = '',
    cursor = 0;
  const pattern = /\\(textbf|textit|underline)\{([^{}\\$%&#_^~]*)\}|\\([%&#_${}])/g;
  for (const match of text.matchAll(pattern)) {
    const plain = text.slice(cursor, match.index);
    if (/[\\{}$%&#_^~]/.test(plain)) return null;
    html += escapeHtml(plain);
    if (match[1]) {
      const tag = { textbf: 'strong', textit: 'em', underline: 'u' }[match[1]];
      html += `<${tag}>${escapeHtml(match[2])}</${tag}>`;
    } else html += escapeHtml(match[3]);
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  if (/[\\{}$%&#_^~]/.test(tail)) return null;
  return html + escapeHtml(tail);
}

export function parseSource(source) {
  let inDocument = false,
    offset = 0,
    environmentDepth = 0,
    conditionalDepth = 0;
  return source.split(/(?<=\n)/).map((raw) => {
    const start = offset;
    offset += raw.length;
    const newline = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : '';
    const line = raw.slice(0, raw.length - newline.length);
    let prefix = '',
      suffix = '',
      html = null,
      tag = 'p';
    if (line.trim() === '\\end{document}') inDocument = false;
    if (inDocument && !environmentDepth && !conditionalDepth && line.trim()) {
      const heading = line.match(/^(\s*\\(?:section|subsection|subsubsection)\*?\{)(.*)(\}\s*)$/);
      const plain = line.match(/^(\s*)(.*?)(\s*)$/);
      const match = heading || plain;
      prefix = match[1];
      suffix = match[3];
      html = inline(match[2]);
      if (heading) tag = heading[1].includes('subsection') ? 'h3' : 'h2';
    }
    // Entire environments/conditionals remain source-backed, including their text.
    if (inDocument) {
      environmentDepth += (line.match(/\\begin\{/g) || []).length;
      environmentDepth -= (line.match(/\\end\{/g) || []).length;
      environmentDepth = Math.max(0, environmentDepth);
      conditionalDepth += (line.match(/\\if[a-zA-Z]*\b/g) || []).length;
      conditionalDepth -= (line.match(/\\fi\b/g) || []).length;
      conditionalDepth = Math.max(0, conditionalDepth);
    }
    if (line.trim() === '\\begin{document}') inDocument = true;
    return { raw, start, end: offset, prefix, suffix, newline, html, tag };
  });
}

export function applyEdits(source, edits) {
  let end = source.length;
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.start < 0 || edit.end > end || edit.start > edit.end)
      throw new Error('Overlapping source edits');
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    end = edit.start;
  }
  return result;
}

export function serializeInline(node) {
  if (node.nodeType === 3) return escapeLatex(node.textContent);
  const children = [...node.childNodes].map(serializeInline).join('');
  const command = { B: 'textbf', STRONG: 'textbf', I: 'textit', EM: 'textit', U: 'underline' }[
    node.tagName
  ];
  if (command) return `\\${command}{${children}}`;
  if (node.tagName === 'BR') return ' ';
  return children;
}
