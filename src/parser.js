/**
 * LocalLeaf LaTeX Parser & Serializer
 * Designed for clean, distraction-free prose editing of LaTeX manuscripts.
 */

export const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const escapeLatex = (text) =>
  String(text)
    .replace(/\u00A0/g, '~')
    .replace(
      /[\\{}$&#%_^]/g,
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
        })[c],
    );

/**
 * Extracts a balanced { ... } group starting at position start.
 */
export function extractGroup(source, start) {
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
      if (depth === 0) return { text: source.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Renders inline LaTeX syntax into rich HTML with protected tokens.
 */
export function inlineToHtml(source) {
  let html = '';
  for (let i = 0; i < source.length; ) {
    // 1. Balanced group { ... }
    if (source[i] === '{') {
      const part = extractGroup(source, i);
      if (!part) {
        html += `<span class="latex-token" contenteditable="false" data-latex="${escapeHtml(source.slice(i))}">${escapeHtml(source.slice(i))}</span>`;
        break;
      }
      html += `<span data-group="true">${inlineToHtml(part.text)}</span>`;
      i = part.end;
      continue;
    }

    // 2. Inline math $ ... $
    if (source[i] === '$') {
      const end = source.indexOf('$', i + 1);
      if (end >= 0) {
        const raw = source.slice(i, end + 1);
        const math = raw.slice(1, -1).trim();
        html += `<span class="latex-token latex-math" contenteditable="false" data-latex="${escapeHtml(raw)}" title="Math: ${escapeHtml(raw)}">${escapeHtml(math || raw)}</span>`;
        i = end + 1;
        continue;
      }
    }

    // 3. LaTeX inline comments % ...
    if (source[i] === '%') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      html += `<span class="latex-comment" contenteditable="false" data-latex="${escapeHtml(source.slice(i, stop))}"></span>`;
      i = stop;
      continue;
    }

    // 4. Backslash commands & escaped symbols
    if (source[i] === '\\') {
      const nextChar = source[i + 1];

      // Escaped special symbols: \%, \&, \#, \_, \{, \}, \$
      if ('%&#_{}$'.includes(nextChar)) {
        html += escapeHtml(nextChar);
        i += 2;
        continue;
      }

      // Escaped space '\ '
      if (nextChar === ' ') {
        html += ' ';
        i += 2;
        continue;
      }

      // Explicit newline '\\'
      if (nextChar === '\\') {
        html += '<br>';
        i += 2;
        const optionalSpace = source.slice(i).match(/^\[[^\]]*\]/);
        if (optionalSpace) i += optionalSpace[0].length;
        continue;
      }

      // Macro or command: \cmd...
      const match = source.slice(i).match(/^\\([A-Za-z]+)(\*)?/);
      if (match) {
        const command = match[1];
        let end = i + match[0].length;

        // Color command: \textcolor{<color>}{<text>}
        if (command === 'textcolor') {
          const colorGroup = extractGroup(source, end);
          if (colorGroup) {
            const textGroup = extractGroup(source, colorGroup.end);
            if (textGroup) {
              const color = colorGroup.text.trim();
              html += `<span class="latex-color" style="color: ${escapeHtml(color)}" data-color="${escapeHtml(color)}">${inlineToHtml(textGroup.text)}</span>`;
              i = textGroup.end;
              continue;
            }
          }
        }

        // Citations: \cite{...}, \citep{...}, \citet{...}
        if (['cite', 'citep', 'citet', 'citeauthor', 'citeyear'].includes(command)) {
          const keysGroup = extractGroup(source, end);
          if (keysGroup) {
            const keys = keysGroup.text.trim();
            const raw = source.slice(i, keysGroup.end);
            html += `<span class="latex-token latex-cite" contenteditable="false" data-latex="${escapeHtml(raw)}" title="Citation: ${escapeHtml(keys)}">[cite: ${escapeHtml(keys)}]</span>`;
            i = keysGroup.end;
            continue;
          }
        }

        // Cross-references: \ref{...}, \eqref{...}, \autoref{...}
        if (['ref', 'eqref', 'autoref', 'pageref'].includes(command)) {
          const refGroup = extractGroup(source, end);
          if (refGroup) {
            const target = refGroup.text.trim();
            const raw = source.slice(i, refGroup.end);
            html += `<span class="latex-token latex-ref" contenteditable="false" data-latex="${escapeHtml(raw)}" title="Reference: ${escapeHtml(target)}">[ref: ${escapeHtml(target)}]</span>`;
            i = refGroup.end;
            continue;
          }
        }

        // Standard typography: \textbf, \textit, \emph, \underline, etc.
        const firstArg = extractGroup(source, end);
        const tagMap = {
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
        };

        if (tagMap[command] && firstArg) {
          const tag = tagMap[command];
          html += `<${tag}>${inlineToHtml(firstArg.text)}</${tag}>`;
          i = firstArg.end;
          continue;
        }

        // Links: \href{url}{text} and \url{url}
        if (command === 'href' && firstArg) {
          const secondArg = extractGroup(source, firstArg.end);
          if (secondArg) {
            const url = /^(https?:|mailto:)/i.test(firstArg.text) ? firstArg.text : '';
            html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inlineToHtml(secondArg.text)}</a>`;
            i = secondArg.end;
            continue;
          }
        }

        if (command === 'url' && firstArg) {
          const url = /^(https?:|mailto:)/i.test(firstArg.text) ? firstArg.text : '';
          html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(firstArg.text)}</a>`;
          i = firstArg.end;
          continue;
        }

        // Common math/scientific symbols without math delimiters
        const symbolMap = {
          AA: 'Å',
          pm: '±',
          times: '×',
          alpha: 'α',
          beta: 'β',
          gamma: 'γ',
          Delta: 'Δ',
          degree: '°',
          ldots: '…',
          dots: '…',
          LaTeX: 'LaTeX',
          TeX: 'TeX',
        };

        if (symbolMap[command]) {
          html += `<span class="latex-token latex-symbol" contenteditable="false" data-latex="\\${escapeHtml(command)}" title="\\${escapeHtml(command)}">${escapeHtml(symbolMap[command])}</span>`;
          i = end;
          continue;
        }

        // Spacing / formatting no-ops
        if (['par', 'noindent', 'relax', 'clearpage', 'newpage'].includes(command)) {
          i = end;
          continue;
        }

        // Any other unrecognized command: treat as protected token
        if (firstArg) end = firstArg.end;
        const tokenRaw = source.slice(i, end);
        html += `<span class="latex-token" contenteditable="false" data-latex="${escapeHtml(tokenRaw)}" title="${escapeHtml(tokenRaw)}">${escapeHtml(tokenRaw)}</span>`;
        i = end;
        continue;
      }
    }

    // Default regular character
    html += escapeHtml(source[i]);
    i++;
  }
  return html;
}

/**
 * Splits document body into semantic chunks (headings, paragraphs, environments, floats).
 * Guaranteed to partition body exactly such that chunks.join('') === body.
 */
export function splitBodyChunks(body) {
  const chunks = [];
  const lines = body.split(/(?<=\n)/);
  let current = '';
  let inEnv = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check environment begin/end
    const beginMatch = trimmed.match(/^\\begin\{([^}]+)\}/);
    if (beginMatch) inEnv++;
    const endMatch = trimmed.match(/^\\end\{([^}]+)\}/);
    if (endMatch) inEnv = Math.max(0, inEnv - 1);

    current += line;

    // Boundary decision points
    if (inEnv === 0) {
      if (trimmed === '') {
        chunks.push(current);
        current = '';
      } else if (/^\\(section|subsection|subsubsection|paragraph)\*?\{/.test(trimmed)) {
        chunks.push(current);
        current = '';
      }
    } else if (inEnv === 0 && endMatch) {
      chunks.push(current);
      current = '';
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Categorizes and builds DOM representation for a raw LaTeX chunk.
 */
export function processChunk(raw, id) {
  const text = raw.trim();

  // 1. Empty / whitespace line
  if (!text) {
    return { id, raw, hidden: true, html: '' };
  }

  // 2. Pure formatting/control commands (preserved silently)
  if (/^\\(modulolinenumbers|linenumbers|thispagestyle|pagestyle|vspace|setlength|tableofcontents|newpage|clearpage)\b/.test(text)) {
    return { id, raw, hidden: true, html: '' };
  }

  // 3. Headings: \section, \subsection, \subsubsection, \paragraph
  const headingMatch = text.match(/^\\(section|subsection|subsubsection|paragraph)(\*?)\{/);
  if (headingMatch) {
    const cmd = headingMatch[1];
    const isStar = headingMatch[2] === '*';
    const group = extractGroup(text, headingMatch[0].length - 1);
    if (group && group.end === text.length) {
      const tag = cmd === 'section' ? 'h2' : cmd === 'subsection' ? 'h3' : cmd === 'subsubsection' ? 'h4' : 'h5';
      return {
        id,
        raw,
        tag,
        cmd: cmd + (isStar ? '*' : ''),
        html: `<${tag} class="latex-heading ${tag}" data-cmd="${cmd}${isStar ? '*' : ''}">${inlineToHtml(group.text)}</${tag}>`,
      };
    }
  }

  // 4. Abstract environment
  const abstractMatch = text.match(/^\\begin\{abstract\}([\s\S]*)\\end\{abstract\}$/);
  if (abstractMatch) {
    return {
      id,
      raw,
      tag: 'div',
      env: 'abstract',
      html: `<div class="latex-abstract" data-env="abstract"><div class="abstract-title" contenteditable="false">ABSTRACT</div><div class="abstract-content">${inlineToHtml(abstractMatch[1].trim())}</div></div>`,
    };
  }

  // 5. Itemize and Enumerate lists
  const listMatch = text.match(/^\\begin\{(itemize|enumerate)\}([\s\S]*)\\end\{\1\}$/);
  if (listMatch) {
    const env = listMatch[1];
    const tag = env === 'itemize' ? 'ul' : 'ol';
    const items = listMatch[2].split(/\\item\s+/).filter((s) => s.trim());
    const itemsHtml = items.map((item) => `<li>${inlineToHtml(item.trim())}</li>`).join('');
    return {
      id,
      raw,
      tag,
      env,
      html: `<${tag} class="latex-list" data-env="${env}">${itemsHtml}</${tag}>`,
    };
  }

  // 6. Complex environments to preserve (figures, tables, equations, tikz)
  if (/^\\begin\{(figure|table|equation|align|gather|tikzpicture|quote|minipage)\*?\}/.test(text)) {
    const captionMatch = text.match(/\\caption\{([^}]+)\}/);
    const envMatch = text.match(/^\\begin\{([^}]+)\}/);
    const envName = envMatch ? envMatch[1] : 'LaTeX Float';
    const preview = captionMatch ? captionMatch[1] : `${envName} environment`;

    return {
      id,
      raw,
      protected: true,
      html: `<div class="latex-protected-card" contenteditable="false" title="LaTeX environment preserved byte-for-byte"><span class="card-badge">${escapeHtml(envName)}</span> <span class="card-caption">${escapeHtml(preview)}</span></div>`,
    };
  }

  // 7. Standalone maketitle, bibliography, etc.
  if (/^\\(maketitle|bibliography|bibliographystyle)\b/.test(text)) {
    return {
      id,
      raw,
      hidden: true,
      html: '',
    };
  }

  // 8. Normal Prose Paragraph
  return {
    id,
    raw,
    tag: 'p',
    html: `<p class="latex-paragraph">${inlineToHtml(text)}</p>`,
  };
}

/**
 * Parses full LaTeX source into preamble, structured blocks, and suffix.
 */
export function parseDocument(source) {
  const docStart = source.indexOf('\\begin{document}');
  const docEnd = source.lastIndexOf('\\end{document}');

  const preamble = docStart >= 0 ? source.slice(0, docStart + '\\begin{document}'.length) : '';
  const suffix = docEnd >= 0 ? source.slice(docEnd) : '';
  const body = source.slice(
    docStart >= 0 ? docStart + '\\begin{document}'.length : 0,
    docEnd >= 0 ? docEnd : source.length,
  );

  const rawChunks = splitBodyChunks(body);
  const blocks = rawChunks.map((raw, id) => processChunk(raw, id));

  return {
    preamble,
    suffix,
    blocks,
    original: source,
  };
}

/**
 * Converts an edited DOM node back to LaTeX syntax.
 */
export function domNodeToLatex(node) {
  if (!node) return '';

  // 1. Plain Text Node
  if (node.nodeType === 3) {
    return escapeLatex(node.textContent);
  }

  // 2. Not an Element
  if (node.nodeType !== 1) return '';

  // 3. Protected Token with explicit LaTeX data
  if (node.dataset.latex !== undefined) {
    return node.dataset.latex;
  }

  // 4. Colored Text: \textcolor{color}{...}
  if (node.dataset.color) {
    const inner = [...node.childNodes].map(domNodeToLatex).join('');
    return `\\textcolor{${node.dataset.color}}{${inner}}`;
  }

  // 5. Children text
  let children = [...node.childNodes].map(domNodeToLatex).join('');

  // 6. Formatting Tags
  const commandMap = {
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
  };

  const cmd = commandMap[node.tagName];
  if (cmd) return `\\${cmd}{${children}}`;

  if (node.tagName === 'A') {
    const href = (node.getAttribute('href') || '').replace(/[{}\\]/g, '');
    return `\\href{${href}}{${children}}`;
  }

  if (node.tagName === 'BR') {
    return ' \\\\\n';
  }

  if (node.dataset.group) {
    return `{${children}}`;
  }

  return children;
}

/**
 * Serializes a block container element back into LaTeX block syntax.
 */
export function serializeDomBlock(element, originalBlock) {
  if (originalBlock && (originalBlock.protected || originalBlock.hidden)) {
    return originalBlock.raw;
  }

  const child = element.firstElementChild;
  if (!child) {
    const text = element.textContent.trim();
    return text ? `${escapeLatex(text)}\n\n` : '';
  }

  // Headings: h2, h3, h4, h5
  if (/^H[2-5]$/.test(child.tagName)) {
    const cmd = child.dataset.cmd || (child.tagName === 'H2' ? 'section' : child.tagName === 'H3' ? 'subsection' : child.tagName === 'H4' ? 'subsubsection' : 'paragraph');
    const content = [...child.childNodes].map(domNodeToLatex).join('').trim();
    return `\\${cmd}{${content}}\n\n`;
  }

  // Abstract
  if (child.classList.contains('latex-abstract') || child.dataset.env === 'abstract') {
    const bodyEl = child.querySelector('.abstract-content') || child;
    const content = [...bodyEl.childNodes].map(domNodeToLatex).join('').trim();
    return `\\begin{abstract}\n${content}\n\\end{abstract}\n\n`;
  }

  // Lists: ul, ol
  if (child.tagName === 'UL' || child.tagName === 'OL') {
    const env = child.dataset.env || (child.tagName === 'UL' ? 'itemize' : 'enumerate');
    const items = [...child.querySelectorAll('li')]
      .map((li) => `\\item ${[...li.childNodes].map(domNodeToLatex).join('').trim()}`)
      .join('\n');
    return `\\begin{${env}}\n${items}\n\\end{${env}}\n\n`;
  }

  // Protected Cards: keep raw
  if (child.classList.contains('latex-protected-card') && originalBlock) {
    return originalBlock.raw;
  }

  // Default Paragraph
  const content = [...child.childNodes].map(domNodeToLatex).join('').trim();
  return content ? `${content}\n\n` : '';
}

/**
 * Serializes the full editor DOM tree back to complete LaTeX source code.
 */
export function serializeDocument(parsedDoc, container) {
  if (!parsedDoc || !container) return '';

  let body = '';
  // Map rendered DOM elements by block ID
  const domMap = new Map();
  for (const child of container.children) {
    if (child.dataset.blockId !== undefined) {
      domMap.set(Number(child.dataset.blockId), child);
    }
  }

  for (let id = 0; id < parsedDoc.blocks.length; id++) {
    const block = parsedDoc.blocks[id];
    const el = domMap.get(id);

    // If block is hidden or protected, preserve byte-for-byte
    if (!el || block.hidden || block.protected) {
      body += block.raw;
    } else {
      // If block in DOM is identical to snapshot, emit raw
      if (el.innerHTML === block.snapshot) {
        body += block.raw;
      } else {
        body += serializeDomBlock(el, block);
      }
    }
  }

  return parsedDoc.preamble + body + parsedDoc.suffix;
}
