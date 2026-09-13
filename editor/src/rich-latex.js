/** Source-backed CV blocks. Unchanged blocks are emitted byte-for-byte. */
import { escapeHtml, escapeLatex } from './latex.js';

function group(source, start) {
  if (source[start] !== '{') return null;
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (!depth) return { text: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

function splitTop(source, delimiter) {
  const parts = [];
  let start = 0,
    depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (!depth && source.startsWith(delimiter, i)) {
      parts.push(source.slice(start, i));
      i += delimiter.length - 1;
      start = i + 1;
      continue;
    }
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
  }
  parts.push(source.slice(start));
  return parts;
}

function token(raw, label = raw) {
  return `<span class="latex-token" contenteditable="false" data-latex="${escapeHtml(raw)}">${escapeHtml(label)}</span>`;
}

export function inlineHtml(source) {
  let html = '';
  for (let i = 0; i < source.length;) {
    if (source[i] === '{') {
      const part = group(source, i);
      if (!part) {
        html += token(source.slice(i));
        break;
      }
      const size = part.text.match(
        /^\\fontsize\{([\d.]+)(?:pt)?\}\{([\d.]+)(?:pt)?\}\\selectfont\s*/,
      );
      if (size)
        html += `<span style="font-size:${size[1]}pt;line-height:${size[2]}pt">${inlineHtml(part.text.slice(size[0].length))}</span>`;
      else html += `<span data-group="true">${inlineHtml(part.text)}</span>`;
      i = part.end;
      continue;
    }
    if (source[i] === '$') {
      const end = source.indexOf('$', i + 1);
      if (end >= 0) {
        const raw = source.slice(i, end + 1),
          math = raw.slice(1, -1).trim();
        html += token(raw, /\\cdot/.test(math) ? ' · ' : /\\vert/.test(math) ? ' | ' : math);
        i = end + 1;
        continue;
      }
    }
    if (source[i] === '%') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      html += `<span class="latex-comment" contenteditable="false" data-latex="${escapeHtml(source.slice(i, stop))}"></span>`;
      i = stop;
      continue;
    }
    if (source[i] === '\\') {
      const escaped = source[i + 1];
      if ('%&#_${}'.includes(escaped)) {
        html += escapeHtml(escaped);
        i += 2;
        continue;
      }
      if (escaped === ' ') {
        html += ' ';
        i += 2;
        continue;
      }
      if (escaped === '\\') {
        html += '<br>';
        i += 2;
        const space = source.slice(i).match(/^\[[^\]]*\]/);
        if (space) i += space[0].length;
        continue;
      }
      const match = source.slice(i).match(/^\\([A-Za-z]+)(\*)?/);
      if (match) {
        const command = match[1];
        let end = i + match[0].length;
        const first = group(source, end);
        if (
          [
            'textbf',
            'textit',
            'emph',
            'underline',
            'sout',
            'textsuperscript',
            'textsubscript',
            'texttt',
            'textsf',
            'textrm',
          ].includes(command) &&
          first
        ) {
          const tag = {
            textbf: 'strong',
            textit: 'em',
            emph: 'em',
            underline: 'u',
            sout: 's',
            textsuperscript: 'sup',
            textsubscript: 'sub',
            texttt: 'code',
            textsf: 'span',
            textrm: 'span',
          }[command];
          html += `<${tag}${command === 'textsf' ? ' style="font-family:sans-serif"' : ''}>${inlineHtml(first.text)}</${tag}>`;
          i = first.end;
          continue;
        }
        if (command === 'href' && first) {
          const second = group(source, first.end);
          if (second) {
            const url = /^(https?:|mailto:)/i.test(first.text) ? first.text : '';
            html += `<a href="${escapeHtml(url)}">${inlineHtml(second.text)}</a>`;
            i = second.end;
            continue;
          }
        }
        if (command === 'url' && first) {
          html += `<a href="${escapeHtml(/^(https?:|mailto:)/i.test(first.text) ? first.text : '')}">${escapeHtml(first.text)}</a>`;
          i = first.end;
          continue;
        }
        if (['par', 'noindent', 'selectfont'].includes(command)) {
          i = end;
          continue;
        }
        if (['LaTeX', 'TeX', 'dots', 'ldots'].includes(command)) {
          html += token(match[0], command === 'dots' || command === 'ldots' ? '…' : command);
          i = end;
          continue;
        }
        if (first) end = first.end;
        html += token(source.slice(i, end));
        i = end;
        continue;
      }
    }
    html += escapeHtml(source[i]);
    i++;
  }
  return html;
}

export function sourceChunks(body) {
  const chunks = [];
  let start = 0,
    depth = 0,
    environments = 0,
    conditions = 0;
  const lines = body.split(/(?<=\n)/);
  let offset = 0;
  for (const line of lines) {
    const clean = line.replace(/(?<!\\)%[^\r\n]*/g, '');
    for (let i = 0; i < clean.length; i++) {
      if (clean[i] === '\\') {
        i++;
        continue;
      }
      if (clean[i] === '{') depth++;
      if (clean[i] === '}') depth--;
    }
    environments +=
      (clean.match(/\\begin\{/g) || []).length - (clean.match(/\\end\{/g) || []).length;
    conditions +=
      (clean.match(/\\if[a-zA-Z]*\b/g) || []).length - (clean.match(/\\fi\b/g) || []).length;
    offset += line.length;
    if (depth <= 0 && environments <= 0 && conditions <= 0) {
      chunks.push(body.slice(start, offset));
      start = offset;
      depth = environments = conditions = 0;
    }
  }
  if (start < body.length) chunks.push(body.slice(start));
  return chunks;
}

function rows(source) {
  return splitTop(source, '\\\\')
    .map((row) => row.replace(/^\s*\[[^\]]*\]/, '').trim())
    .filter(Boolean);
}

function blockHtml(raw) {
  const text = raw.trim();
  if (!text || /^(%|\\(?:thispagestyle|pagestyle|vspace|setlength)\b)/.test(text))
    return { html: '', hidden: true };
  if (
    /\\if[a-zA-Z]*\b|\\begin\{(?!center|flushleft|flushright|tabular|itemize|enumerate)/.test(text)
  )
    return { html: escapeHtml(raw), protected: true };
  const center = text.match(/^\\begin\{(center|flushleft|flushright)\}([\s\S]*)\\end\{\1\}$/);
  if (center) {
    const align = { center: 'center', flushleft: 'left', flushright: 'right' }[center[1]];
    return {
      html: `<div class="cv-header-block" style="text-align:${align}" data-align="${align}">${rows(
        center[2],
      )
        .map(
          (row, i) => `<div class="${i === 0 ? 'cv-name' : 'cv-address'}">${inlineHtml(row)}</div>`,
        )
        .join('')}</div>`,
    };
  }
  const heading = text.match(/^\\(cvsection|section\*?|subsection\*?|subsubsection\*?)\{/);
  if (heading) {
    const part = group(text, heading[0].length - 1);
    if (part && part.end === text.length)
      return {
        html: `<h2 class="cv-section-title" data-command="${heading[1]}">${inlineHtml(part.text)}</h2>`,
      };
  }
  const list = text.match(/^\\begin\{(itemize|enumerate)\}(\[[^\]]*\])?([\s\S]*)\\end\{\1\}$/);
  if (list && !/\\begin\{/.test(list[3])) {
    const tag = list[1] === 'itemize' ? 'ul' : 'ol';
    const items = list[3].split(/\\item\s+/).filter((s) => s.trim());
    return {
      html: `<${tag} data-options="${escapeHtml(list[2] || '')}">${items.map((item) => `<li>${inlineHtml(item.trim())}</li>`).join('')}</${tag}>`,
    };
  }
  if (text.startsWith('\\begin{tabular}')) {
    const spec = group(text, '\\begin{tabular}'.length);
    if (spec && text.endsWith('\\end{tabular}')) {
      const body = text.slice(spec.end, -'\\end{tabular}'.length);
      return {
        html: `<table class="cv-table" data-columns="${escapeHtml(spec.text)}"><tbody>${rows(body)
          .map(
            (row) =>
              `<tr>${splitTop(row, '&')
                .map((cell) => `<td>${inlineHtml(cell.trim())}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`,
      };
    }
  }
  if (text.includes('\\hfill')) {
    const parts = splitTop(text.replace(/\\\\\s*$/, ''), '\\hfill');
    if (parts.length === 2)
      return {
        html: `<div class="cv-entry-row"><span class="cv-entry-title">${inlineHtml(parts[0].trim())}</span><span class="cv-entry-date">${inlineHtml(parts[1].trim())}</span></div>`,
      };
  }
  if (/^\\(?:begin|end|newcommand|renewcommand|input|include|bibliography|maketitle)\b/.test(text))
    return { html: escapeHtml(raw), protected: true };
  const trailing = text.match(/(\\\\(?:\[[^\]]*\])?|\\par)\s*$/);
  const content = trailing ? text.slice(0, trailing.index) : text;
  return {
    html: `<p class="cv-subline" data-ending="${escapeHtml(trailing?.[1] || '')}">${inlineHtml(content)}</p>`,
  };
}

function length(value) {
  return /^\d+(?:\.\d+)?(?:pt|px|em|cm|mm|in)$/.test(value || '') ? value : null;
}
function fontPoints(value, fallback = 10) {
  if (!value) return fallback;
  const n = parseFloat(value);
  return value.endsWith('px') ? n * 0.75 : n;
}

export function htmlToLatex(node) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeLatex(node.textContent);
  if (node.nodeType !== 1) return '';
  if (node.dataset.latex !== undefined) return node.dataset.latex;
  let text = [...node.childNodes].map(htmlToLatex).join('');
  const command = {
    STRONG: 'textbf',
    B: 'textbf',
    EM: 'textit',
    I: 'textit',
    U: 'underline',
    S: 'sout',
    STRIKE: 'sout',
    SUP: 'textsuperscript',
    SUB: 'textsubscript',
    CODE: 'texttt',
  }[node.tagName];
  if (command) text = `\\${command}{${text}}`;
  if (node.tagName === 'A')
    text = `\\href{${(node.getAttribute('href') || '').replace(/[{}\\]/g, '')}}{${text}}`;
  if (node.tagName === 'BR') return ' \\\\\n';
  if (node.tagName === 'FONT') {
    if (node.getAttribute('face'))
      text = `{\\${/mono|courier/i.test(node.getAttribute('face')) ? 'ttfamily' : /sans|arial|helvetica/i.test(node.getAttribute('face')) ? 'sffamily' : 'rmfamily'} ${text}}`;
    if (node.getAttribute('size')) {
      const pt = [0, 8, 10, 12, 14, 18, 24, 36][Number(node.getAttribute('size'))] || 10;
      text = `{\\fontsize{${pt}pt}{${pt * 1.2}pt}\\selectfont ${text}}`;
    }
  }
  const style = node.style;
  if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) text = `\\textbf{${text}}`;
  if (style.fontStyle === 'italic') text = `\\textit{${text}}`;
  if (style.textDecorationLine?.includes('underline')) text = `\\underline{${text}}`;
  if (style.fontSize || style.lineHeight) {
    const pt = fontPoints(style.fontSize),
      line = style.lineHeight;
    const baseline = line ? (/[a-z]/i.test(line) ? fontPoints(line) : Number(line) * pt) : pt * 1.2;
    text = `{\\fontsize{${pt}pt}{${baseline}pt}\\selectfont ${text}}`;
  }
  if (style.fontFamily)
    text = `{\\${/mono|courier/i.test(style.fontFamily) ? 'ttfamily' : /sans|arial|helvetica/i.test(style.fontFamily) ? 'sffamily' : 'rmfamily'} ${text}}`;
  if (node.dataset.group) text = `{${text}}`;
  return text;
}

export function serializeBlock(node, preamble = '') {
  if (node.nodeType === 3)
    return node.textContent.trim() ? escapeLatex(node.textContent) + '\n' : '';
  if (node.nodeType !== 1) return '';
  let text;
  if (node.classList.contains('cv-header-block')) {
    const env =
      { left: 'flushleft', right: 'flushright', center: 'center' }[
        node.dataset.align || node.style.textAlign
      ] || 'center';
    text = `\\begin{${env}}\n${[...node.children].map((child) => htmlToLatex(child)).join(' \\\\[2pt]\n')}\n\\end{${env}}\n`;
  } else if (node.classList.contains('cv-entry-row')) {
    text = `${htmlToLatex(node.querySelector('.cv-entry-title'))} \\hfill ${htmlToLatex(node.querySelector('.cv-entry-date'))} \\\\\n`;
  } else if (['H1', 'H2', 'H3', 'H4'].includes(node.tagName)) {
    const command =
      node.dataset.command ||
      (node.tagName === 'H2' && preamble.includes('\\newcommand{\\cvsection}')
        ? 'cvsection'
        : { H1: 'section*', H2: 'section*', H3: 'subsection*', H4: 'subsubsection*' }[
            node.tagName
          ]);
    text = `\\${command}{${htmlToLatex(node)}}\n`;
  } else if (['UL', 'OL'].includes(node.tagName)) {
    const env = node.tagName === 'UL' ? 'itemize' : 'enumerate';
    text = `\\begin{${env}}${node.dataset.options || ''}\n${[...node.children].map((li) => '\\item ' + htmlToLatex(li)).join('\n')}\n\\end{${env}}\n`;
  } else if (node.tagName === 'TABLE') {
    const columns = node.dataset.columns || 'll';
    text = `\\begin{tabular}{${columns}}\n${[...node.rows].map((row) => [...row.cells].map(htmlToLatex).join(' & ') + ' \\\\').join('\n')}\n\\end{tabular}\n`;
  } else if (node.tagName === 'HR') text = '\\noindent\\rule{\\linewidth}{0.4pt}\n';
  else text = htmlToLatex(node) + (node.dataset.ending || '\\par') + '\n';
  if (!node.classList.contains('cv-header-block') && node.style?.textAlign) {
    const command = {
      left: 'raggedright',
      right: 'raggedleft',
      center: 'centering',
      justify: 'justifying',
    }[node.style.textAlign];
    if (command) text = `{\\${command} ${text}\\par}\n`;
  }
  const space = node.dataset.vspace || node.style?.marginBottom;
  if (length(space)) text += `\\vspace{${space}}\n`;
  return text;
}

export class RichDocument {
  constructor(container, preamble) {
    this.container = container;
    this.preamble = preamble;
  }
  render(source) {
    const start = source.indexOf('\\begin{document}'),
      end = source.lastIndexOf('\\end{document}');
    this.prefix = start < 0 ? '' : source.slice(0, start + '\\begin{document}'.length);
    this.suffix = end < 0 ? '' : source.slice(end);
    this.originalPreamble = start < 0 ? '' : source.slice(0, start);
    this.preamble.value = this.originalPreamble;
    const classOptions = this.originalPreamble.match(/\\documentclass\[([^\]]*)\]/)?.[1];
    const baseSize = classOptions?.match(/(?:^|,)\s*(10|11|12)pt\s*(?:,|$)/)?.[1] || '10';
    this.container.style.fontSize = `${baseSize}pt`;
    const body = source.slice(
      start < 0 ? 0 : start + '\\begin{document}'.length,
      end < 0 ? source.length : end,
    );
    this.blocks = sourceChunks(body).map((raw, id) => ({ raw, id, ...blockHtml(raw) }));
    this.container.replaceChildren();
    for (const block of this.blocks) {
      const element = this.container.ownerDocument.createElement('div');
      element.dataset.sourceId = block.id;
      element.className = 'source-group';
      if (block.protected) {
        element.contentEditable = 'false';
        element.classList.add('source-protected');
        element.title = 'LaTeX source preserved; edit this block in Code.';
      }
      if (block.hidden) {
        element.hidden = true;
        element.contentEditable = 'false';
      }
      element.innerHTML = block.html;
      this.container.append(element);
      block.snapshot = element.innerHTML;
      block.tokens = [...element.querySelectorAll('[data-latex]')].map(
        (token) => token.dataset.latex,
      );
      block.element = element;
    }
    this.original = source;
  }
  serialize() {
    if (!this.blocks) return '';
    let body = '';
    const seen = new Set();
    for (const node of this.container.childNodes) {
      const id = node.dataset?.sourceId;
      if (id !== undefined) {
        const block = this.blocks[Number(id)];
        if (!block || seen.has(block.id))
          throw new Error('Source block structure changed. Switch to Code to recover.');
        seen.add(block.id);
        const remaining = [...node.querySelectorAll('[data-latex]')].map(
          (token) => token.dataset.latex,
        );
        for (const token of block.tokens) {
          const index = remaining.indexOf(token);
          if (index < 0)
            throw new Error('Protected math or LaTeX was removed. Undo this edit before saving.');
          remaining.splice(index, 1);
        }
        if (node.innerHTML === block.snapshot || block.protected || block.hidden) body += block.raw;
        else
          body += [...node.childNodes]
            .map((child) => serializeBlock(child, this.preamble.value))
            .join('');
      } else body += serializeBlock(node, this.preamble.value);
    }
    for (const block of this.blocks)
      if (!seen.has(block.id) && (block.protected || block.hidden))
        throw new Error('A protected source block was removed. Undo this edit before saving.');
    let preamble = this.preamble.value;
    if (body.includes('\\sout{') && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*ulem/.test(preamble))
      preamble += '\n\\usepackage[normalem]{ulem}\n';
    if (body.includes('\\justifying') && !preamble.includes('{ragged2e}'))
      preamble += '\n\\usepackage{ragged2e}\n';
    const prefix =
      preamble === this.originalPreamble ? this.prefix : preamble + '\\begin{document}';
    return prefix + body + this.suffix;
  }
}
