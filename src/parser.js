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
    .replace(/\u2014/g, '---')
    .replace(/\u2013/g, '--')
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
 * Expands LaTeX \frac and \sqrt commands with balanced braces into mathematical HTML.
 */
export function expandFractionsAndRoots(text) {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('\\frac', i)) {
      let cur = i + 5;
      while (cur < text.length && /\s/.test(text[cur])) cur++;
      const numGroup = extractGroup(text, cur);
      if (numGroup) {
        cur = numGroup.end;
        while (cur < text.length && /\s/.test(text[cur])) cur++;
        const denGroup = extractGroup(text, cur);
        if (denGroup) {
          const numHtml = expandFractionsAndRoots(numGroup.text);
          const denHtml = expandFractionsAndRoots(denGroup.text);
          out += `<span class="math-frac"><span class="math-num">${numHtml}</span><span class="math-den">${denHtml}</span></span>`;
          i = denGroup.end;
          continue;
        }
      }
    }

    if (text.startsWith('\\sqrt', i)) {
      let cur = i + 5;
      while (cur < text.length && /\s/.test(text[cur])) cur++;
      const argGroup = extractGroup(text, cur);
      if (argGroup) {
        const argHtml = expandFractionsAndRoots(argGroup.text);
        out += `<span class="math-sqrt"><span class="math-surd">√</span><span class="math-sqrt-stem">${argHtml}</span></span>`;
        i = argGroup.end;
        continue;
      }
    }

    out += text[i];
    i++;
  }
  return out;
}

/**
 * Pretty-prints LaTeX math into publication-standard mathematical typography.
 */
export function formatMathForDisplay(mathRaw) {
  let text = String(mathRaw || '').trim();
  if (text.startsWith('$') && text.endsWith('$')) {
    text = text.slice(1, -1).trim();
  }

  // 1. Fractions and Square Roots (handled with balanced brace matching)
  text = expandFractionsAndRoots(text);

  // 2. Escape HTML special characters (<, >, &, ", ') so raw signs do not corrupt the DOM,
  // while preserving generated span tags
  text = text.replace(/<span class="([^"]+)">|<\/span>/g, '@@TAG_START@@$1@@TAG_MID@@');
  text = escapeHtml(text);
  text = text.replace(/@@TAG_START@@([^@]+)@@TAG_MID@@/g, '<span class="$1">');
  text = text.replace(/@@TAG_START@@@@TAG_MID@@/g, '</span>');

  // 3. Mathematical Font Styles & Vectors
  text = text.replace(/\\(?:mathbf|boldsymbol)\{([^}]+)\}/g, '<strong class="math-bold">$1</strong>');
  text = text.replace(/\\mathit\{([^}]+)\}/g, '<em class="math-italic">$1</em>');
  text = text.replace(/\\(?:text|mathrm)\{([^}]+)\}/g, '<span class="math-upright">$1</span>');
  text = text.replace(/\\mathbb\{([A-Za-z])\}/g, '<span class="math-bb">$1</span>');
  text = text.replace(/\\mathcal\{([A-Za-z])\}/g, '<span class="math-cal">$1</span>');

  // 5. Greek & Mathematical Symbols
  const mathSymbols = {
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\Delta': 'Δ',
    '\\epsilon': 'ε',
    '\\varepsilon': 'ε',
    '\\zeta': 'ζ',
    '\\eta': 'η',
    '\\theta': 'θ',
    '\\Theta': 'Θ',
    '\\iota': 'ι',
    '\\kappa': 'κ',
    '\\lambda': 'λ',
    '\\Lambda': 'Λ',
    '\\mu': 'μ',
    '\\nu': 'ν',
    '\\xi': 'ξ',
    '\\Xi': 'Ξ',
    '\\pi': 'π',
    '\\Pi': 'Π',
    '\\rho': 'ρ',
    '\\sigma': 'σ',
    '\\Sigma': 'Σ',
    '\\tau': 'τ',
    '\\upsilon': 'υ',
    '\\Upsilon': 'Υ',
    '\\phi': 'φ',
    '\\Phi': 'Φ',
    '\\chi': 'χ',
    '\\psi': 'ψ',
    '\\Psi': 'Ψ',
    '\\omega': 'ω',
    '\\Omega': 'Ω',
    '\\pm': '±',
    '\\mp': '∓',
    '\\times': '×',
    '\\cdot': '·',
    '\\div': '÷',
    '\\ge': '≥',
    '\\geq': '≥',
    '\\le': '≤',
    '\\leq': '≤',
    '\\approx': '≈',
    '\\sim': '~',
    '\\simeq': '≃',
    '\\cong': '≅',
    '\\equiv': '≡',
    '\\neq': '≠',
    '\\ne': '≠',
    '\\in': '∈',
    '\\notin': '∉',
    '\\subset': '⊂',
    '\\subseteq': '⊆',
    '\\cup': '∪',
    '\\cap': '∩',
    '\\forall': '∀',
    '\\exists': '∃',
    '\\partial': '∂',
    '\\nabla': '∇',
    '\\infty': '∞',
    '\\to': '→',
    '\\rightarrow': '→',
    '\\leftarrow': '←',
    '\\Rightarrow': '⇒',
    '\\Leftarrow': '⇐',
    '\\Leftrightarrow': '⇔',
    '\\leftrightarrow': '↔',
    '\\AA': 'Å',
    '\\circ': '°',
    '\\langle': '⟨',
    '\\rangle': '⟩',
    '\\sum': '∑',
    '\\prod': '∏',
    '\\int': '∫',
  };

  for (const [cmd, unicode] of Object.entries(mathSymbols)) {
    text = text.replace(new RegExp(cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])', 'g'), unicode);
  }

  // 6. Upright math functions
  const mathFunctions = ['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'min', 'max', 'lim', 'det', 'dim'];
  for (const fn of mathFunctions) {
    text = text.replace(new RegExp('\\\\' + fn + '(?![a-zA-Z])', 'g'), `<span class="math-upright">${fn}</span>`);
  }

  // 7. Remove \left and \right delimiters while preserving brackets
  text = text.replace(/\\(?:left|right)\s*/g, '');

  // 8. LaTeX escaped symbols and spacing
  text = text.replace(/\\([%$&#_{}])/g, '$1');
  text = text.replace(/--/g, '–');
  text = text.replace(/_\{([^}]+)\}/g, '<sub>$1</sub>');
  text = text.replace(/_([+\-a-zA-Z0-9])/g, '<sub>$1</sub>');
  text = text.replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
  text = text.replace(/\^([+\-a-zA-Z0-9])/g, '<sup>$1</sup>');
  text = text.replace(/\\[,;: ]/g, ' ');
  text = text.replace(/\\(?:quad|qquad)/g, '  ');

  return text;
}

/**
 * Renders inline LaTeX syntax into rich, publication-standard HTML.
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
        const display = formatMathForDisplay(raw);
        html += `<span class="latex-token latex-math" data-latex="${escapeHtml(raw)}" data-initial="${escapeHtml(display)}" title="Math: ${escapeHtml(raw)}">${display}</span>`;
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

    // 4. LaTeX tie ~ (non-breaking space)
    if (source[i] === '~') {
      html += '&nbsp;';
      i++;
      continue;
    }

    // 5. En-dash -- and Em-dash ---
    if (source[i] === '-' && source[i + 1] === '-') {
      if (source[i + 2] === '-') {
        html += '—'; // em-dash
        i += 3;
        continue;
      }
      html += '–'; // en-dash
      i += 2;
      continue;
    }

    // 6. Backslash commands & escaped symbols
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
            html += `<span class="latex-token latex-cite" contenteditable="false" data-latex="${escapeHtml(raw)}" title="Citation: ${escapeHtml(keys)}">[${escapeHtml(keys)}]</span>`;
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
            html += `<span class="latex-token latex-ref" contenteditable="false" data-latex="${escapeHtml(raw)}" title="Reference: ${escapeHtml(target)}">[${escapeHtml(target)}]</span>`;
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

  // 4. Abstract environment (clean, publication-standard presentation)
  const abstractMatch = text.match(/^\\begin\{abstract\}([\s\S]*)\\end\{abstract\}$/);
  if (abstractMatch) {
    return {
      id,
      raw,
      tag: 'div',
      env: 'abstract',
      html: `<div class="latex-abstract" data-env="abstract"><div class="abstract-heading" contenteditable="false">Abstract</div><p class="abstract-body">${inlineToHtml(abstractMatch[1].trim())}</p></div>`,
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

  // 6. Display Equations: \begin{equation}, \begin{align}, \begin{gather}, \[, $$
  const eqEnvMatch = text.match(/^\\begin\{(equation|align|gather)(\*?)\}([\s\S]*)\\end\{\1\2\}$/);
  if (eqEnvMatch) {
    const envName = eqEnvMatch[1];
    const isStarred = eqEnvMatch[2] === '*';
    const innerMath = eqEnvMatch[3].trim();
    const formattedMath = formatMathForDisplay(innerMath);
    const numBadge = isStarred ? '' : `<span class="equation-num" contenteditable="false">(${id + 1})</span>`;

    return {
      id,
      raw,
      tag: 'div',
      env: envName + (isStarred ? '*' : ''),
      isEquation: true,
      html: `<div class="latex-equation-block" data-env="${escapeHtml(envName + (isStarred ? '*' : ''))}" data-latex="${escapeHtml(text)}"><div class="equation-content latex-math">${formattedMath}</div>${numBadge}</div>`,
    };
  }

  const bracketMatch = text.match(/^\\\[([\s\S]*)\\\]$/) || text.match(/^\$\$([\s\S]*)\$\$$/);
  if (bracketMatch) {
    const innerMath = bracketMatch[1].trim();
    const formattedMath = formatMathForDisplay(innerMath);
    return {
      id,
      raw,
      tag: 'div',
      isEquation: true,
      cmd: text.startsWith('$$') ? '$$' : '\\[',
      html: `<div class="latex-equation-block" data-cmd="${text.startsWith('$$') ? '$$' : '\\['}" data-latex="${escapeHtml(text)}"><div class="equation-content latex-math">${formattedMath}</div></div>`,
    };
  }

  // 7. Complex environments to preserve (figures, tables, tikz, quote, minipage)
  if (/^\\begin\{(figure|table|tikzpicture|quote|minipage)\*?\}/.test(text)) {
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

  // Extract paper title if present in source (preamble or body)
  let titleInfo = null;
  const titleMatch = source.match(/\\title\{/);
  if (titleMatch) {
    const grp = extractGroup(source, titleMatch.index + 6);
    if (grp) {
      titleInfo = { text: grp.text.trim() };
      // Prepend Title Block to canvas
      blocks.unshift({
        id: 'title',
        isTitle: true,
        tag: 'h1',
        cmd: 'title',
        raw: `\\title{${grp.text}}`,
        html: `<h1 class="latex-title" data-cmd="title">${inlineToHtml(grp.text.trim())}</h1>`,
        snapshot: `<h1 class="latex-title" data-cmd="title">${inlineToHtml(grp.text.trim())}</h1>`,
      });
    }
  }

  return {
    preamble,
    suffix,
    blocks,
    titleInfo,
    original: source,
  };
}

/**
 * Converts edited math Unicode text back to valid LaTeX math syntax.
 */
export function mathTextToLatex(text) {
  let out = String(text);
  const operatorMap = [
    [/\s*±\s*/g, ' \\pm '],
    [/–/g, '\\text{--}'],
    [/—/g, '\\text{---}'],
    [/\s*≥\s*/g, ' \\ge '],
    [/\s*≤\s*/g, ' \\le '],
    [/\s*≈\s*/g, ' \\approx '],
    [/\s*≠\s*/g, ' \\neq '],
    [/\s*×\s*/g, ' \\times '],
    [/\s*·\s*/g, ' \\cdot '],
    [/\s*→\s*/g, ' \\to '],
    [/\s*∈\s*/g, ' \\in '],
    [/\s*°\s*/g, '^\\circ '],
    [/Å/g, '\\AA '],
  ];

  for (const [pattern, repl] of operatorMap) {
    out = out.replace(pattern, repl);
  }

  const greekMap = {
    'α': '\\alpha ',
    'β': '\\beta ',
    'γ': '\\gamma ',
    'δ': '\\delta ',
    'Δ': '\\Delta ',
    'ε': '\\epsilon ',
    'θ': '\\theta ',
    'λ': '\\lambda ',
    'μ': '\\mu ',
    'π': '\\pi ',
    'σ': '\\sigma ',
    'φ': '\\phi ',
    'ω': '\\omega ',
    '∞': '\\infty ',
    '⟨': '\\langle ',
    '⟩': '\\rangle ',
    '%': '\\%',
  };

  for (const [uni, cmd] of Object.entries(greekMap)) {
    out = out.replaceAll(uni, cmd);
  }

  return out;
}

/**
 * Recursively converts a math DOM node tree back to LaTeX math.
 */
export function domMathToLatex(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    return mathTextToLatex(node.textContent);
  }
  if (node.nodeType !== 1) return '';

  const tag = (node.tagName || '').toUpperCase();
  const inner = [...(node.childNodes || [])].map(domMathToLatex).join('');

  if (tag === 'SUB') return `_{${inner}}`;
  if (tag === 'SUP') return `^{${inner}}`;
  if (tag === 'STRONG' || tag === 'B') return `\\mathbf{${inner}}`;
  if (tag === 'EM' || tag === 'I') return `\\mathit{${inner}}`;

  if (node.classList?.contains('math-upright') || node.classList?.contains('math-text')) {
    const trimmed = inner.trim();
    if (['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'min', 'max', 'lim', 'det'].includes(trimmed)) {
      return `\\${trimmed} `;
    }
    if (/^[\d.,\s+\-±–—]+$/.test(trimmed)) {
      return inner;
    }
    return `\\text{${inner}}`;
  }

  if (node.classList?.contains('math-frac')) {
    const num = node.querySelector?.('.math-num');
    const den = node.querySelector?.('.math-den');
    const numLatex = num ? domMathToLatex(num) : '';
    const denLatex = den ? domMathToLatex(den) : '';
    return `\\frac{${numLatex}}{${denLatex}}`;
  }

  if (node.classList?.contains('math-sqrt')) {
    const stem = node.querySelector?.('.math-sqrt-stem');
    const stemLatex = stem ? domMathToLatex(stem) : '';
    return `\\sqrt{${stemLatex}}`;
  }

  return inner;
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

  // 3. Math Token (editable by user)
  const isMath = node.classList?.contains('latex-math') || (typeof node.className === 'string' && node.className.includes('latex-math'));
  if (isMath) {
    if (node.dataset?.latex !== undefined) {
      const expected = formatMathForDisplay(node.dataset.latex);
      if (node.innerHTML === expected || (node.dataset?.initial !== undefined && node.innerHTML === node.dataset.initial)) {
        return node.dataset.latex;
      }
    }
    const inner = [...(node.childNodes || [])].map(domMathToLatex).join('').trim();
    return inner ? `$${inner}$` : '';
  }

  // 4. Other Protected Tokens with explicit LaTeX data
  if (node.dataset?.latex !== undefined) {
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
 * Serializes an element back into LaTeX block syntax.
 */
export function serializeDomBlock(element, originalBlock) {
  if (originalBlock && (originalBlock.protected || originalBlock.hidden)) {
    return originalBlock.raw;
  }

  // 1. Headings (h2, h3, h4, h5)
  const heading = element.querySelector?.('h2, h3, h4, h5') || (['H2','H3','H4','H5'].includes(element.tagName) ? element : null);
  if (heading) {
    const cmd = heading.dataset?.cmd || (heading.tagName === 'H2' ? 'section' : heading.tagName === 'H3' ? 'subsection' : heading.tagName === 'H4' ? 'subsubsection' : 'paragraph');
    const content = [...heading.childNodes].map(domNodeToLatex).join('').trim();
    return `\\${cmd}{${content}}\n\n`;
  }

  // 2. Abstract
  const abstractEl = element.classList?.contains('latex-abstract') ? element : element.querySelector?.('.latex-abstract');
  if (abstractEl) {
    const bodyEl = abstractEl.querySelector?.('.abstract-body') || abstractEl.querySelector?.('.abstract-content') || abstractEl;
    const content = [...bodyEl.childNodes].map(domNodeToLatex).join('').trim();
    return `\\begin{abstract}\n${content}\n\\end{abstract}\n\n`;
  }

  // 3. Lists
  const listEl = element.querySelector?.('ul, ol') || (['UL', 'OL'].includes(element.tagName) ? element : null);
  if (listEl) {
    const env = listEl.dataset?.env || (listEl.tagName === 'UL' ? 'itemize' : 'enumerate');
    const items = [...(listEl.querySelectorAll ? listEl.querySelectorAll('li') : [])]
      .map((li) => `\\item ${[...li.childNodes].map(domNodeToLatex).join('').trim()}`)
      .join('\n');
    return `\\begin{${env}}\n${items}\n\\end{${env}}\n\n`;
  }

  // 4. Protected Cards: keep raw
  if (element.classList?.contains('latex-protected-card') && originalBlock) {
    return originalBlock.raw;
  }

  // 5. Equation Blocks: preserve byte-for-byte
  const eqEl = element.classList?.contains('latex-equation-block') ? element : element.querySelector?.('.latex-equation-block');
  if (eqEl && originalBlock) {
    return originalBlock.raw;
  }

  // 6. Default Paragraph
  const p = element.querySelector?.('p') || element;
  const content = [...p.childNodes].map(domNodeToLatex).join('').trim();
  return content ? `${content}\n\n` : '';
}

/**
 * Serializes the full editor DOM tree back to complete LaTeX source code.
 */
export function serializeDocument(parsedDoc, container) {
  if (!parsedDoc || !container) return '';

  let body = '';
  let preamble = parsedDoc.preamble;

  // 1. Check if paper title was edited
  const titleEl = container.querySelector?.('[data-cmd="title"]');
  if (titleEl && parsedDoc.titleInfo) {
    const newTitle = [...titleEl.childNodes].map(domNodeToLatex).join('').trim();
    if (newTitle && newTitle !== parsedDoc.titleInfo.text) {
      preamble = preamble.replace(/\\title\{[\s\S]*?\}/, `\\title{${newTitle}}`);
    }
  }

  // 2. Map DOM blocks by ID
  const domMap = new Map();
  for (const child of container.children) {
    if (child.dataset?.blockId !== undefined) {
      domMap.set(String(child.dataset.blockId), child);
    }
  }

  // 3. Reconstruct body sequentially
  for (let id = 0; id < parsedDoc.blocks.length; id++) {
    const block = parsedDoc.blocks[id];
    if (block.isTitle) continue; // title serialized in preamble

    const el = domMap.get(String(block.id));

    if (!el || block.hidden || block.protected) {
      body += block.raw;
    } else {
      if (el.innerHTML === block.snapshot) {
        body += block.raw;
      } else {
        body += serializeDomBlock(el, block);
      }
    }
  }

  return preamble + body + parsedDoc.suffix;
}
