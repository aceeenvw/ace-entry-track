export const REGEX_TOOL_LIMITS = Object.freeze({
    maxInputLength: 131_072,
    maxItems: 256,
    maxItemLength: 512,
    maxVariantsPerItem: 256,
    maxTotalVariants: 1024,
    maxExpansionItems: 8,
    maxSuggestions: 64,
    maxVariantLength: 4_096,
    maxExpansionCharacters: 262_144,
    maxClipboardLength: 262_144,
    maxDepth: 24,
    maxRepeat: 32,
});

const UNICODE_LETTER = /\p{Letter}/u;
const CONSTRUCTOR_LETTERS = Object.freeze({
    latin: /[A-Za-z]/,
    cyrillic: /[А-Яа-яЁё]/,
});

const ENGLISH_IRREGULAR_GROUPS = Object.freeze([
    { kind: 'verb', forms: ['go', 'goes', 'going', 'went', 'gone'] },
    { kind: 'verb', forms: ['be', 'am', 'is', 'are', 'was', 'were', 'being', 'been'] },
    { kind: 'verb', forms: ['have', 'has', 'having', 'had'] },
    { kind: 'verb', forms: ['do', 'does', 'doing', 'did', 'done'] },
    { kind: 'verb', forms: ['see', 'sees', 'seeing', 'saw', 'seen'] },
    { kind: 'verb', forms: ['come', 'comes', 'coming', 'came'] },
    { kind: 'verb', forms: ['take', 'takes', 'taking', 'took', 'taken'] },
    { kind: 'verb', forms: ['make', 'makes', 'making', 'made'] },
    { kind: 'verb', forms: ['run', 'runs', 'running', 'ran'] },
    { kind: 'verb', forms: ['write', 'writes', 'writing', 'wrote', 'written'] },
    { kind: 'noun', forms: ['mouse', 'mice'] },
    { kind: 'noun', forms: ['child', 'children'] },
    { kind: 'noun', forms: ['person', 'people'] },
    { kind: 'noun', forms: ['man', 'men'] },
    { kind: 'noun', forms: ['woman', 'women'] },
    { kind: 'noun', forms: ['tooth', 'teeth'] },
    { kind: 'noun', forms: ['foot', 'feet'] },
    { kind: 'noun', forms: ['goose', 'geese'] },
]);

const ENGLISH_FUNCTION_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
    'from', 'with', 'without', 'as', 'this', 'that', 'these', 'those',
]);

const ENGLISH_DOUBLE_FINAL = new Set([
    'beg', 'chat', 'clap', 'clip', 'drag', 'drop', 'fit', 'grab', 'hug', 'jog', 'nod', 'plan', 'rob', 'shop',
    'skip', 'slip', 'stop', 'tap', 'trim', 'trip',
]);

const ENGLISH_KEEP_E_GERUND = new Set(['queue', 'singe', 'tinge', 'whinge']);

function quantifierAt(source, index) {
    const match = source.slice(index).match(/^(?:[+*?]|\{\d+(?:,\d*)?\})/);
    return match?.[0] || '';
}

function isUnboundedQuantifier(value) {
    return value === '+' || value === '*' || /^\{\d+,\}$/.test(value);
}

function boundedRepeatFactor(source, initial = 1) {
    let factor = initial;
    const quantifiers = source.matchAll(/\?(?![<:=!])|\{(\d+)(?:,(\d*))?\}/g);
    for (const match of quantifiers) {
        const maximum = match[0] === '?'
            ? 2
            : Number(match[2] === '' ? REGEX_TOOL_LIMITS.maxRepeat : (match[2] ?? match[1]));
        factor *= Math.max(1, maximum);
        if (factor >= REGEX_TOOL_LIMITS.maxRepeat) return REGEX_TOOL_LIMITS.maxRepeat;
    }
    return factor;
}

function boundedQuantifierChoices(value) {
    if (value === '?') return 2;
    const bounds = value.match(/^\{(\d+)(?:,(\d*))?\}$/);
    if (!bounds || bounds[2] === undefined) return 1;
    const minimum = Number(bounds[1]);
    const maximum = bounds[2] === '' ? Infinity : Number(bounds[2]);
    return Number.isFinite(maximum) ? maximum - minimum + 1 : Infinity;
}

function decodeCodePoint(hex) {
    const value = parseInt(hex, 16);
    return Number.isInteger(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : null;
}

function decodeSafetyEscape(rest, inClass = false) {
    const hex = rest.match(/^\\x([\da-fA-F]{2})/) || rest.match(/^\\u([\da-fA-F]{4})/) || rest.match(/^\\u\{([\da-fA-F]+)\}/);
    if (hex) return { value: decodeCodePoint(hex[1]), length: hex[0].length };
    const control = rest.match(/^\\c([A-Za-z])/);
    if (control) return { value: String.fromCharCode(control[1].toUpperCase().charCodeAt(0) % 32), length: 3 };
    const octal = rest.match(/^\\([0-3][0-7]{2}|[0-7]{1,2})/);
    if (octal) return { value: String.fromCharCode(parseInt(octal[1], 8)), length: octal[0].length };
    const fixed = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', 0: '\0' };
    if (inClass) fixed.b = '\b';
    const value = fixed[rest[1]];
    return value === undefined ? null : { value, length: 2 };
}

function foldSafetyChar(value, caseInsensitive) {
    if (!caseInsensitive) return value;
    const folded = value.normalize('NFKC').toUpperCase();
    return [...folded].length === 1 ? folded : value;
}

function literalPrefix(source, caseInsensitive = false) {
    let prefix = '';
    for (let index = 0; index < source.length;) {
        const char = source[index++];
        if (char === '\\') {
            const escapeStart = index - 1;
            const rest = source.slice(escapeStart);
            const decoded = decodeSafetyEscape(rest);
            if (decoded) {
                if (decoded.value === null) break;
                prefix += foldSafetyChar(decoded.value, caseInsensitive);
                index = escapeStart + decoded.length;
                continue;
            }
            if (index >= source.length || /[bBdDsSwWpPkK1-9]/.test(source[index])) break;
            prefix += foldSafetyChar(source[index++], caseInsensitive);
            continue;
        }
        if ('^$.*+?()[]{}'.includes(char)) break;
        prefix += foldSafetyChar(char, caseInsensitive);
    }
    return prefix;
}

function splitTopLevelAlternatives(source) {
    const branches = [];
    let start = 0;
    let depth = 0;
    let inClass = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '[') inClass = true;
        else if (char === ']' && inClass) inClass = false;
        else if (!inClass && char === '(') depth += 1;
        else if (!inClass && char === ')') depth -= 1;
        else if (!inClass && depth === 0 && char === '|') {
            branches.push(source.slice(start, index));
            start = index + 1;
        }
    }
    if (!branches.length) return null;
    branches.push(source.slice(start));
    return branches;
}

function hasAmbiguousAlternation(source, caseInsensitive = false) {
    const branches = splitTopLevelAlternatives(source);
    if (branches) {
        const prefixes = branches.map(branch => literalPrefix(branch, caseInsensitive));
        for (let left = 0; left < prefixes.length; left += 1) {
            for (let right = left + 1; right < prefixes.length; right += 1) {
                if (!prefixes[left] || !prefixes[right]) return true;
                if (prefixes[left].startsWith(prefixes[right]) || prefixes[right].startsWith(prefixes[left])) return true;
            }
        }
    }

    const stack = [];
    let inClass = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '[') inClass = true;
        else if (char === ']' && inClass) inClass = false;
        else if (!inClass && char === '(') stack.push(index);
        else if (!inClass && char === ')' && stack.length) {
            const start = stack.pop();
            const body = source.slice(start + 1, index).replace(/^\?(?:[:=!]|<[=!]|<[^>]{1,64}>)/, '');
            if (hasAmbiguousAlternation(body, caseInsensitive)) return true;
        }
    }
    return false;
}

function characterClassKey(body, caseInsensitive) {
    if (body.startsWith('^')) return '*';
    if (/^\\[dws]$/.test(body)) return `class:${body[1]}`;
    const characters = new Set();
    for (let index = 0; index < body.length;) {
        let value;
        let end = index + 1;
        if (body[index] === '\\') {
            const rest = body.slice(index);
            const decoded = decodeSafetyEscape(rest, true);
            if (decoded) {
                value = decoded.value;
                end = index + decoded.length;
            } else if (/^\\[dDsSwWpP]/.test(rest)) {
                return '*';
            } else {
                value = body[index + 1];
                end = index + 2;
            }
        } else {
            value = String.fromCodePoint(body.codePointAt(index));
            end = index + value.length;
        }
        if (value === null || value === undefined) return '*';

        if (body[end] === '-' && end + 1 < body.length) {
            const rangeEnd = String.fromCodePoint(body.codePointAt(end + 1));
            const firstCode = value.codePointAt(0);
            const lastCode = rangeEnd.codePointAt(0);
            if (lastCode < firstCode || lastCode - firstCode > 128) return '*';
            for (let code = firstCode; code <= lastCode; code += 1) characters.add(foldSafetyChar(String.fromCodePoint(code), caseInsensitive));
            index = end + 1 + rangeEnd.length;
        } else {
            characters.add(foldSafetyChar(value, caseInsensitive));
            index = end;
        }
    }
    return `set:${[...characters].sort().join('')}`;
}

function decodeAtom(source, index, caseInsensitive) {
    const char = source[index];
    if (char === '.') return { end: index + 1, key: '*' };
    if (char === '[') {
        let end = index + 1;
        let escaped = false;
        while (end < source.length) {
            if (escaped) escaped = false;
            else if (source[end] === '\\') escaped = true;
            else if (source[end] === ']') break;
            end += 1;
        }
        const body = source.slice(index + 1, end);
        return { end: Math.min(end + 1, source.length), key: characterClassKey(body, caseInsensitive) };
    }
    if (char === '\\') {
        const rest = source.slice(index);
        const decoded = decodeSafetyEscape(rest);
        if (decoded) {
            return { end: index + decoded.length, key: decoded.value === null ? '*' : `char:${foldSafetyChar(decoded.value, caseInsensitive)}` };
        }
        const escaped = source[index + 1] || '';
        if (/[dDwWsSpP]/.test(escaped)) return { end: index + 2, key: escaped === escaped.toUpperCase() ? '*' : `class:${escaped}` };
        return { end: Math.min(index + 2, source.length), key: `char:${foldSafetyChar(escaped, caseInsensitive)}` };
    }
    const value = String.fromCodePoint(source.codePointAt(index));
    return { end: index + value.length, key: `char:${foldSafetyChar(value, caseInsensitive)}` };
}

function simpleGroupKey(source, caseInsensitive) {
    if (!source) return null;
    const atom = decodeAtom(source, 0, caseInsensitive);
    const quantifier = quantifierAt(source, atom.end);
    return atom.end + quantifier.length === source.length && !isUnboundedQuantifier(quantifier) ? atom.key : null;
}

function atomKeysOverlap(left, right) {
    if (left === '*' || right === '*') return true;
    if (left === right) return true;
    const membership = (category, char) => {
        if (category === 'class:d') return /[0-9]/.test(char);
        if (category === 'class:w') return /[A-Za-z0-9_]/.test(char);
        if (category === 'class:s') return /\s/.test(char);
        return false;
    };
    const values = key => key.startsWith('set:') ? [...key.slice(4)] : (key.startsWith('char:') ? [key.slice(5)] : null);
    const leftValues = values(left);
    const rightValues = values(right);
    if (leftValues && rightValues) return leftValues.some(value => rightValues.includes(value));
    if (leftValues && right.startsWith('class:')) return leftValues.some(value => membership(right, value));
    if (rightValues && left.startsWith('class:')) return rightValues.some(value => membership(left, value));
    return (left === 'class:d' && right === 'class:w') || (left === 'class:w' && right === 'class:d');
}

function findGroupEnd(source, start) {
    let depth = 1;
    let inClass = false;
    let escaped = false;
    for (let index = start + 1; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '[') inClass = true;
        else if (char === ']' && inClass) inClass = false;
        else if (!inClass && char === '(') depth += 1;
        else if (!inClass && char === ')' && --depth === 0) return index;
    }
    return source.length - 1;
}

function hasOverlappingUnboundedRuns(source, caseInsensitive = false) {
    let activeKeys = [];
    let boundedRuns = [];
    for (let index = 0; index < source.length;) {
        const char = source[index];
        if (char === '|' || char === '^' || char === '$') {
            if (char === '|') activeKeys = [];
            index += 1;
            continue;
        }
        if (char === '(') {
            const end = findGroupEnd(source, index);
            const rawBody = source.slice(index + 1, end);
            const zeroWidthGroup = /^\?(?:[=!]|<[=!])/.test(rawBody);
            const body = rawBody.replace(/^\?(?:[:=!]|<[=!]|<[^>]{1,64}>)/, '');
            if (hasOverlappingUnboundedRuns(body, caseInsensitive)) return true;
            const quantifier = quantifierAt(source, end + 1);
            const groupKey = zeroWidthGroup ? null : simpleGroupKey(body, caseInsensitive);
            if (groupKey && isUnboundedQuantifier(quantifier)) {
                if (activeKeys.some(key => atomKeysOverlap(key, groupKey))) return true;
                activeKeys.push(groupKey);
            } else if (groupKey && boundedQuantifierChoices(quantifier) > 1) {
                const choices = boundedQuantifierChoices(quantifier);
                const prior = boundedRuns.find(run => atomKeysOverlap(run.key, groupKey));
                const score = (prior?.score || 1) * choices;
                if (prior && score >= 4096) return true;
                boundedRuns = [{ key: groupKey, score }];
            } else if (groupKey && activeKeys.some(key => atomKeysOverlap(key, groupKey))) {
                // Preserve an earlier ambiguous run through an overlapping fixed atom.
            } else if (!zeroWidthGroup && !mayMatchWithoutConsuming(body)) {
                activeKeys = [];
                boundedRuns = [];
            }
            index = end + 1 + quantifier.length;
            continue;
        }
        if (char === '\\' && (source[index + 1] === 'b' || source[index + 1] === 'B')) {
            index += 2;
            continue;
        }
        if (char === ')' || char === '?' || char === '*' || char === '+' || char === '{') {
            index += 1;
            continue;
        }

        const atom = decodeAtom(source, index, caseInsensitive);
        const quantifier = quantifierAt(source, atom.end);
        if (isUnboundedQuantifier(quantifier)) {
            if (activeKeys.some(key => atomKeysOverlap(key, atom.key))) return true;
            activeKeys.push(atom.key);
        } else if (boundedQuantifierChoices(quantifier) > 1) {
            const choices = boundedQuantifierChoices(quantifier);
            const prior = boundedRuns.find(run => atomKeysOverlap(run.key, atom.key));
            const score = (prior?.score || 1) * choices;
            if (prior && score >= 4096) return true;
            boundedRuns = [{ key: atom.key, score }];
        } else if (!activeKeys.some(key => atomKeysOverlap(key, atom.key))) {
            activeKeys = [];
            boundedRuns = [];
        }
        index = atom.end + quantifier.length;
    }
    return false;
}

export function hasUnsafeNestedQuantifier(pattern, flags = '') {
    const source = String(pattern ?? '');
    const caseInsensitive = String(flags).includes('i');
    if (hasOverlappingUnboundedRuns(source, caseInsensitive)) return true;

    const stack = [];
    let boundedAmbiguityScore = 1;
    let inClass = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '[') inClass = true;
        else if (char === ']' && inClass) inClass = false;
        else if (!inClass && char === '(') stack.push(index);
        else if (!inClass && char === ')' && stack.length) {
            const start = stack.pop();
            const outerQuantifier = quantifierAt(source, index + 1);
            if (!outerQuantifier) continue;
            const body = source.slice(start + 1, index).replace(/^\?(?:[:=!]|<[=!]|<[^>]{1,64}>)/, '');
            const structuralBody = body.replace(/\\./g, '').replace(/\[(?:\\.|[^\]])*\]/g, '');
            const hasInnerRepeat = /(?:[+*]|\{\d+(?:,\d*)?\})/.test(structuralBody);
            const hasInnerUnbounded = /(?:[+*]|\{\d+,\})/.test(structuralBody);
            if (!isUnboundedQuantifier(outerQuantifier)) {
                const bounds = outerQuantifier.match(/^\{(\d+)(?:,(\d*))?\}$/);
                const maximum = bounds?.[2] === '' ? Infinity : Number(bounds?.[2] ?? bounds?.[1] ?? 1);
                if (hasInnerUnbounded && maximum > 1) return true;
                const ambiguousBody = mayMatchWithoutConsuming(body)
                    || hasAmbiguousAlternation(body, caseInsensitive);
                const hasInnerVariableRepeat = /(?:\?(?![<:=!])|\{\d+,\d+\})/.test(structuralBody);
                const repeatFactor = boundedRepeatFactor(structuralBody, maximum);
                if (ambiguousBody || hasInnerVariableRepeat) {
                    boundedAmbiguityScore *= 2 ** Math.min(8, repeatFactor);
                    if (boundedAmbiguityScore >= 256) return true;
                }
                continue;
            }
            if (hasInnerRepeat || mayMatchWithoutConsuming(body) || hasAmbiguousAlternation(body, caseInsensitive)) return true;
        }
    }
    return false;
}

export function tokenizeKeywordList(input) {
    const original = String(input ?? '');
    const inputTruncated = original.length > REGEX_TOOL_LIMITS.maxInputLength;
    const text = original.slice(0, REGEX_TOOL_LIMITS.maxInputLength).replace(/\r\n?/g, '\n');
    const items = [];
    let omitted = 0;
    let index = 0;
    const finalSegmentWasCut = inputTruncated && !/[,\n]$/.test(text);

    const push = (start, end, issue = null) => {
        const raw = text.slice(start, end).trim();
        if (!raw) return;
        if (items.length >= REGEX_TOOL_LIMITS.maxItems) {
            omitted += 1;
            return;
        }
        const finalIssue = finalSegmentWasCut && end === text.length ? 'input_cut' : issue;
        items.push({
            raw: raw.slice(0, REGEX_TOOL_LIMITS.maxItemLength),
            start,
            end,
            issue: raw.length > REGEX_TOOL_LIMITS.maxItemLength ? 'item_too_long' : finalIssue,
        });
    };

    while (index < text.length) {
        while (index < text.length && (text[index] === ',' || text[index] === '\n' || /\s/.test(text[index]))) index += 1;
        if (index >= text.length) break;

        const start = index;
        if (text[index] !== '/') {
            while (index < text.length && text[index] !== ',' && text[index] !== '\n') index += 1;
            push(start, index);
            continue;
        }

        index += 1;
        let escaped = false;
        let inClass = false;
        let closed = false;

        while (index < text.length) {
            const char = text[index];
            if (char === '\n') break;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '[') {
                inClass = true;
            } else if (char === ']' && inClass) {
                inClass = false;
            } else if (char === '/' && !inClass) {
                closed = true;
                index += 1;
                break;
            }
            index += 1;
        }

        if (!closed) {
            while (index < text.length && text[index] !== '\n') index += 1;
            push(start, index, 'unterminated');
            continue;
        }

        while (index < text.length && /[A-Za-z]/.test(text[index])) index += 1;
        const flagsEnd = index;
        while (index < text.length && text[index] !== ',' && text[index] !== '\n') index += 1;
        const hasTrailing = text.slice(flagsEnd, index).trim().length > 0;
        push(start, index, hasTrailing ? 'trailing_characters' : null);
    }

    return { items, omitted, inputTruncated };
}

export function tokenizePlaintextList(input) {
    const original = String(input ?? '');
    const inputTruncated = original.length > REGEX_TOOL_LIMITS.maxInputLength;
    const text = original.slice(0, REGEX_TOOL_LIMITS.maxInputLength).replace(/\r\n?/g, '\n');
    const items = [];
    let omitted = 0;

    const segments = text.split(/[,\n]/);
    const finalSegmentWasCut = inputTruncated && !/[,\n]$/.test(text);
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const normalized = segment.trim().normalize('NFC');
        if (!normalized) continue;
        if (items.length >= REGEX_TOOL_LIMITS.maxItems) {
            omitted += 1;
            continue;
        }
        items.push({
            raw: normalized.slice(0, REGEX_TOOL_LIMITS.maxItemLength),
            issue: normalized.length > REGEX_TOOL_LIMITS.maxItemLength
                ? 'item_too_long'
                : (finalSegmentWasCut && index === segments.length - 1 ? 'input_cut' : null),
        });
    }

    return { items, omitted, inputTruncated };
}

export function validatePlaintextItem(input, language) {
    const value = String(input ?? '').normalize('NFC');
    const selected = CONSTRUCTOR_LETTERS[language];
    if (!selected) return { valid: false, code: 'language' };

    const characters = [...value];
    if (characters.some(char => UNICODE_LETTER.test(char) && !selected.test(char))) {
        return { valid: false, code: 'alphabet_mismatch' };
    }
    if (!characters.length || !selected.test(characters[0]) || !selected.test(characters.at(-1))) {
        return { valid: false, code: 'boundary' };
    }
    return { valid: true };
}

function regularEnglishPlural(word) {
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
    return `${word}s`;
}

function regularEnglishVerbForms(word) {
    const lower = word.toLocaleLowerCase('en-US');
    const doublesFinalConsonant = ENGLISH_DOUBLE_FINAL.has(lower);
    const keepsFinalE = ENGLISH_KEEP_E_GERUND.has(lower) || /(?:ee|ye|oe)$/i.test(word);
    const doubled = doublesFinalConsonant ? `${word}${word.at(-1)}` : word;
    const thirdPerson = /[^aeiou]y$/i.test(word)
        ? `${word.slice(0, -1)}ies`
        : (/(?:s|x|z|ch|sh|o)$/i.test(word) ? `${word}es` : `${word}s`);
    const past = /c$/i.test(word)
        ? `${word}ked`
        : /[^aeiou]y$/i.test(word)
        ? `${word.slice(0, -1)}ied`
        : (/e$/i.test(word) ? `${word}d` : `${doubled}ed`);
    const gerund = /ie$/i.test(word)
        ? `${word.slice(0, -2)}ying`
        : (/c$/i.test(word)
            ? `${word}king`
            : (/e$/i.test(word) && !keepsFinalE ? `${word.slice(0, -1)}ing` : `${doubled}ing`));
    return [thirdPerson, past, gerund];
}

export function suggestEnglishForms(values) {
    const sourceValues = [...values]
        .map(value => String(value ?? '').normalize('NFC'))
        .filter(value => /^[A-Za-z]+$/.test(value));
    const existing = new Set(sourceValues.map(value => value.toLocaleLowerCase('en-US')));
    const suggestions = new Map();
    let omitted = 0;

    const add = (value, source, kind) => {
        const key = value.toLocaleLowerCase('en-US');
        if (existing.has(key)) return;
        const prior = suggestions.get(key);
        if (prior) {
            if (!prior.kinds.includes(kind)) prior.kinds.push(kind);
            if (!prior.sources.includes(source)) prior.sources.push(source);
            return;
        }
        if (suggestions.size >= REGEX_TOOL_LIMITS.maxSuggestions) {
            omitted += 1;
            return;
        }
        suggestions.set(key, { value, sources: [source], kinds: [kind] });
    };

    for (const source of sourceValues) {
        const lower = source.toLocaleLowerCase('en-US');
        const irregular = ENGLISH_IRREGULAR_GROUPS.find(group => group.forms.includes(lower));
        if (irregular) {
            for (const form of irregular.forms) add(form, source, `irregular_${irregular.kind}`);
            continue;
        }
        if (ENGLISH_FUNCTION_WORDS.has(lower)) continue;
        if (!/(?:s|ies|ches|shes|xes|zes)$/i.test(source)) add(regularEnglishPlural(source), source, 'plural');
        if (!/(?:s|ed|ing)$/i.test(source)) {
            for (const form of regularEnglishVerbForms(source)) add(form, source, 'verb');
        }
    }

    return { suggestions: [...suggestions.values()], omitted };
}

function escapeRegexLiteral(value) {
    return value
        .split(/\s+/u)
        .map(part => part.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'))
        .join('\\s+');
}

function wrapConstructedSource(source, language) {
    return language === 'latin'
        ? `/\\b${source}\\b/i`
        : `/(?<![А-Яа-яЁё])${source}(?![А-Яа-яЁё])/i`;
}

function buildFamilyPattern(root, members, language) {
    const suffixes = members
        .filter(member => member !== root)
        .sort((left, right) => left.index - right.index)
        .map(member => escapeRegexLiteral(member.value.slice(root.value.length)));
    let source = escapeRegexLiteral(root.value);
    if (suffixes.length === 1) {
        source += [...suffixes[0]].length === 1 ? `${suffixes[0]}?` : `(?:${suffixes[0]})?`;
    } else if (suffixes.length > 1) {
        source += `(?:${suffixes.join('|')})?`;
    }
    return wrapConstructedSource(source, language);
}

function buildYPluralPattern(singular) {
    const stem = singular.value.slice(0, -1);
    return wrapConstructedSource(`${escapeRegexLiteral(stem)}(?:y|ies)`, 'latin');
}

function sharedPrefix(left, right) {
    const length = Math.min(left.length, right.length);
    let index = 0;
    while (index < length && left[index] === right[index]) index += 1;
    return left.slice(0, index).replace(/\s+$/u, '');
}

function buildSharedStemPattern(stem, members, language) {
    const suffixes = members
        .sort((left, right) => left.index - right.index)
        .map(member => escapeRegexLiteral(member.value.slice(stem.length)));
    return wrapConstructedSource(`${escapeRegexLiteral(stem)}(?:${suffixes.join('|')})`, language);
}

export function constructRegexList(input, language = 'latin', includedForms = []) {
    const tokenized = tokenizePlaintextList(input);
    const errors = [];
    const warnings = [];
    const entries = [];
    const seen = new Set();
    const locale = language === 'cyrillic' ? 'ru-RU' : 'en-US';

    for (const item of tokenized.items) {
        if (item.issue) {
            errors.push({ source: item.raw, code: item.issue });
            continue;
        }
        const validation = validatePlaintextItem(item.raw, language);
        if (!validation.valid) {
            errors.push({ source: item.raw, code: validation.code });
            continue;
        }
        const key = item.raw.toLocaleLowerCase(locale);
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ value: item.raw, key, index: entries.length });
    }

    const suggested = language === 'latin'
        ? suggestEnglishForms(entries.map(entry => entry.value))
        : { suggestions: [], omitted: 0 };
    const allowedAdditions = new Map(suggested.suggestions.map(entry => [
        entry.value.toLocaleLowerCase(locale),
        entry.value,
    ]));
    const additions = Array.isArray(includedForms) ? includedForms : [];
    for (const value of additions.slice(0, REGEX_TOOL_LIMITS.maxSuggestions)) {
        const normalized = String(value ?? '').trim().normalize('NFC');
        const key = normalized.toLocaleLowerCase(locale);
        const allowed = allowedAdditions.get(key);
        if (!allowed || seen.has(key)) continue;
        seen.add(key);
        entries.push({ value: allowed, key, index: entries.length });
    }

    const groupedKeys = new Set();
    const groups = [];
    if (language === 'latin') {
        const byKey = new Map(entries.map(entry => [entry.key, entry]));
        for (const singular of entries) {
            if (!/[b-df-hj-np-tv-z]y$/i.test(singular.key) || groupedKeys.has(singular.key)) continue;
            const plural = byKey.get(`${singular.key.slice(0, -1)}ies`);
            if (!plural || groupedKeys.has(plural.key)) continue;
            groupedKeys.add(singular.key);
            groupedKeys.add(plural.key);
            groups.push({
                root: singular,
                members: [singular, plural],
                firstIndex: Math.min(singular.index, plural.index),
                combined: buildYPluralPattern(singular),
            });
        }
    }

    const families = new Map();
    for (const entry of entries) {
        if (groupedKeys.has(entry.key)) continue;
        let root = entry;
        for (const candidate of entries) {
            if (groupedKeys.has(candidate.key)) continue;
            if (!entry.key.startsWith(candidate.key)) continue;
            if (candidate.key.length < root.key.length
                || (candidate.key.length === root.key.length && candidate.index < root.index)) {
                root = candidate;
            }
        }
        if (!families.has(root.key)) families.set(root.key, { root, members: [], firstIndex: entry.index });
        const family = families.get(root.key);
        family.members.push(entry);
        family.firstIndex = Math.min(family.firstIndex, entry.index);
    }
    for (const family of families.values()) {
        if (family.members.length < 2) continue;
        groups.push(family);
        for (const member of family.members) groupedKeys.add(member.key);
    }

    const sharedCandidates = new Map();
    const remaining = entries.filter(entry => !groupedKeys.has(entry.key));
    for (let left = 0; left < remaining.length; left += 1) {
        for (let right = left + 1; right < remaining.length; right += 1) {
            const stemKey = sharedPrefix(remaining[left].key, remaining[right].key);
            const shortest = Math.min(remaining[left].key.length, remaining[right].key.length);
            if (stemKey.length < 4 || stemKey.length / shortest < 0.5 || sharedCandidates.has(stemKey)) continue;
            const members = remaining.filter(entry => entry.key.startsWith(stemKey)
                && stemKey.length / entry.key.length >= 0.5);
            if (members.length < 2) continue;
            sharedCandidates.set(stemKey, {
                stemKey,
                stem: members[0].value.slice(0, stemKey.length),
                members,
                firstIndex: Math.min(...members.map(member => member.index)),
            });
        }
    }

    const claimedSharedKeys = new Set();
    const candidates = [...sharedCandidates.values()].sort((left, right) =>
        right.members.length - left.members.length
        || right.stemKey.length - left.stemKey.length
        || left.firstIndex - right.firstIndex);
    for (const candidate of candidates) {
        const members = candidate.members.filter(member => !claimedSharedKeys.has(member.key));
        if (members.length < 2) continue;
        for (const member of members) {
            claimedSharedKeys.add(member.key);
            groupedKeys.add(member.key);
        }
        groups.push({
            root: members[0],
            members,
            firstIndex: Math.min(...members.map(member => member.index)),
            combined: buildSharedStemPattern(candidate.stem, members, language),
        });
    }
    for (const entry of entries) {
        if (groupedKeys.has(entry.key)) continue;
        groups.push({ root: entry, members: [entry], firstIndex: entry.index });
    }

    const patterns = [];
    for (const family of groups.sort((left, right) => left.firstIndex - right.firstIndex)) {
        const combined = family.combined || buildFamilyPattern(family.root, family.members, language);
        const diagnostic = diagnoseRegexKey(combined);
        if (diagnostic.status === 'valid') {
            patterns.push(combined);
            continue;
        }

        if (family.members.length > 1) warnings.push({ source: family.root.value, code: 'family_split' });
        for (const member of family.members.sort((left, right) => left.index - right.index)) {
            const separate = wrapConstructedSource(escapeRegexLiteral(member.value), language);
            if (diagnoseRegexKey(separate).status === 'valid') patterns.push(separate);
            else errors.push({ source: member.value, code: 'generated_too_long' });
        }
    }

    return {
        patterns,
        errors,
        warnings,
        suggestions: suggested.suggestions,
        suggestionsOmitted: suggested.omitted,
        omitted: tokenized.omitted,
        inputTruncated: tokenized.inputTruncated,
    };
}

export function diagnoseRegexKey(input) {
    const value = String(input ?? '').trim();
    if (value.length > REGEX_TOOL_LIMITS.maxItemLength) {
        return { status: 'invalid', code: 'item_too_long', input: value.slice(0, REGEX_TOOL_LIMITS.maxItemLength) };
    }
    if (!value.startsWith('/')) return { status: 'literal', input: value };

    let escaped = false;
    let inClass = false;
    let closeIndex = -1;
    for (let index = 1; index < value.length; index += 1) {
        const char = value[index];
        if (char === '\n' || char === '\r') {
            return { status: 'invalid', code: 'line_break', input: value };
        }
        if (escaped) {
            escaped = false;
        } else if (char === '\\') {
            escaped = true;
        } else if (char === '[') {
            inClass = true;
        } else if (char === ']' && inClass) {
            inClass = false;
        } else if (char === '/' && !inClass) {
            closeIndex = index;
            break;
        }
    }

    if (closeIndex < 0) return { status: 'invalid', code: 'unterminated', input: value };
    const source = value.slice(1, closeIndex);
    const flags = value.slice(closeIndex + 1);
    if (!source) return { status: 'invalid', code: 'empty_pattern', input: value, source, flags };
    if (!/^[A-Za-z]*$/.test(flags)) {
        return { status: 'invalid', code: 'trailing_characters', input: value, source, flags };
    }

    const seen = new Set();
    for (const flag of flags) {
        if (!'dgimsuvy'.includes(flag)) {
            return { status: 'invalid', code: 'unknown_flag', flag, input: value, source, flags };
        }
        if (seen.has(flag)) {
            return { status: 'invalid', code: 'duplicate_flag', flag, input: value, source, flags };
        }
        seen.add(flag);
    }
    if (seen.has('u') && seen.has('v')) {
        return { status: 'invalid', code: 'incompatible_flags', input: value, source, flags };
    }

    let regex;
    try {
        regex = new RegExp(source, flags);
    } catch (error) {
        return {
            status: 'invalid',
            code: 'syntax',
            detail: error instanceof Error ? error.message.slice(0, 240) : '',
            input: value,
            source,
            flags,
        };
    }

    if (hasUnsafeNestedQuantifier(source, flags)) {
        return { status: 'unsafe', code: 'nested_quantifier', input: value, source, flags };
    }
    return { status: 'valid', input: value, source, flags, regex };
}

function uniqueBounded(values, limit) {
    const output = [];
    const seen = new Set();
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        output.push(value);
        if (output.length >= limit) break;
    }
    return output;
}

function combine(left, right, limit, budget) {
    if (!left.length || !right.length) return [];
    const output = [];
    for (const prefix of left) {
        for (const suffix of right) {
            const length = prefix.length + suffix.length;
            if (length > REGEX_TOOL_LIMITS.maxVariantLength || length > budget.remaining) {
                budget.exceeded = true;
                return [];
            }
            output.push(prefix + suffix);
            budget.remaining -= length;
            if (output.length >= limit) return uniqueBounded(output, limit);
        }
    }
    return uniqueBounded(output, limit);
}

function repeatVariants(values, count, limit, budget) {
    let output = [''];
    for (let index = 0; index < count; index += 1) {
        output = combine(output, values, limit, budget);
        if (!output.length) break;
    }
    return output;
}

class EmptyMatchParser {
    constructor(source) {
        this.source = source;
        this.index = 0;
        this.depth = 0;
    }

    parse() {
        return this.parseAlternation(null);
    }

    parseAlternation(stop) {
        let mayBeEmpty = this.parseSequence(stop);
        while (this.source[this.index] === '|') {
            this.index += 1;
            const branchMayBeEmpty = this.parseSequence(stop);
            mayBeEmpty = mayBeEmpty || branchMayBeEmpty;
        }
        return mayBeEmpty;
    }

    parseSequence(stop) {
        let mayBeEmpty = true;
        while (this.index < this.source.length) {
            const char = this.source[this.index];
            if (char === '|' || (stop && char === stop)) break;
            const atomMayBeEmpty = this.parseAtom();
            const quantifiedMayBeEmpty = this.applyQuantifier(atomMayBeEmpty);
            mayBeEmpty = mayBeEmpty && quantifiedMayBeEmpty;
        }
        return mayBeEmpty;
    }

    parseAtom() {
        const char = this.source[this.index++];
        if (char === '^' || char === '$') return true;
        if (char === '\\') {
            if (this.index >= this.source.length) return false;
            const escaped = this.source[this.index++];
            if (escaped === 'b' || escaped === 'B') return true;
            if (/[1-9]/.test(escaped)) {
                while (/\d/.test(this.source[this.index] || '')) this.index += 1;
                return true;
            }
            if (escaped === 'k') {
                if (this.source[this.index] === '<') {
                    const close = this.source.indexOf('>', this.index + 1);
                    this.index = close < 0 ? this.source.length : close + 1;
                }
                return true;
            }
            if (escaped === 'p' || escaped === 'P') this.skipBrace();
            else if (escaped === 'x') this.index += 2;
            else if (escaped === 'u') this.skipUnicodeEscape();
            else if (escaped === 'c') this.index += 1;
            return false;
        }
        if (char === '[') {
            this.skipClass();
            return false;
        }
        if (char !== '(') return false;
        return this.parseGroup();
    }

    parseGroup() {
        this.depth += 1;
        if (this.depth > REGEX_TOOL_LIMITS.maxDepth) {
            this.skipGroup();
            this.depth -= 1;
            return true;
        }

        if (this.source[this.index] === '?') {
            if (this.source.startsWith('?:', this.index)) {
                this.index += 2;
            } else if (this.source.startsWith('?=', this.index) || this.source.startsWith('?!', this.index)) {
                this.index += 2;
                this.skipGroup();
                this.depth -= 1;
                return true;
            } else if (this.source.startsWith('?<=', this.index) || this.source.startsWith('?<!', this.index)) {
                this.index += 3;
                this.skipGroup();
                this.depth -= 1;
                return true;
            } else if (this.source.startsWith('?<', this.index)) {
                const close = this.source.indexOf('>', this.index + 2);
                if (close < 0) {
                    this.skipGroup();
                    this.depth -= 1;
                    return true;
                }
                this.index = close + 1;
            } else {
                this.skipGroup();
                this.depth -= 1;
                return true;
            }
        }

        const mayBeEmpty = this.parseAlternation(')');
        if (this.source[this.index] === ')') this.index += 1;
        this.depth -= 1;
        return mayBeEmpty;
    }

    applyQuantifier(atomMayBeEmpty) {
        const rest = this.source.slice(this.index);
        const match = rest.match(/^(?:([?*+])|\{(\d+)(?:,(\d*))?\})/);
        if (!match) return atomMayBeEmpty;
        this.index += match[0].length;
        if (this.source[this.index] === '?') this.index += 1;
        if (match[1] === '?' || match[1] === '*') return true;
        if (match[1] === '+') return atomMayBeEmpty;
        return Number(match[2]) === 0 || atomMayBeEmpty;
    }

    skipClass() {
        let escaped = false;
        while (this.index < this.source.length) {
            const char = this.source[this.index++];
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === ']') break;
        }
    }

    skipGroup() {
        let depth = 1;
        let inClass = false;
        let escaped = false;
        while (this.index < this.source.length && depth > 0) {
            const char = this.source[this.index++];
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '[') inClass = true;
            else if (char === ']' && inClass) inClass = false;
            else if (!inClass && char === '(') depth += 1;
            else if (!inClass && char === ')') depth -= 1;
        }
    }

    skipBrace() {
        if (this.source[this.index] !== '{') return;
        const close = this.source.indexOf('}', this.index + 1);
        this.index = close < 0 ? this.source.length : close + 1;
    }

    skipUnicodeEscape() {
        if (this.source[this.index] === '{') this.skipBrace();
        else this.index += 4;
    }
}

export function mayMatchWithoutConsuming(source) {
    return new EmptyMatchParser(String(source ?? '')).parse();
}

class VariantParser {
    constructor(source) {
        this.source = source;
        this.index = 0;
        this.depth = 0;
        this.reasons = new Set();
        this.truncated = false;
        this.hasAssertions = false;
        this.limit = REGEX_TOOL_LIMITS.maxVariantsPerItem;
        this.budget = { remaining: REGEX_TOOL_LIMITS.maxExpansionCharacters, exceeded: false };
    }

    parse() {
        const variants = this.parseAlternation(null);
        if (this.index < this.source.length) this.reasons.add('unsupported');
        if (this.truncated) this.reasons.add('variant_limit');
        if (this.budget.exceeded) this.reasons.add('size_limit');
        return {
            variants: uniqueBounded(variants, this.limit),
            complete: this.reasons.size === 0 && !this.truncated,
            reasons: [...this.reasons],
            truncated: this.truncated,
            hasAssertions: this.hasAssertions,
        };
    }

    parseAlternation(stop) {
        const branches = [];
        while (true) {
            branches.push(this.parseSequence(stop));
            if (this.source[this.index] !== '|') break;
            this.index += 1;
        }
        const allVariants = branches.flat();
        const merged = uniqueBounded(allVariants, this.limit);
        if (new Set(allVariants).size > this.limit) this.truncated = true;
        return merged;
    }

    parseSequence(stop) {
        let output = [''];
        while (this.index < this.source.length) {
            const char = this.source[this.index];
            if (char === '|' || (stop && char === stop)) break;
            const atom = this.parseAtom();
            const expanded = this.applyQuantifier(atom);
            if (output.length * expanded.length > this.limit) this.truncated = true;
            output = combine(output, expanded, this.limit, this.budget);
            if (!output.length) break;
        }
        return output;
    }

    unsupported(reason = 'unsupported') {
        this.reasons.add(reason);
        return { variants: [], whitespace: false };
    }

    parseAtom() {
        const char = this.source[this.index++];
        if (char === '^' || char === '$') return { variants: [''], whitespace: false };
        if (char === '.') return this.unsupported('open_ended');
        if (char === '\\') return this.parseEscape();
        if (char === '[') return this.parseClass();
        if (char === '(') return this.parseGroup();
        return { variants: [char], whitespace: false };
    }

    parseEscape() {
        if (this.index >= this.source.length) return this.unsupported();
        const char = this.source[this.index++];
        if (char === 'b' || char === 'B') return { variants: [''], whitespace: false };
        if (char === 's') return { variants: [' '], whitespace: true };
        if ('dDwWS'.includes(char) || /[1-9]/.test(char) || char === 'k' || char === 'p' || char === 'P') {
            return this.unsupported(char === 'p' || char === 'P' ? 'unicode_class' : 'character_class');
        }
        const fixed = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', 0: '\0' };
        if (Object.hasOwn(fixed, char)) return { variants: [fixed[char]], whitespace: false };
        if (char === 'x') return this.parseHexEscape(2);
        if (char === 'u') return this.parseUnicodeEscape();
        if (char === 'c') {
            if (this.index >= this.source.length) return this.unsupported();
            const code = this.source[this.index++].toUpperCase().charCodeAt(0) % 32;
            return { variants: [String.fromCharCode(code)], whitespace: false };
        }
        return { variants: [char], whitespace: false };
    }

    parseHexEscape(length) {
        const value = this.source.slice(this.index, this.index + length);
        if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(value)) return this.unsupported();
        this.index += length;
        return { variants: [String.fromCodePoint(Number.parseInt(value, 16))], whitespace: false };
    }

    parseUnicodeEscape() {
        if (this.source[this.index] === '{') {
            const close = this.source.indexOf('}', this.index + 1);
            if (close < 0) return this.unsupported();
            const value = this.source.slice(this.index + 1, close);
            this.index = close + 1;
            const codePoint = /^[0-9A-Fa-f]{1,6}$/.test(value) ? Number.parseInt(value, 16) : -1;
            if (codePoint < 0 || codePoint > 0x10ffff) return this.unsupported();
            return { variants: [String.fromCodePoint(codePoint)], whitespace: false };
        }
        return this.parseHexEscape(4);
    }

    parseClassCharacter() {
        if (this.index >= this.source.length) return null;
        const char = String.fromCodePoint(this.source.codePointAt(this.index));
        this.index += char.length;
        if (char !== '\\') return char;
        if (this.index >= this.source.length) return null;
        const escaped = this.source[this.index++];
        const fixed = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v' };
        if (Object.hasOwn(fixed, escaped)) return fixed[escaped];
        if (escaped === 'x') {
            const token = this.parseHexEscape(2);
            return token.variants[0] ?? null;
        }
        if (escaped === 'u') {
            const token = this.parseUnicodeEscape();
            return token.variants[0] ?? null;
        }
        if ('dDsSwWpPk'.includes(escaped) || /[1-9]/.test(escaped)) return null;
        return escaped;
    }

    parseClass() {
        if (this.source[this.index] === '^') {
            this.skipClass();
            return this.unsupported('character_class');
        }

        const values = [];
        let first = true;
        while (this.index < this.source.length) {
            if (this.source[this.index] === ']' && !first) {
                this.index += 1;
                return { variants: uniqueBounded(values, this.limit), whitespace: false };
            }
            first = false;
            const start = this.parseClassCharacter();
            if (start === null) {
                this.skipClass();
                return this.unsupported('character_class');
            }

            if (this.source[this.index] === '-' && this.source[this.index + 1] !== ']') {
                this.index += 1;
                const end = this.parseClassCharacter();
                if (end === null) {
                    this.skipClass();
                    return this.unsupported('character_class');
                }
                const firstCode = start.codePointAt(0);
                const lastCode = end.codePointAt(0);
                if (firstCode > lastCode || lastCode - firstCode + 1 > REGEX_TOOL_LIMITS.maxRepeat) {
                    this.skipClass();
                    return this.unsupported('large_character_class');
                }
                for (let code = firstCode; code <= lastCode; code += 1) values.push(String.fromCodePoint(code));
            } else {
                values.push(start);
            }
            if (values.length > this.limit) {
                this.truncated = true;
                values.length = this.limit;
            }
        }
        return this.unsupported();
    }

    skipClass() {
        let escaped = false;
        while (this.index < this.source.length) {
            const char = this.source[this.index++];
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === ']') break;
        }
    }

    parseGroup() {
        this.depth += 1;
        if (this.depth > REGEX_TOOL_LIMITS.maxDepth) {
            this.skipGroup();
            this.depth -= 1;
            return this.unsupported('depth_limit');
        }

        if (this.source[this.index] === '?') {
            if (this.source.startsWith('?:', this.index)) {
                this.index += 2;
            } else if (this.source.startsWith('?=', this.index) || this.source.startsWith('?!', this.index)) {
                this.index += 2;
                this.hasAssertions = true;
                this.skipGroup();
                this.depth -= 1;
                return { variants: [''], whitespace: false };
            } else if (this.source.startsWith('?<=', this.index) || this.source.startsWith('?<!', this.index)) {
                this.index += 3;
                this.hasAssertions = true;
                this.skipGroup();
                this.depth -= 1;
                return { variants: [''], whitespace: false };
            } else if (this.source.startsWith('?<', this.index)) {
                const close = this.source.indexOf('>', this.index + 2);
                if (close < 0) {
                    this.skipGroup();
                    this.depth -= 1;
                    return this.unsupported();
                }
                this.index = close + 1;
            } else {
                this.skipGroup();
                this.depth -= 1;
                return this.unsupported('group_type');
            }
        }

        const variants = this.parseAlternation(')');
        if (this.source[this.index] === ')') this.index += 1;
        this.depth -= 1;
        return { variants, whitespace: false };
    }

    skipGroup() {
        let depth = 1;
        let inClass = false;
        let escaped = false;
        while (this.index < this.source.length && depth > 0) {
            const char = this.source[this.index++];
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '[') {
                inClass = true;
            } else if (char === ']' && inClass) {
                inClass = false;
            } else if (!inClass && char === '(') {
                depth += 1;
            } else if (!inClass && char === ')') {
                depth -= 1;
            }
        }
    }

    applyQuantifier(atom) {
        const char = this.source[this.index];
        if (char === '?') {
            this.index += 1;
            if (this.source[this.index] === '?') this.index += 1;
            return uniqueBounded(['', ...atom.variants], this.limit);
        }
        if (char === '*' || char === '+') {
            this.index += 1;
            if (this.source[this.index] === '?') this.index += 1;
            if (atom.whitespace) {
                this.reasons.add('normalized_whitespace');
                return char === '*' ? ['', ' '] : [' '];
            }
            this.reasons.add('open_ended');
            return [];
        }
        if (char !== '{') return atom.variants;

        const match = this.source.slice(this.index).match(/^\{(\d+)(?:,(\d*))?\}/);
        if (!match) return atom.variants;
        this.index += match[0].length;
        if (this.source[this.index] === '?') this.index += 1;
        const minimum = Number(match[1]);
        const hasComma = match[0].includes(',');
        const maximum = hasComma ? (match[2] === '' ? Infinity : Number(match[2])) : minimum;
        if (maximum > REGEX_TOOL_LIMITS.maxRepeat) {
            this.reasons.add('repeat_limit');
            return [];
        }

        const output = [];
        for (let count = minimum; count <= maximum; count += 1) {
            const repeated = repeatVariants(atom.variants, count, this.limit, this.budget);
            if (atom.variants.length > 1 && atom.variants.length ** count > this.limit) this.truncated = true;
            output.push(...repeated);
            if (output.length >= this.limit) {
                if (count < maximum || output.length > this.limit) this.truncated = true;
                output.length = this.limit;
                break;
            }
        }
        return uniqueBounded(output, this.limit);
    }
}

export function expandRegexVariants(source, flags = '') {
    if (flags.includes('v') && source.includes('[')) {
        return {
            variants: [],
            complete: false,
            reasons: ['unicode_sets'],
            truncated: false,
            hasAssertions: false,
        };
    }
    return new VariantParser(String(source ?? '')).parse();
}
