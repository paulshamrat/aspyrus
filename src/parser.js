/**
 * LocalLeaf LaTeX Parser & Serializer
 * Designed for clean, distraction-free prose editing of LaTeX manuscripts.
 */

export const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function detectCanvasTypography(source) {
  const preamble = String(source || '').split('\\begin{document}', 1)[0];
  const classMatch = preamble.match(/\\documentclass(?:\[([^\]]*)\])?\{[^}]+\}/);
  const classOptions = classMatch?.[1] || '';
  const baseSizePt = /(?:^|,)\s*12pt\s*(?:,|$)/.test(classOptions)
    ? 12
    : /(?:^|,)\s*11pt\s*(?:,|$)/.test(classOptions)
      ? 11
      : null;
  const usesOneHalfSpacing = /\\onehalfspacing\b/.test(preamble);
  const normalHeadingCommands = [];
  for (const command of ['section', 'subsection', 'subsubsection']) {
    const pattern = new RegExp('\\\\titleformat\\{\\\\' + command + '\\}\\{[^}]*\\\\normalsize');
    if (pattern.test(preamble)) normalHeadingCommands.push(command);
  }
  const titleSize = preamble.includes('\\normalfont\\bfseries\\normalsize \\@title')
    ? 'normal'
    : preamble.includes('\\normalfont\\bfseries\\large \\@title')
      ? 'large'
      : null;
  const captionSize = preamble.includes('font=normalsize') || preamble.includes('font={normalsize')
    ? 'normal'
    : preamble.includes('font=small') || preamble.includes('font={small')
      ? 'small'
      : null;

  return {
    isLatexArticle: baseSizePt !== null,
    baseSizePt,
    usesOneHalfSpacing,
    titleSize,
    normalHeadingCommands,
    captionSize,
  };
}

export const escapeLatex = (text) => {
  const macroTokens = [];
  const textWithPlaceholders = String(text).replace(
    /\\(?:includegraphics(?:\[[^\]]*\])?\{[^}]+\}|href\{[^}]+\}\{[^}]+\}|(?:url|path|label|input|include|captionof\{[^}]+\}|cite[a-z*]*|revref|[a-zA-Z]*ref|eqref)\{[^}]+\})/g,
    (m) => {
      macroTokens.push(m);
      return `XXLATEXMACRO${macroTokens.length - 1}XX`;
    },
  );

  const escaped = textWithPlaceholders
    .replace(/\u00A0/g, '~')
    .replace(/\u2014/g, '---')
    .replace(/\u2013/g, '--')
    .replace(/\u201C/g, '``')
    .replace(/\u201D/g, "''")
    .replace(/\u2018/g, '`')
    .replace(/\u2019/g, "'")
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
    )
    .replace(/[αβγδΔεζηθικλμνξπρστυφχψωΓΘΛΞΠΣΥΦΨΩÅ±×°≤≥≠≈→·′″‴]/g, (c) => ({
      'α': '$\\upalpha$',
      'β': '$\\upbeta$',
      'γ': '$\\upgamma$',
      'δ': '$\\updelta$',
      'Δ': '$\\Delta$',
      'ε': '$\\upepsilon$',
      'θ': '$\\uptheta$',
      'λ': '$\\uplambda$',
      'μ': '$\\upmu$',
      'π': '$\\uppi$',
      'σ': '$\\upsigma$',
      'φ': '$\\upphi$',
      'ω': '$\\upomega$',
      'ζ': '$\\upzeta$',
      'η': '$\\upeta$',
      'ι': '$\\upiota$',
      'κ': '$\\upkappa$',
      'ν': '$\\upnu$',
      'ξ': '$\\upxi$',
      'ρ': '$\\uprho$',
      'τ': '$\\uptau$',
      'υ': '$\\upupsilon$',
      'χ': '$\\upchi$',
      'ψ': '$\\uppsi$',
      'Γ': '$\\Gamma$',
      'Θ': '$\\Theta$',
      'Λ': '$\\Lambda$',
      'Ξ': '$\\Xi$',
      'Π': '$\\Pi$',
      'Σ': '$\\Sigma$',
      'Υ': '$\\Upsilon$',
      'Φ': '$\\Phi$',
      'Ψ': '$\\Psi$',
      'Ω': '$\\Omega$',
      'Å': '\\AA{}',
      '±': '$\\pm$',
      '×': '$\\times$',
      '°': '$^\\circ$',
      '≤': '$\\le$',
      '≥': '$\\ge$',
      '≠': '$\\neq$',
      '≈': '$\\approx$',
      '→': '$\\to$',
      '·': '$\\cdot$',
      '′': '$^\\prime$',
      '″': '$^{\\prime\\prime}$',
      '‴': '$^{\\prime\\prime\\prime}$',
    })[c] || c);

  return escaped.replace(/XXLATEXMACRO(\d+)XX/g, (_, idx) => macroTokens[Number(idx)]);
};

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
 * Returns true only for inline math used as a numeric measurement or charge.
 * Symbolic expressions (for example, R_g or k_{\text{cat}}) remain mathematical.
 */
export function isUprightMeasurementMath(mathRaw) {
  let text = String(mathRaw || '').trim();
  if (text.startsWith('$') && text.endsWith('$')) {
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('\\(') && text.endsWith('\\)')) {
    text = text.slice(2, -2).trim();
  }

  text = text
    .replace(/\\(?:text|mathrm)\{(?:[A-Za-zµÅ°%/ .~^-]|\\AA|\\[,;: !])+\}/g, '')
    .replace(/\\(?:times|cdot|div|pm|mp|geq?|leq?|approx|sim|simeq|cong|equiv|neq?|AA|circ|prime|left|right|quad|qquad)(?![A-Za-z])/g, '')
    .replace(/\\[,;: !]/g, '');

  return text.length > 0 && /^[0-9.,+\-−×÷±≤≥≈*/^_{}()[\]<>~=|\s'′″‴]+$/.test(text);
}
/**
 * Pretty-prints LaTeX math into publication-standard mathematical typography.
 */
export function formatMathForDisplay(mathRaw) {
  let text = String(mathRaw || '').trim();
  if (text.startsWith('$') && text.endsWith('$')) {
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('\\(') && text.endsWith('\\)')) {
    text = text.slice(2, -2).trim();
  }

  // 1. Fractions and Square Roots (handled with balanced brace matching)
  text = expandFractionsAndRoots(text);

  // 2. Escape HTML special characters (<, >, &, ", ') so raw signs do not corrupt the DOM,
  // while preserving generated span tags
  text = text.replace(/<span class="([^"]+)">|<\/span>/g, '@@TAG_START@@$1@@TAG_MID@@');
  text = escapeHtml(text);
  text = text.replace(/@@TAG_START@@([^@]+)@@TAG_MID@@/g, '<span class="$1">');
  text = text.replace(/@@TAG_START@@@@TAG_MID@@/g, '</span>');

  // Primes from LaTeX commands
  text = text.replace(/\\prime\\prime\\prime(?![a-zA-Z])/g, '‴');
  text = text.replace(/\\prime\\prime(?![a-zA-Z])/g, '″');
  text = text.replace(/\\prime(?![a-zA-Z])/g, '′');

  // Math-mode apostrophes (which represent primes in LaTeX math: e.g. f'(x), 5', x'')
  text = text.replace(/(^|[^a-zA-Z\\]|[0-9a-zA-Z})\]^])&#39;&#39;&#39;(?![a-zA-Z])/g, '$1‴');
  text = text.replace(/(^|[^a-zA-Z\\]|[0-9a-zA-Z})\]^])&#39;&#39;(?![a-zA-Z])/g, '$1″');
  text = text.replace(/(^|[^a-zA-Z\\]|[0-9a-zA-Z})\]^])&#39;(?![a-zA-Z])/g, '$1′');

  // 3. Mathematical Font Styles & Vectors
  text = text.replace(/\\(?:mathbf|boldsymbol)\{([^}]+)\}/g, '<strong class="math-bold">$1</strong>');
  text = text.replace(/\\mathit\{([^}]+)\}/g, '<em class="math-italic">$1</em>');
  text = text.replace(/\\(?:text|mathrm)\{([^}]+)\}/g, '<span class="math-upright">$1</span>');
  text = text.replace(/\\mathbb\{([A-Za-z])\}/g, '<span class="math-bb">$1</span>');
  text = text.replace(/\\mathcal\{([A-Za-z])\}/g, '<span class="math-cal">$1</span>');

  // 4. Large Operators with Stacked Bounds (\sum, \prod, \int, \coprod)
  const largeOpMap = { sum: '∑', prod: '∏', int: '∫', coprod: '∐' };
  const largeOpRe = /\\(sum|prod|int|coprod)(?:(?:_\{([^}]+)\}|_([^\s{^]))(?:\^\{([^}]+)\}|\^([^\s{_]))?|(?:\^\{([^}]+)\}|\^([^\s{_]))(?:_\{([^}]+)\}|_([^\s{^]))?)/g;
  text = text.replace(largeOpRe, (match, op, s1, s2, p1, p2, p3, p4, s3, s4) => {
    const symbol = largeOpMap[op] || op;
    const sub = s1 || s2 || s3 || s4;
    const sup = p1 || p2 || p3 || p4;
    let bounds = '';
    if (sup) bounds += `<sup class="math-limit-sup">${sup}</sup>`;
    if (sub) bounds += `<sub class="math-limit-sub">${sub}</sub>`;
    return `<span class="math-limits" data-latex="${match.trim()}"><span class="math-limit-op">${symbol}</span><span class="math-limit-bounds">${bounds}</span></span> `;
  });

  // 5. Greek & Mathematical Symbols
  const mathSymbols = {
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\Gamma': 'Γ',
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
    '\\prime': '′',
    '\\textasciitilde': '~',
    '\\textasciicircum': '^',
    '\\langle': '⟨',
    '\\rangle': '⟩',
    '\\sum': '∑',
    '\\prod': '∏',
    '\\int': '∫',
  };

  // Explicit upgreek labels remain upright without guessing a symbol's meaning.
  const greekNames = 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega'.split(' ');
  for (const name of greekNames) {
    const unicode = mathSymbols['\\' + name] || ({ vartheta: 'ϑ', varpi: 'ϖ', varrho: 'ϱ', varsigma: 'ς', varphi: 'ϕ' })[name];
    if (unicode) text = text.replace(new RegExp('\\\\up' + name + '(?![A-Za-z])', 'g'), `<span class="math-upright math-literal">${unicode}</span>`);
  }
  for (const name of ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']) {
    text = text.replace(new RegExp('\\\\Up' + name.toLowerCase() + '(?![A-Za-z])', 'g'), `<span class="math-upright math-literal">${mathSymbols['\\' + name]}</span>`);
  }

  for (const [cmd, unicode] of Object.entries(mathSymbols)) {
    text = text.replace(new RegExp(cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])', 'g'), unicode);
  }

  // Remove whitespace between Greek characters and variables/numbers (e.g. Δ H -> ΔH)
  text = text.replace(/([αβγδΔεθλμπσφω])\s+(?=[a-zA-Z0-9])/g, '$1');

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

  // Naturally raised glyphs (primes and degree sign) don't need <sup>
  text = text.replace(/\^\{?([′″‴°])\}?/g, '$1');

  text = text.replace(/(<[^>]+>)|(_\{([^}]+)\}|_([+\-a-zA-Z0-9]))/g, (m, tag, _, b1, b2) => {
    if (tag) return tag;
    return `<sub>${b1 || b2}</sub>`;
  });
  text = text.replace(/(<[^>]+>)|(\^\{([^}]+)\}|\^([+\-a-zA-Z0-9\u0370-\u03ff*†‡]))/g, (m, tag, _, b1, b2) => {
    if (tag) return tag;
    return `<sup>${b1 || b2}</sup>`;
  });

  // Math operators outside HTML tags: minus sign (U+2212)
  text = text.replace(/(<[^>]+>)|((?<=[=+\-/*,(]|^)\s*-\s*|\s+-\s+)/g, (m, tag, op) => (tag ? tag : ' − '));

  text = text.replace(/\\[,;: ]/g, ' ');
  text = text.replace(/\\(?:quad|qquad)/g, '  ');

  text = text.replace(/^\s*−\s*(?=\d)/, '−');
  // Upright tokens inside symbolic math; explicit mathit remains intentional.
  const parts = text.split(/(<[^>]+>)/);
  const stack = [];
  text = parts.map(part => {
    if (part.startsWith('<')) {
      if (part.startsWith('</')) stack.pop();
      else if (!part.endsWith('/>')) stack.push(part);
      return part;
    }
    if (stack.some(tag => /math-italic|math-upright/.test(tag))) return part;
    return part.replace(/&(?:lt|gt);|[0-9]+(?:\.[0-9]+)?|[ΓΔΘΛΞΠΣΥΦΨΩ=+−×÷±∓<>≤≥≈≠∈∉∑∏∫()[\]{}|/]/g,
      token => `<span class="math-upright math-literal">${token}</span>`);
  }).join('');
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
        const measurementClass = isUprightMeasurementMath(raw) ? ' math-measurement' : '';
        html += `<span class="latex-token latex-math${measurementClass}" data-latex="${escapeHtml(raw)}" data-initial="${escapeHtml(display)}" title="Math: ${escapeHtml(raw)}">${display}</span>`;
        i = end + 1;
        continue;
      }
    }

    // 2b. Inline math \( ... \)
    if (source[i] === '\\' && source[i + 1] === '(') {
      const end = source.indexOf('\\)', i + 2);
      if (end >= 0) {
        const raw = source.slice(i, end + 2);
        const display = formatMathForDisplay(raw);
        const measurementClass = isUprightMeasurementMath(raw) ? ' math-measurement' : '';
        html += `<span class="latex-token latex-math${measurementClass}" data-latex="${escapeHtml(raw)}" data-initial="${escapeHtml(display)}" title="Math: ${escapeHtml(raw)}">${display}</span>`;
        i = end + 2;
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

    // 6. LaTeX quote ligatures: `` -> “ and '' -> ”
    if (source[i] === '`' && source[i + 1] === '`') {
      html += '“';
      i += 2;
      continue;
    }
    if (source[i] === "'" && source[i + 1] === "'") {
      html += '”';
      i += 2;
      continue;
    }
    if (source[i] === '`') {
      html += '‘';
      i++;
      continue;
    }

    // 7. Backslash commands & escaped symbols
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
          const model = source.slice(end).match(/^\[HTML\]/i);
          if (model) end += model[0].length;
          const colorGroup = extractGroup(source, end);
          if (colorGroup) {
            const textGroup = extractGroup(source, colorGroup.end);
            if (textGroup) {
              const color = colorGroup.text.trim();
              html += `<span class="latex-color" style="color: ${escapeHtml(model ? "#" + color : color)}" data-color="${escapeHtml(color)}"${model ? ' data-color-model="HTML"' : ''}>${inlineToHtml(textGroup.text)}</span>`;
              i = textGroup.end;
              continue;
            }
          }
        }

        // Citations: \cite{...}, \citep{...}, \citet{...}, \revref{...}
        if (['cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'revref'].includes(command)) {
          const keysGroup = extractGroup(source, end);
          if (keysGroup) {
            const keys = keysGroup.text.trim();
            const raw = source.slice(i, keysGroup.end);
            html += `<span class="latex-token latex-cite" contenteditable="false" data-latex="${escapeHtml(raw)}" data-keys="${escapeHtml(keys)}" title="Citation: ${escapeHtml(keys)}">[${escapeHtml(keys)}]</span>`;
            i = keysGroup.end;
            continue;
          }
        }
        if (command === 'nocite') {
          const keysGroup = extractGroup(source, end);
          if (keysGroup) {
            const raw = source.slice(i, keysGroup.end);
            html += `<span class="latex-token" contenteditable="false" data-latex="${escapeHtml(raw)}" style="display:none"></span>`;
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
            html += `<span class="latex-token latex-ref" contenteditable="false" data-latex="${escapeHtml(raw)}" data-ref="${escapeHtml(target)}" data-ref-command="${command}" title="Reference: ${escapeHtml(target)}">[${escapeHtml(target)}]</span>`;
            i = refGroup.end;
            continue;
          }
        }

        // Labels: \label{...} (hidden non-visual metadata)
        if (command === 'label') {
          const labelGroup = extractGroup(source, end);
          if (labelGroup) {
            const raw = source.slice(i, labelGroup.end);
            html += `<span class="latex-token latex-label" contenteditable="false" data-latex="${escapeHtml(raw)}" style="display:none;" title="Label: ${escapeHtml(labelGroup.text.trim())}"></span>`;
            i = labelGroup.end;
            continue;
          }
        }

        // Highlights: \hl{...}, \pihighlight{...}
        if (['hl', 'pihighlight'].includes(command)) {
          const arg = extractGroup(source, end);
          if (arg) {
            html += `<mark class="latex-highlight" data-latex-cmd="${command}">${inlineToHtml(arg.text)}</mark>`;
            i = arg.end;
            continue;
          }
        }

        // Revision color macros: \pitext{...}, \newdata{...}, \pendingchange{...}, \collabcaption{...}
        if (['redtext', 'pitext', 'newdata', 'pendingchange', 'collabcaption'].includes(command)) {
          const arg = extractGroup(source, end);
          if (arg) {
            html += `<span class="latex-color" style="color: ${command === 'redtext' ? '#D32F2F' : 'red'}" data-latex-cmd="${command}">${inlineToHtml(arg.text)}</span>`;
            i = arg.end;
            continue;
          }
        }

        if (['bluetext', 'finalfeedback'].includes(command)) {
          const arg = extractGroup(source, end);
          if (arg) {
            html += `<span class="latex-color" style="color: ${command === 'bluetext' ? '#1976D2' : 'blue'}" data-latex-cmd="${command}">${inlineToHtml(arg.text)}</span>`;
            i = arg.end;
            continue;
          }
        }

        if (command === 'rev') {
          const arg = extractGroup(source, end);
          if (arg) {
            html += `<span data-latex-cmd="rev">${inlineToHtml(arg.text)}</span>`;
            i = arg.end;
            continue;
          }
        }

        if (command === 'begin') {
          const envArg = extractGroup(source, end);
          if (envArg && ['collabtext', 'redblock', 'blueblock'].includes(envArg.text.trim())) {
            const environment = envArg.text.trim();
            const color = environment === 'blueblock' ? '#1976D2' : environment === 'redblock' ? '#D32F2F' : 'red';
            const closeTag = `\\end{${environment}}`;
            const closeIdx = source.indexOf(closeTag, envArg.end);
            if (closeIdx >= 0) {
              const inner = source.slice(envArg.end, closeIdx);
              html += `<span class="latex-color" style="color: ${color}" data-latex-env="${environment}">${inlineToHtml(inner)}</span>`;
              i = closeIdx + closeTag.length;
              continue;
            }
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

        // Inline box and text wrappers: \mbox, \hbox, \textnormal, \textup, \textmd
        if (['mbox', 'hbox', 'textnormal', 'textup', 'textmd'].includes(command) && firstArg) {
          html += `<span data-latex-cmd="${command}">${inlineToHtml(firstArg.text)}</span>`;
          i = firstArg.end;
          continue;
        }

        if (command === 'fbox' && firstArg) {
          html += `<span class="latex-fbox" style="border: 1px solid currentColor; padding: 0 2px;" data-latex-cmd="fbox">${inlineToHtml(firstArg.text)}</span>`;
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
          textasciitilde: '~',
          textasciicircum: '^',
          textless: '<',
          textgreater: '>',
          textbackslash: '\\',
          textbar: '|',
          textemdash: '—',
          textendash: '–',
          textbullet: '•',
          textregistered: '®',
          texttrademark: '™',
          textcopyright: '©',
          textdegree: '°',
          textcelsius: '℃',
          textmicro: 'µ',
          textmu: 'µ',
          textpm: '±',
          texttimes: '×',
          textdiv: '÷',
          textquotesingle: "'",
          textquotedbl: '"',
          textsterling: '£',
          texteuro: '€',
          textyen: '¥',
          textsection: '§',
          textparagraph: '¶',
          textdagger: '†',
          textdaggerdbl: '‡',
          textellipsis: '…',
          upalpha: 'α',
          upbeta: 'β',
          upgamma: 'γ',
          updelta: 'δ',
          Updelta: 'Δ',
        };

        if (symbolMap[command]) {
          let rawCommand = `\\${command}`;
          if (firstArg && firstArg.text.trim() === '') {
            rawCommand = source.slice(i, firstArg.end);
            end = firstArg.end;
          } else if (source.slice(end).startsWith('{}')) {
            end += 2;
            rawCommand += '{}';
          }
          html += `<span class="latex-token latex-symbol" contenteditable="false" data-latex="${escapeHtml(rawCommand)}" title="${escapeHtml(rawCommand)}">${escapeHtml(symbolMap[command])}</span>`;
          i = end;
          continue;
        }

        // Spacing / formatting commands
        if (['par', 'relax'].includes(command)) {
          i = end;
          continue;
        }
        if (['noindent', 'clearpage', 'newpage'].includes(command)) {
          html += `<span class="latex-token" contenteditable="false" data-latex="\\${escapeHtml(command)}" title="\\${escapeHtml(command)}"></span>`;
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
  const transparentEnvs = new Set(['collabtext', 'redblock', 'blueblock', 'singlespace', 'onehalfspace', 'doublespace', 'spacing']);

  for (const line of lines) {
    const trimmed = line.trim();

    // If at top-level a heading begins, flush pending chunk first
    if (inEnv === 0 && /^\\(section|subsection|subsubsection|paragraph)\*?\{/.test(trimmed)) {
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
    }

    // If at top-level a new non-transparent environment begins, flush pending chunk
    if (inEnv === 0 && /^\\begin\{([^}]+)\}/.test(trimmed)) {
      const beginName = trimmed.match(/^\\begin\{([^}]+)\}/)?.[1];
      if (beginName && !transparentEnvs.has(beginName)) {
        if (current.length > 0) {
          chunks.push(current);
          current = '';
        }
      }
    }

    const beginMatch = trimmed.match(/^\\begin\{([^}]+)\}/);
    if (beginMatch && !transparentEnvs.has(beginMatch[1])) inEnv++;
    const endMatch = trimmed.match(/^\\end\{([^}]+)\}/);
    if (endMatch && !transparentEnvs.has(endMatch[1])) inEnv = Math.max(0, inEnv - 1);

    // Standard scoped colour declarations stay silent and preserve paragraph boundaries.
    if (inEnv === 0 && /^\\(?:begingroup\s*\\color\{(?:red|blue)\}|endgroup)\s*$/.test(trimmed)) {
      if (current.length > 0) chunks.push(current);
      chunks.push(line);
      current = '';
      continue;
    }

    // Keep standalone layout/title/bibliography directives or transparent environment tags separate
    if (inEnv === 0 && (/^\\(?:newpage|clearpage|maketitle)\s*$|^\\bibliograph(?:y|ystyle)\b/.test(trimmed) || /^\\(?:begin|end)\{(?:collabtext|redblock|blueblock|singlespace|onehalfspace|doublespace|spacing)\}\s*$/.test(trimmed))) {
      if (current.length > 0) {
        chunks.push(current);
      }
      chunks.push(line);
      current = '';
      continue;
    }

    current += line;

    // Boundary decision points
    if (inEnv === 0) {
      if (trimmed === '') {
        chunks.push(current);
        current = '';
      } else if (/^\\(section|subsection|subsubsection|paragraph)\*?\{/.test(trimmed)) {
        chunks.push(current);
        current = '';
      } else if (endMatch && !transparentEnvs.has(endMatch[1])) {
        chunks.push(current);
        current = '';
      }
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Extracts an explicit figure or table number/prefix from a label name if present.
 * Returns null if the label is descriptive (e.g. fig:spatial-proximity).
 */
export function getExplicitFloatNumber(labelName) {
  if (!labelName) return null;
  const cleaned = labelName.trim();
  // Match fig:1, fig:S1, fig:fig1, fig:s2, tab:1, tab:S1
  const m1 = cleaned.match(/^(?:fig|tab):?(?:fig|tab)?([sS]?\d+[a-z]?)$/i);
  if (m1) return m1[1].toUpperCase();

  // Match fig:supp_1, fig:supplementary_1, fig:supp1, tab:supp_1
  const m2 = cleaned.match(/^(?:fig|tab):?(?:supp(?:lementary)?)[_-]?(\d+[a-z]?)$/i);
  if (m2) return `S${m2[1]}`;

  // Match fig:main_1, fig:main1
  const m3 = cleaned.match(/^(?:fig|tab):?(?:main)[_-]?(\d+[a-z]?)$/i);
  if (m3) return m3[1];

  return null;
}


/**
 * Extracts tabular environment bounds, column spec, and body from raw text.
 */
export function extractTabular(text) {
  const m = text.match(/\\begin\{(tabular\*?|tabularx|longtable)\}(?:\[[^\]]*\])?/);
  if (!m) return null;
  const envName = m[1];
  let idx = m.index + m[0].length;
  // If tabular* or tabularx, first brace group is the width parameter (e.g. \textwidth)
  if (envName === 'tabular*' || envName === 'tabularx') {
    const widthOpen = text.indexOf('{', idx);
    if (widthOpen >= 0) {
      const widthGrp = extractGroup(text, widthOpen);
      if (widthGrp) idx = widthGrp.end;
    }
  }
  const colOpen = text.indexOf('{', idx);
  if (colOpen < 0) return null;
  const colGrp = extractGroup(text, colOpen);
  if (!colGrp) return null;

  const endTag = `\\end{${envName}}`;
  const endIdx = text.indexOf(endTag, colGrp.end);
  if (endIdx < 0) return null;

  return {
    envName,
    start: m.index,
    end: endIdx + endTag.length,
    colSpec: colGrp.text.trim(),
    bodyStart: colGrp.end,
    bodyEnd: endIdx,
    body: text.slice(colGrp.end, endIdx),
  };
}

/**
 * Parses column alignments from LaTeX tabular column specification.
 * e.g. "llrrrrrr" -> ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right']
 */
export function parseColumnAlignments(colSpec) {
  const alignments = [];
  let i = 0;
  // Expand *{n}{...} shorthand if present
  let expanded = colSpec.replace(/\*\{(\d+)\}\{([^}]*)\}/g, (_, count, pattern) => pattern.repeat(parseInt(count, 10)));
  while (i < expanded.length) {
    const ch = expanded[i];
    if (ch === 'l') {
      alignments.push('left');
    } else if (ch === 'r') {
      alignments.push('right');
    } else if (ch === 'c') {
      alignments.push('center');
    } else if (ch === 'p' || ch === 'm' || ch === 'b') {
      alignments.push(ch === 'm' ? 'center' : 'left');
      const braceOpen = expanded.indexOf('{', i);
      if (braceOpen >= 0) {
        const grp = extractGroup(expanded, braceOpen);
        if (grp) {
          i = grp.end;
          continue;
        }
      }
    } else if (ch === 'X' || ch === 'Y') {
      alignments.push('left');
    } else if (ch === '@' || ch === '!' || ch === '>') {
      const braceOpen = expanded.indexOf('{', i);
      if (braceOpen >= 0) {
        const grp = extractGroup(expanded, braceOpen);
        if (grp) {
          i = grp.end;
          continue;
        }
      }
    }
    i++;
  }
  return alignments.length ? alignments : ['left'];
}

/**
 * Parses LaTeX tabular body into clean HTML table rows and cells.
 */
export function parseTabularToHtml(tabularSource) {
  const tabInfo = extractTabular(tabularSource);
  if (!tabInfo) return '';

  const colAlignments = parseColumnAlignments(tabInfo.colSpec);

  // Clean comment lines, preserving escaped \%
  const cleanBody = tabInfo.body
    .split('\n')
    .map(line => line.replace(/(^|[^\\])%.*$/, '$1'))
    .join('\n');

  const rawRows = cleanBody.split(/\\\\(?:\[[^\]]*\])?/);
  const rows = [];
  let isBooktabs = false;

  for (const r of rawRows) {
    if (/\\(?:toprule|midrule|bottomrule)/.test(r)) {
      isBooktabs = true;
    }
    const hasMidrule = /\\midrule/.test(r);

    const rClean = r.replace(/\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*\}|noalign\{[^}]*\})/g, '').trim();
    if (!rClean) continue;

    const rawCells = rClean.split(/(?<!\\)&/).map(c => c.trim());
    rows.push({
      cells: rawCells,
      hasMidrule,
    });
  }

  if (!rows.length) return '';

  const hasDistinctHeader = rows.length > 1;
  const headerRow = hasDistinctHeader ? rows[0] : null;
  const dataRows = hasDistinctHeader ? rows.slice(1) : rows;

  let html = `<table class="latex-table${isBooktabs ? ' booktabs' : ''}" data-colspec="${escapeHtml(tabInfo.colSpec)}">`;

  if (headerRow) {
    html += '<thead><tr>';
    headerRow.cells.forEach((cellText, colIdx) => {
      let colspan = 1;
      let align = colAlignments[colIdx] || 'left';
      let content = cellText;
      const mc = cellText.match(/\\multicolumn\{(\d+)\}\{[^}]*([lcr])[^}]*\}\{([\s\S]*)\}/);
      if (mc) {
        colspan = parseInt(mc[1], 10);
        align = mc[2] === 'r' ? 'right' : mc[2] === 'c' ? 'center' : 'left';
        content = mc[3];
      }
      const alignAttr = ` align="${align}" style="text-align: ${align};"`;
      const colAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
      html += `<th${alignAttr}${colAttr} contenteditable="true">${inlineToHtml(content)}</th>`;
    });
    html += '</tr></thead>';
  }

  html += '<tbody>';
  dataRows.forEach((row) => {
    const rowClass = row.hasMidrule ? ' class="table-midrule"' : '';
    html += `<tr${rowClass}>`;
    let colCursor = 0;
    row.cells.forEach((cellText) => {
      let colspan = 1;
      let align = colAlignments[colCursor] || 'left';
      let content = cellText;
      const mc = cellText.match(/\\multicolumn\{(\d+)\}\{[^}]*([lcr])[^}]*\}\{([\s\S]*)\}/);
      if (mc) {
        colspan = parseInt(mc[1], 10);
        align = mc[2] === 'r' ? 'right' : mc[2] === 'c' ? 'center' : 'left';
        content = mc[3];
      }
      const alignAttr = ` align="${align}" style="text-align: ${align};"`;
      const colAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
      html += `<td${alignAttr}${colAttr} contenteditable="true">${inlineToHtml(content)}</td>`;
      colCursor += colspan;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';

  return html;
}

/**
 * Serializes an HTML <table> element back to LaTeX tabular format.
 */
export function serializeHtmlTableToLatex(tableEl, defaultColSpec = '') {
  const colSpec = tableEl.dataset?.colspec || defaultColSpec || 'l';
  const isBooktabs = tableEl.classList?.contains('booktabs') !== false;

  const lines = [];
  lines.push(`\\begin{tabular}{${colSpec}}`);
  if (isBooktabs) lines.push('  \\toprule');

  const theadRows = [...tableEl.querySelectorAll('thead tr')];
  const tbodyRows = [...tableEl.querySelectorAll('tbody tr')];

  theadRows.forEach((tr) => {
    const cells = [...tr.querySelectorAll('th, td')].map(cell => {
      const cellLatex = [...cell.childNodes].map(domNodeToLatex).join('').trim();
      const colspan = cell.getAttribute('colspan');
      if (colspan && parseInt(colspan, 10) > 1) {
        const align = cell.getAttribute('align') || 'l';
        const aChar = align === 'right' ? 'r' : align === 'center' ? 'c' : 'l';
        return `\\multicolumn{${colspan}}{${aChar}}{${cellLatex}}`;
      }
      return cellLatex;
    });
    lines.push('  ' + cells.join(' & ') + ' \\\\');
  });

  if (theadRows.length > 0 && tbodyRows.length > 0 && isBooktabs) {
    lines.push('  \\midrule');
  }

  tbodyRows.forEach((tr) => {
    if (tr.classList?.contains('table-midrule') && isBooktabs) {
      lines.push('  \\midrule');
    }
    const cells = [...tr.querySelectorAll('td, th')].map(cell => {
      const cellLatex = [...cell.childNodes].map(domNodeToLatex).join('').trim();
      const colspan = cell.getAttribute('colspan');
      if (colspan && parseInt(colspan, 10) > 1) {
        const align = cell.getAttribute('align') || 'l';
        const aChar = align === 'right' ? 'r' : align === 'center' ? 'c' : 'l';
        return `\\multicolumn{${colspan}}{${aChar}}{${cellLatex}}`;
      }
      return cellLatex;
    });
    lines.push('  ' + cells.join(' & ') + ' \\\\');
  });

  if (isBooktabs) lines.push('  \\bottomrule');
  lines.push('\\end{tabular}');
  return lines.join('\n');
}

/**
 * Categorizes and builds DOM representation for a raw LaTeX chunk.
 */
export function processChunk(raw, id, state = {}) {
  const text = raw.trim();

  // 1. Empty / whitespace line
  if (!text) {
    return { id, raw, hidden: true, html: '' };
  }

  // Update numbering state if chunk contains counter resets or prefix redefinitions
  const setFigMatch = text.match(/\\setcounter\{figure\}\{(\d+)\}/);
  if (setFigMatch) {
    state.figCounter = parseInt(setFigMatch[1], 10);
  }
  const setTabMatch = text.match(/\\setcounter\{table\}\{(\d+)\}/);
  if (setTabMatch) {
    state.tabCounter = parseInt(setTabMatch[1], 10);
  }
  if (/\\renewcommand\{?\\thefigure\}?\{[^}]*S/i.test(text)) {
    state.figPrefix = 'S';
  }
  if (/\\renewcommand\{?\\thetable\}?\{[^}]*S/i.test(text)) {
    state.tabPrefix = 'S';
  }

  const setEqMatch = text.match(/\\setcounter\{equation\}\{(\d+)\}/);
  if (setEqMatch) state.eqCounter = Number(setEqMatch[1]);

  // Handle \refstepcounter commands and accompanying labels
  const refStepRegex = /\\refstepcounter\{(figure|table)\}(?:[^{}\\\n]*\\label\{([^}]+)\})?/g;
  let rsm;
  while ((rsm = refStepRegex.exec(text)) !== null) {
    const kind = rsm[1];
    const lbl = rsm[2];
    if (kind === 'figure') {
      state.figCounter = (state.figCounter || 0) + 1;
      if (lbl) {
        state.labelMap = state.labelMap || {};
        state.labelKinds = state.labelKinds || {};
        state.labelMap[lbl] = `${state.figPrefix || ''}${state.figCounter}`;
        state.labelKinds[lbl] = 'Figure';
      }
    } else if (kind === 'table') {
      state.tabCounter = (state.tabCounter || 0) + 1;
      if (lbl) {
        state.labelMap = state.labelMap || {};
        state.labelKinds = state.labelKinds || {};
        state.labelMap[lbl] = `${state.tabPrefix || ''}${state.tabCounter}`;
        state.labelKinds[lbl] = 'Table';
      }
    }
  }

  // 2. Pure formatting/control commands and labels (preserved silently)
  const nonCommentLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%'));
  if (nonCommentLines.length === 0) {
    return { id, raw, hidden: true, html: '' };
  }
  const isPureSilentCommands = nonCommentLines.every((line) =>
    /^\\(modulolinenumbers|linenumbers|thispagestyle|pagestyle|vspace\*?|hspace\*?|setlength|tableofcontents|newpage|clearpage|label|noindent|centering|raggedright|raggedleft|captionsetup|renewcommand|setcounter|addtocounter|refstepcounter|nocite|externaldocument|colorlet)\b/.test(line)
  );
  if (isPureSilentCommands) {
    return { id, raw, hidden: true, html: '' };
  }

  const standardColourBoundary = text.match(/^\\begingroup\s*\\color\{(red|blue)\}\s*$/);
  if (standardColourBoundary || (/^\\endgroup\s*$/.test(text) && state.standardColourGroups?.length)) {
    state.revisionColors ||= [];
    state.standardColourGroups ||= [];
    if (standardColourBoundary) {
      state.revisionColors.push(standardColourBoundary[1]);
      state.standardColourGroups.push(true);
    } else {
      state.revisionColors.pop();
      state.standardColourGroups.pop();
    }
    return { id, raw, hidden: true, html: '' };
  }

  // Transparent styling environments (preserved silently and track state for styling)
  const colorBoundary = text.match(/^\\(begin|end)\{(collabtext|redblock|blueblock)\}\s*$/);
  if (colorBoundary) {
    state.revisionColors ||= [];
    if (colorBoundary[1] === 'begin') {
      state.revisionColors.push(colorBoundary[2] === 'blueblock' ? '#1976D2' : colorBoundary[2] === 'redblock' ? '#D32F2F' : 'red');
    } else {
      state.revisionColors.pop();
    }
    return { id, raw, hidden: true, html: '' };
  }
  const revisionStyle = state.revisionColors?.length
    ? ` style="color: ${state.revisionColors.at(-1)};"` : '';
  if (/^\\(?:begin|end)\{(?:singlespace|onehalfspace|doublespace|spacing)\}\s*$/.test(text)) {
    return { id, raw, hidden: true, html: '' };
  }

  // 3. Headings: \section, \subsection, \subsubsection, \paragraph
  const headingMatch = text.match(/^\\(section|subsection|subsubsection|paragraph)(\*?)\{/);
  if (headingMatch) {
    const cmd = headingMatch[1];
    const isStar = headingMatch[2] === '*';
    const group = extractGroup(text, headingMatch[0].length - 1);
    if (group) {
      const rest = text.slice(group.end).trim();
      const labelMatch = rest.match(/^\\label\{([^}]+)\}$/);
      if (rest === '' || labelMatch) {
        const tag = cmd === 'section' ? 'h2' : cmd === 'subsection' ? 'h3' : cmd === 'subsubsection' ? 'h4' : 'h5';
        const labelAttr = labelMatch ? ` data-label="${escapeHtml(labelMatch[0])}"` : '';
        return {
          id,
          raw,
          tag,
          cmd: cmd + (isStar ? '*' : ''),
          label: labelMatch ? labelMatch[0] : null,
          html: `<${tag} class="latex-heading ${tag}" data-cmd="${cmd}${isStar ? '*' : ''}"${labelAttr}${revisionStyle}>${inlineToHtml(group.text)}</${tag}>`,
        };
      }
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
      html: `<div class="latex-abstract" data-env="abstract"${revisionStyle}><div class="abstract-heading" contenteditable="false">Abstract</div><p class="abstract-body">${inlineToHtml(abstractMatch[1].trim())}</p></div>`,
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
      html: `<${tag} class="latex-list" data-env="${env}"${revisionStyle}>${itemsHtml}</${tag}>`,
    };
  }

  // 6. Display Equations: \begin{equation}, \begin{align}, \begin{gather}, \[, $$
  const eqEnvMatch = text.match(/^\\begin\{(equation|align|gather)(\*?)\}([\s\S]*)\\end\{\1\2\}$/);
  if (eqEnvMatch) {
    const envName = eqEnvMatch[1];
    const isStarred = eqEnvMatch[2] === '*';
    const innerMath = eqEnvMatch[3].trim();
    const formattedMath = formatMathForDisplay(innerMath);
    const labelName = innerMath.match(/\\label\{([^}]+)\}/)?.[1];
    if (!isStarred) state.eqCounter = (state.eqCounter || 0) + 1;
    const displayNumber = isStarred ? '' : state.labelMap?.[labelName] || String(state.eqCounter);
    const numBadge = isStarred ? '' : `<span class="equation-num" contenteditable="false">(${escapeHtml(displayNumber)})</span>`;

    return {
      id,
      raw,
      tag: 'div',
      env: envName + (isStarred ? '*' : ''),
      labelName, displayNumber, captionKind: 'Equation',
      isEquation: true,
      html: `<div class="latex-equation-block"${revisionStyle} data-env="${escapeHtml(envName + (isStarred ? '*' : ''))}" data-latex="${escapeHtml(text)}"><div class="equation-content latex-math">${formattedMath}</div>${numBadge}</div>`,
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

  // 7. Complex environments to preserve (figures, tables, tikz, quote, minipage, tabular)
  if (/^(?:\\noindent\s*)?\\begin\{(figure|table|tikzpicture|quote|minipage|tabular\*?|tabularx|longtable)\*?\}/.test(text)) {
    const envMatch = text.match(/\\begin\{([^}*]+)\*?\}/);
    const rawEnv = envMatch ? envMatch[1] : 'float';
    let badge = rawEnv.toUpperCase();

    if (rawEnv === 'minipage') {
      if (text.includes('\\captionof{figure}') || text.includes('\\includegraphics')) {
        badge = 'FIGURE';
      } else if (text.includes('\\captionof{table}')) {
        badge = 'TABLE';
      }
    } else if (rawEnv.startsWith('tabular') || rawEnv === 'longtable') {
      badge = 'TABLE';
    }

    const tabInfo = extractTabular(raw);
    const tableHtml = tabInfo ? parseTabularToHtml(raw) : '';

    // Check for caption in the environment
    const capMatch = raw.match(/\\(?:captionof\{[^}]+\}|caption)\s*\{/);
    if (capMatch) {
      const openBrace = capMatch.index + capMatch[0].lastIndexOf('{');
      const group = extractGroup(raw, openBrace);
      if (group) {
        const capStart = openBrace + 1;
        const capEnd = group.end - 1;
        const capRaw = raw.slice(capStart, capEnd);
        const capHtml = inlineToHtml(capRaw);

        const imgMatch = raw.match(/\\includegraphics(?:\[([^\]]*)\])?\{([^}]+)\}/);
        const imagePath = imgMatch ? (imgMatch[2] || imgMatch[1] || '').trim() : '';
        // Canvas previews use the reading column; authored graphics options
        // stay in raw source for caption saves and PDF/Word exports.
        const labelMatch = raw.match(/\\label\{([^}]+)\}/);
        const labelName = labelMatch ? labelMatch[1].trim() : '';
        const captionKind = badge === 'FIGURE' ? 'Figure' : badge === 'TABLE' ? 'Table' : '';

        // Dynamically compute publication figure/table number
        let displayNumber = '';
        if (badge === 'FIGURE') {
          state.figCounter = (state.figCounter || 0) + 1;
          const explicit = getExplicitFloatNumber(labelName);
          if (state.labelMap && state.labelMap[labelName]) {
            displayNumber = state.labelMap[labelName];
          } else if (explicit) {
            displayNumber = explicit;
          } else {
            const prefix = state.figPrefix !== undefined ? state.figPrefix : '';
            displayNumber = `${prefix}${state.figCounter}`;
          }
        } else if (badge === 'TABLE') {
          state.tabCounter = (state.tabCounter || 0) + 1;
          const explicit = getExplicitFloatNumber(labelName);
          if (state.labelMap && state.labelMap[labelName]) {
            displayNumber = state.labelMap[labelName];
          } else if (explicit) {
            displayNumber = explicit;
          } else {
            const prefix = state.tabPrefix !== undefined ? state.tabPrefix : '';
            displayNumber = `${prefix}${state.tabCounter}`;
          }
        }

        const hasManualPrefix = /^\s*(?:\{\s*\\bfseries|\{\s*\\textbf|\\textbf\{)?\s*(?:Figure|Table)\s+[sS]?\d+/i.test(capRaw.trim());
        const captionPrefix = (captionKind && !hasManualPrefix)
          ? `${captionKind}${displayNumber ? ` ${displayNumber}` : ''}.`
          : '';
        const captionLead = captionPrefix
          ? `<span class="float-caption-prefix" contenteditable="false" data-latex="">${escapeHtml(captionPrefix)}</span> `
          : '';

        let innerContent = '';
        if (badge === 'TABLE') {
          const captionAbove = !tabInfo || capMatch.index < tabInfo.start;
          const captionHtml = `<div class="float-caption-body" contenteditable="true"${revisionStyle}>${captionLead}${capHtml}</div>`;
          const tableBlockHtml = tableHtml ? `<div class="float-table-preview">${tableHtml}</div>` : '';
          innerContent = captionAbove ? (captionHtml + tableBlockHtml) : (tableBlockHtml + captionHtml);
        } else {
          innerContent = `${imagePath ? `<div class="float-image-preview" contenteditable="false" data-image-path="${escapeHtml(imagePath)}"><span class="float-image-status">Loading figure preview…</span></div>` : ''}<div class="float-caption-body" contenteditable="true"${revisionStyle}>${captionLead}${capHtml}</div>`;
        }

        return {
          id,
          raw,
          hasCaption: true,
          capStart,
          capEnd,
          capRaw,
          imagePath,
          displayNumber,
          labelName,
          captionKind,
          captionPrefix,
          isTable: badge === 'TABLE',
          tabStart: tabInfo ? tabInfo.start : undefined,
          tabEnd: tabInfo ? tabInfo.end : undefined,
          colSpec: tabInfo ? tabInfo.colSpec : undefined,
          tableHtml,
          html: `<div class="latex-float-card${badge === 'TABLE' ? ' latex-table-card' : ''}" data-block-id="${id}" data-env="${escapeHtml(rawEnv)}">${innerContent}</div>`,
        };
      }
    }

    if (tableHtml) {
      return {
        id,
        raw,
        isTable: true,
        tabStart: tabInfo ? tabInfo.start : undefined,
        tabEnd: tabInfo ? tabInfo.end : undefined,
        colSpec: tabInfo ? tabInfo.colSpec : undefined,
        tableHtml,
        html: `<div class="latex-float-card latex-table-card" data-block-id="${id}" data-env="${escapeHtml(rawEnv)}"><div class="float-table-preview">${tableHtml}</div></div>`,
      };
    }

    const imgMatch = text.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
    const preview = imgMatch ? imgMatch[1].split('/').pop() : `${badge.toLowerCase()} environment`;

    return {
      id,
      raw,
      protected: true,
      html: `<div class="latex-protected-card" contenteditable="false" title="LaTeX environment preserved byte-for-byte"><span class="card-badge">${escapeHtml(badge)}</span> <span class="card-caption">${escapeHtml(preview)}</span></div>`,
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
    html: `<p class="latex-paragraph"${revisionStyle} data-block-id="${id}">${inlineToHtml(text)}</p>`,
  };
}

// Read declarations at the top level only: macro definitions and comments are
// not author data. Keep the original preamble authoritative and untouched.
function frontMatterHtml(preamble) {
  const entries = [];
  for (let i = 0; i < preamble.length;) {
    if (preamble[i] === '%') {
      const end = preamble.indexOf('\n', i);
      i = end < 0 ? preamble.length : end + 1;
      continue;
    }
    if (preamble[i] === '{') {
      const group = extractGroup(preamble, i);
      i = group ? group.end : i + 1;
      continue;
    }
    if (preamble[i] !== '\\') { i++; continue; }
    const match = preamble.slice(i).match(/^\\([A-Za-z@]+|.)/);
    if (!match) break;
    i += match[0].length;
    if (!['author', 'affil', 'date'].includes(match[1])) continue;
    while (/\s/.test(preamble[i] || '') && i < preamble.length) i++;
    let marker = '';
    if (preamble[i] === '[') {
      const end = preamble.indexOf(']', i + 1);
      if (end < 0) continue;
      marker = preamble.slice(i + 1, end).replace(/\\affilmarksep\b\s*/g, ',').replace(/\s+/g, '');
      i = end + 1;
      while (/\s/.test(preamble[i] || '') && i < preamble.length) i++;
    }
    const group = extractGroup(preamble, i);
    if (!group) continue;
    entries.push({command: match[1], text: group.text, marker});
    i = group.end;
  }
  const mark = value => value ? `<sup>${inlineToHtml(value)}</sup>` : '';
  const text = value => inlineToHtml(value.replace(/\\and\b/g, ', '));
  const authors = entries.filter(e => e.command === 'author');
  const affils = entries.filter(e => e.command === 'affil');
  const date = entries.filter(e => e.command === 'date').at(-1);
  return (authors.length ? `<p class="latex-authors">${authors.map(e => text(e.text) + mark(e.marker)).join(', ')}</p>` : '')
    + affils.map(e => `<p class="latex-affiliation">${mark(e.marker)}${e.marker ? ' ' : ''}${text(e.text)}</p>`).join('')
    + (date?.text.trim() ? `<p class="latex-correspondence">${text(date.text)}</p>` : '');
}

/**
 * Parses full LaTeX source into preamble, structured blocks, and suffix.
 */
export function parseDocument(source, options = {}) {
  const docStart = source.indexOf('\\begin{document}');
  const docEnd = source.lastIndexOf('\\end{document}');

  const preamble = docStart >= 0 ? source.slice(0, docStart + '\\begin{document}'.length) : '';
  const suffix = docEnd >= 0 ? source.slice(docEnd) : '';
  const body = source.slice(
    docStart >= 0 ? docStart + '\\begin{document}'.length : 0,
    docEnd >= 0 ? docEnd : source.length,
  );

  const isSuppFile = /^(?:supplementary|supp|si)[_.-]/i.test(options.fileName || '') ||
                     /\\title\{[^}]*supplementary/i.test(source);

  let initialFigPrefix = isSuppFile ? 'S' : '';
  let initialTabPrefix = isSuppFile ? 'S' : '';
  if (/\\renewcommand\{?\\thefigure\}?\{[^}]*S/i.test(preamble)) {
    initialFigPrefix = 'S';
  }
  if (/\\renewcommand\{?\\thetable\}?\{[^}]*S/i.test(preamble)) {
    initialTabPrefix = 'S';
  }

  const state = {
    figCounter: 0,
    tabCounter: 0,
    figPrefix: initialFigPrefix,
    tabPrefix: initialTabPrefix,
    labelMap: options.labelMap || {},
  };

  const rawChunks = splitBodyChunks(body);
  const blocks = rawChunks.map((raw, id) => processChunk(raw, id, state));

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

  // Front matter is a display-only projection of the preamble, never body text.
  if (body.replace(/(?<!\\)%[^\n]*/g, '').includes('\\maketitle')) {
    const html = frontMatterHtml(preamble);
    if (html) blocks.splice(titleInfo ? 1 : 0, 0, {
      id: 'front-matter', raw: '', protected: true,
      html: `<div class="latex-front-matter" data-latex="" contenteditable="false" title="Authors and affiliations: edit the TEX preamble">${html}</div>`,
    });
  }
  const referenceMap = {...options.labelMap, ...state.labelMap};
  const referenceKinds = {...options.labelKinds, ...state.labelKinds};
  for (const block of blocks) {
    if (block.labelName && block.displayNumber) {
      referenceMap[block.labelName] = block.displayNumber;
      referenceKinds[block.labelName] = block.captionKind;
    }
  }

  return {
    referenceMap,
    referenceKinds,
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
    [/‴/g, '^\\prime\\prime\\prime '],
    [/″/g, '^\\prime\\prime '],
    [/′/g, '^\\prime '],
    [/\s*−\s*/g, ' - '],
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
    'ζ': '\\zeta ',
    'η': '\\eta ',
    'ι': '\\iota ',
    'κ': '\\kappa ',
    'ν': '\\nu ',
    'ξ': '\\xi ',
    'ρ': '\\rho ',
    'τ': '\\tau ',
    'υ': '\\upsilon ',
    'χ': '\\chi ',
    'ψ': '\\psi ',
    'Γ': '\\Gamma ',
    'Θ': '\\Theta ',
    'Λ': '\\Lambda ',
    'Ξ': '\\Xi ',
    'Π': '\\Pi ',
    'Σ': '\\Sigma ',
    'Υ': '\\Upsilon ',
    'Φ': '\\Phi ',
    'Ψ': '\\Psi ',
    'Ω': '\\Omega ',
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
  if (tag === 'SUP') {
    const cleanInner = inner.trim().replace(/^\^/, '');
    return `^{${cleanInner}}`;
  }
  if (tag === 'STRONG' || tag === 'B') return `\\mathbf{${inner}}`;
  if (tag === 'EM' || tag === 'I') return `\\mathit{${inner}}`;

  if (node.classList?.contains('math-literal')) return inner;
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

  if (node.classList?.contains('math-limits')) {
    if (node.dataset?.latex) return node.dataset.latex;
    const op = node.querySelector?.('.math-limit-op')?.textContent.trim() || '';
    const opLatex = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∐': '\\coprod' }[op] || '\\sum';
    const sup = node.querySelector?.('.math-limit-sup');
    const sub = node.querySelector?.('.math-limit-sub');
    const supLatex = sup ? `^{${domMathToLatex(sup)}}` : '';
    const subLatex = sub ? `_{${domMathToLatex(sub)}}` : '';
    return `${opLatex}${subLatex}${supLatex} `;
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
    if (node.dataset?.latex?.startsWith('\\(')) {
      return inner ? `\\(${inner}\\)` : '';
    }
    return inner ? `$${inner}$` : '';
  }

  // 4. Other Protected Tokens with explicit LaTeX data
  if (node.dataset?.latex !== undefined) {
    return node.dataset.latex;
  }

  // 4. Colored Text: \textcolor{color}{...}
  if (node.dataset.color) {
    const inner = [...node.childNodes].map(domNodeToLatex).join('');
    return `\\textcolor${node.dataset.colorModel === "HTML" ? "[HTML]" : ""}{${node.dataset.color}}{${inner}}`;
  }

  // 4b. Inline environments (e.g. collabtext)
  if (node.dataset?.latexEnv) {
    const env = node.dataset.latexEnv;
    const inner = [...node.childNodes].map(domNodeToLatex).join('');
    return `\\begin{${env}}${inner}\\end{${env}}`;
  }

  // 5. Special LaTeX macro tokens (\hl, \pitext, \rev, etc.)
  if (node.dataset?.latexCmd) {
    const cmd = node.dataset.latexCmd;
    const inner = [...node.childNodes].map(domNodeToLatex).join('');
    return `\\${cmd}{${inner}}`;
  }

  // 6. Children text
  let children = [...node.childNodes].map(domNodeToLatex).join('');

  // 7. Formatting Tags
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
  if (element.dataset?.clipboardSource) {
    if (element.innerHTML === element.dataset.clipboardSnapshot) return element.dataset.clipboardSource;
    originalBlock = parseDocument(element.dataset.clipboardSource).blocks[0];
  }

  if (element.dataset?.figureSource) {
    originalBlock = parseDocument(element.dataset.figureSource).blocks.find((block) => block.hasCaption);
  }
  if (originalBlock && (originalBlock.protected || originalBlock.hidden || originalBlock.isEquation)) {
    return originalBlock.raw;
  }
  if (element.dataset?.latex !== undefined) {
    return element.dataset.latex + '\n\n';
  }

  // Browser cut/paste and Enter can create several paragraphs inside one
  // wrapper. Serialize every child, rather than only the first matching <p>.
  if (!originalBlock?.hasCaption && !element.classList?.contains('latex-abstract') &&
      !element.querySelector?.('.latex-abstract') &&
      [...(element.children || [])].some((child) =>
        ['P', 'DIV', 'H2', 'H3', 'H4', 'H5', 'UL', 'OL'].includes(child.tagName))) {
    let result = '';
    let inline = '';
    const flush = () => {
      if (inline.trim()) result += inline.trim() + '\n\n';
      inline = '';
    };
    for (const child of element.childNodes) {
      if (child.nodeType === 1 && ['P', 'DIV', 'H2', 'H3', 'H4', 'H5', 'UL', 'OL'].includes(child.tagName)) {
        flush();
        result += serializeDomBlock(child);
      } else {
        inline += domNodeToLatex(child);
      }
    }
    flush();
    return result;
  }

  // 1. Headings (h2, h3, h4, h5)
  const heading = element.querySelector?.('h2, h3, h4, h5') || (['H2','H3','H4','H5'].includes(element.tagName) ? element : null);
  if (heading) {
    const cmd = heading.dataset?.cmd || (heading.tagName === 'H2' ? 'section' : heading.tagName === 'H3' ? 'subsection' : heading.tagName === 'H4' ? 'subsubsection' : 'paragraph');
    const content = [...heading.childNodes].map(domNodeToLatex).join('').trim();
    if (!heading.textContent?.trim() && !heading.querySelector?.('[data-latex]')) return '';
    const label = heading.dataset?.label || (originalBlock?.label ? originalBlock.label : '');
    const labelSuffix = label ? `\n${label}` : '';
    return `\\${cmd}{${content}}${labelSuffix}\n\n`;
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

  // 4. Float Cards with Editable Caption or Table
  const floatCard = element.classList?.contains('latex-float-card') ? element : element.querySelector?.('.latex-float-card');
  if (floatCard) {
    const tableEl = floatCard.querySelector?.('table.latex-table');
    const captionBody = floatCard.querySelector?.('.float-caption-body');

    if (originalBlock) {
      if (element.innerHTML === originalBlock.snapshot) return originalBlock.raw;

      let result = originalBlock.raw;

      // Handle table edits if table element exists and was modified
      if (tableEl && originalBlock.tabStart !== undefined && originalBlock.tabEnd !== undefined) {
        const currentTabHtml = floatCard.querySelector('.float-table-preview')?.innerHTML;
        if (currentTabHtml && originalBlock.tableHtml && currentTabHtml !== originalBlock.tableHtml) {
          const newTabLatex = serializeHtmlTableToLatex(tableEl, originalBlock.colSpec);
          const beforeTab = originalBlock.raw.slice(0, originalBlock.tabStart);
          const afterTab = originalBlock.raw.slice(originalBlock.tabEnd);
          result = beforeTab + newTabLatex + afterTab;
        }
      }

      // Handle caption edits if caption exists
      if (captionBody && originalBlock.hasCaption) {
        const newCaptionLatex = [...captionBody.childNodes].map(domNodeToLatex).join('').trim();
        if (originalBlock.tabStart !== undefined && result !== originalBlock.raw) {
          const capMatch = result.match(/\\(?:captionof\{[^}]+\}|caption)\s*\{/);
          if (capMatch) {
            const openBrace = capMatch.index + capMatch[0].lastIndexOf('{');
            const grp = extractGroup(result, openBrace);
            if (grp) {
              result = result.slice(0, openBrace + 1) + newCaptionLatex + result.slice(grp.end - 1);
            }
          }
        } else {
          const before = originalBlock.raw.slice(0, originalBlock.capStart);
          const after = originalBlock.raw.slice(originalBlock.capEnd);
          result = before + newCaptionLatex + after;
        }
      }

      return result;
    }

    if (tableEl) {
      const newTabLatex = serializeHtmlTableToLatex(tableEl);
      const capText = captionBody ? [...captionBody.childNodes].map(domNodeToLatex).join('').trim() : '';
      return [
        '\\begin{table}[htbp]',
        '  \\centering',
        capText ? `  \\caption{${capText}}` : '',
        newTabLatex,
        '\\end{table}\n\n',
      ].filter(Boolean).join('\n');
    }
    return originalBlock?.raw || '';
  }

  // 5. Protected Cards: keep raw
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
  if (!p.textContent?.trim() && !p.querySelector?.('[data-latex]')) return '';
  const content = [...p.childNodes].map(domNodeToLatex).join('').trim();
  return content ? `${content}\n\n` : '';
}

/**
 * Serializes the full editor DOM tree back to complete LaTeX source code.
 */
export function serializeDocument(parsedDoc, container) {
  if (!parsedDoc || !container) return '';

  let body = '';
  let titleBody = '';
  let preamble = parsedDoc.preamble;

  // 1. Check if paper title was edited
  const titleEl = container.querySelector?.('[data-cmd="title"]');
  if (titleEl && parsedDoc.titleInfo) {
    const newTitle = (titleEl.textContent ?? [...titleEl.childNodes].map((node) => node.textContent || '').join('')).trim()
      ? [...titleEl.childNodes].map(domNodeToLatex).join('').trim() : '';
    if (newTitle !== parsedDoc.titleInfo.text) {
      const start = preamble.indexOf('\\title{');
      const group = start >= 0 ? extractGroup(preamble, start + 6) : null;
      if (group) preamble = preamble.slice(0, start + 7) + newTitle + preamble.slice(group.end - 1);
    }
  }

  // Follow the edited DOM order, including newly pasted blocks. Missing prose
  // was deleted by the author; it must not be resurrected from the parse tree.
  const blocksById = new Map(parsedDoc.blocks.map((block) => [String(block.id), block]));
  const children = [...(container.childNodes || container.children)];
  const present = new Set(children.map((child) => String(child.dataset?.blockId)));

  // Invisible source and protected environments survive even if a browser cut
  // removes their wrapper. Anchor them before the next surviving source block.
  const before = new Map();
  let pending = '';
  for (const block of parsedDoc.blocks) {
    if (block.isTitle) continue;
    if (present.has(String(block.id))) {
      before.set(String(block.id), pending);
      pending = '';
    } else if (block.hidden || block.protected || block.isEquation) {
      pending += block.raw;
    }
  }
  const emittedAnchors = new Set();
  for (const child of children) {
    const id = String(child.dataset?.blockId);
    const block = blocksById.get(id);
    if (block?.isTitle) {
      if (child.innerHTML === block.snapshot) continue;
      // Native Enter/paste may create body siblings inside the title wrapper.
      const extra = child.cloneNode(true);
      extra.querySelector('[data-cmd="title"]')?.remove();
      titleBody += serializeDomBlock(extra);
      continue;
    }
    if (titleBody && (!block?.hidden || /^\\bibliograph(?:y|ystyle)\b/.test(block.raw.trim()))) {
      body += titleBody;
      titleBody = '';
    }
    if (!emittedAnchors.has(id)) {
      body += before.get(id) || '';
      emittedAnchors.add(id);
    }
    if (block && (block.hidden || block.protected || child.innerHTML === block.snapshot)) {
      body += block.raw;
    } else if (child.dataset?.latex !== undefined) {
      body += child.dataset.latex + '\n\n';
    } else if (child.nodeType === 3) {
      if (child.textContent.trim()) body += domNodeToLatex(child) + '\n\n';
    } else {
      body += serializeDomBlock(child, block);
    }
  }
  body += titleBody + pending;

  return preamble + body + parsedDoc.suffix;
}
