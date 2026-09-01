import { t } from '../i18n.js';
import { resolveKeyMacros } from '../core/matching.js';
import { log } from '../utils/log.js';
import {
    REGEX_TOOL_LIMITS,
    diagnoseRegexKey,
    expandRegexVariants,
    mayMatchWithoutConsuming,
    tokenizeKeywordList,
} from '../core/regex-tools.js';

let launcher = null;
let launchHandler = null;
let activePopup = null;

function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function iconButton(icon, label, className = '') {
    const button = element('button', `menu_button env-regex-editor__tool ${className}`.trim());
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = element('i', icon);
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    return button;
}

async function copyText(value) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            // Fall through to the bounded DOM fallback.
        }
    }
    const active = document.activeElement;
    const buffer = element('textarea', 'env-regex-copy-buffer');
    buffer.value = value;
    buffer.readOnly = true;
    document.body.append(buffer);
    buffer.select();
    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    } finally {
        buffer.remove();
        if (active instanceof HTMLElement) active.focus();
    }
    return copied;
}

function diagnosticText(result) {
    const values = { flag: result.flag || '', detail: result.detail || '' };
    return t(`regex.error.${result.code || 'syntax'}`, values);
}

function expansionText(reason) {
    return t(`regex.limit.${reason}`);
}

function inspectInput(value) {
    const tokenized = tokenizeKeywordList(value);
    const variants = [];
    const seenVariants = new Set();
    const limited = [];
    const invalid = [];
    const unsafe = [];
    const emptyMatches = [];
    const expansionCache = new Map();
    const macroCache = new Map();
    const diagnosticCache = new Map();
    const emptyMatchCache = new Map();
    let expansionWorkItems = 0;
    let caseInsensitive = false;
    let hasAssertions = false;

    for (const item of tokenized.items) {
        if (item.issue) {
            invalid.push({ source: item.raw, message: t(`regex.error.${item.issue}`) });
            continue;
        }

        let macroResolved = macroCache.get(item.raw);
        if (macroResolved === undefined) {
            const expanded = resolveKeyMacros(item.raw);
            macroResolved = expanded.length > REGEX_TOOL_LIMITS.maxItemLength
                ? { tooLong: true, preview: expanded.slice(0, REGEX_TOOL_LIMITS.maxItemLength).trim() }
                : { tooLong: false, value: expanded.trim() };
            macroCache.set(item.raw, macroResolved);
        }
        if (macroResolved.tooLong) {
            invalid.push({ source: item.raw, resolved: macroResolved.preview, message: t('regex.error.item_too_long') });
            continue;
        }
        macroResolved = macroResolved.value;
        if (!macroResolved) {
            invalid.push({ source: item.raw, message: t('regex.error.empty_item') });
            continue;
        }
        const resolved = macroResolved;
        let diagnostic = diagnosticCache.get(resolved);
        if (!diagnostic) {
            diagnostic = diagnoseRegexKey(resolved);
            diagnosticCache.set(resolved, diagnostic);
        }
        if (diagnostic.status === 'invalid') {
            invalid.push({ source: item.raw, resolved, message: diagnosticText(diagnostic) });
            continue;
        }
        if (diagnostic.status === 'unsafe') {
            unsafe.push({ source: item.raw, resolved, message: diagnosticText(diagnostic) });
            continue;
        }

        let expansion;
        if (diagnostic.status === 'literal') {
            expansion = { variants: [resolved], complete: true, reasons: [], truncated: false };
        } else {
            let matchesEmpty = emptyMatchCache.get(diagnostic.source);
            if (matchesEmpty === undefined) {
                matchesEmpty = mayMatchWithoutConsuming(diagnostic.source);
                emptyMatchCache.set(diagnostic.source, matchesEmpty);
            }
            if (matchesEmpty) {
                emptyMatches.push({ source: item.raw, resolved });
            }
            caseInsensitive ||= diagnostic.flags.includes('i');
            const cacheKey = `${diagnostic.source}\0${diagnostic.flags}`;
            expansion = expansionCache.get(cacheKey);
            if (!expansion && variants.length >= REGEX_TOOL_LIMITS.maxTotalVariants) {
                limited.push({
                    source: item.raw,
                    resolved,
                    reasons: [expansionText('global_variant_limit')],
                    previewCount: 0,
                });
                continue;
            }
            if (!expansion) {
                if (expansionWorkItems >= REGEX_TOOL_LIMITS.maxExpansionItems) {
                    limited.push({
                        source: item.raw,
                        resolved,
                        reasons: [expansionText('work_budget')],
                        previewCount: 0,
                    });
                    continue;
                }
                expansionWorkItems += 1;
                expansion = expandRegexVariants(diagnostic.source, diagnostic.flags);
                expansionCache.set(cacheKey, expansion);
            }
            hasAssertions ||= expansion.hasAssertions;
        }

        let hitTotalLimit = false;
        let addedCount = 0;
        for (const variant of expansion.variants) {
            if (seenVariants.has(variant)) continue;
            if (variants.length >= REGEX_TOOL_LIMITS.maxTotalVariants) {
                hitTotalLimit = true;
                break;
            }
            seenVariants.add(variant);
            variants.push(variant);
            addedCount += 1;
        }
        if (!expansion.complete || hitTotalLimit) {
            const reasons = expansion.reasons.map(expansionText);
            if (hitTotalLimit) reasons.push(expansionText('global_variant_limit'));
            limited.push({
                source: item.raw,
                resolved,
                reasons,
                previewCount: addedCount,
            });
        }
    }

    return {
        variants,
        limited,
        invalid,
        unsafe,
        emptyMatches,
        omitted: tokenized.omitted,
        inputTruncated: tokenized.inputTruncated,
        caseInsensitive,
        hasAssertions,
    };
}

function appendSource(card, entry) {
    const source = element('code', 'env-regex-result__source', entry.source);
    card.append(source);
    if (entry.resolved && entry.resolved !== entry.source) {
        const resolved = element('div', 'env-regex-result__resolved');
        resolved.append(
            element('span', 'env-regex-result__caption', t('regex.resolvedExpression')),
            element('code', '', entry.resolved),
        );
        card.append(resolved);
    }
}

function resultSection(title, count, tone, action = null) {
    const section = element('section', `env-regex-results__section env-regex-results__section--${tone}`);
    const heading = element('h4', 'env-regex-results__heading');
    const meta = element('span', 'env-regex-results__meta');
    meta.append(element('span', 'env-regex-results__count', String(count)));
    if (action) meta.append(action);
    heading.append(element('span', '', title), meta);
    section.append(heading);
    return section;
}

function renderResults(host, status, result) {
    host.replaceChildren();
    const issueCount = result.limited.length + result.invalid.length + result.unsafe.length
        + result.emptyMatches.length + result.omitted + Number(result.inputTruncated);
    status.textContent = t('regex.summary', { variants: result.variants.length, issues: issueCount });

    if (result.variants.length) {
        const copy = iconButton('fa-solid fa-copy', t('regex.copyVariants'), 'env-regex-results__copy');
        copy.addEventListener('click', async () => {
            const copyLength = result.variants.reduce((total, variant, index) =>
                total + variant.length + (index ? 2 : 0), 0);
            if (copyLength > REGEX_TOOL_LIMITS.maxClipboardLength) {
                status.textContent = t('regex.copyTooLarge');
                return;
            }
            const value = result.variants.join(', ');
            status.textContent = await copyText(value)
                ? t('regex.variantsCopied', { count: result.variants.length })
                : t('regex.copyFailed');
        });
        const section = resultSection(t('regex.resolved'), result.variants.length, 'valid', copy);
        const list = element('div', 'env-regex-variants');
        for (const variant of result.variants) list.append(element('code', 'env-regex-variant', variant || t('regex.emptyVariant')));
        section.append(list);
        if (result.caseInsensitive) {
            section.append(element('p', 'env-regex-results__annotation', t('regex.caseInsensitive')));
        }
        if (result.hasAssertions) {
            section.append(element('p', 'env-regex-results__annotation', t('regex.assertions')));
        }
        host.append(section);
    }

    if (result.emptyMatches.length) {
        const section = resultSection(t('regex.emptyMatchTitle'), result.emptyMatches.length, 'warning');
        for (const entry of result.emptyMatches) {
            const card = element('article', 'env-regex-result');
            appendSource(card, entry);
            card.append(element('p', '', t('regex.emptyMatchWarning')));
            section.append(card);
        }
        host.append(section);
    }

    if (result.limited.length) {
        const section = resultSection(t('regex.limited'), result.limited.length, 'limited');
        for (const entry of result.limited) {
            const card = element('article', 'env-regex-result');
            appendSource(card, entry);
            card.append(element('p', '', entry.reasons.join(' ')));
            if (entry.previewCount) card.append(element('span', 'env-regex-result__note', t('regex.previewCount', { count: entry.previewCount })));
            section.append(card);
        }
        host.append(section);
    }

    for (const [entries, title, tone] of [
        [result.invalid, t('regex.invalid'), 'invalid'],
        [result.unsafe, t('regex.unsafe'), 'unsafe'],
    ]) {
        if (!entries.length) continue;
        const section = resultSection(title, entries.length, tone);
        for (const entry of entries) {
            const card = element('article', 'env-regex-result');
            appendSource(card, entry);
            card.append(
                element('p', '', entry.message),
                element('p', 'env-regex-result__note', t('regex.literalFallback')),
            );
            section.append(card);
        }
        host.append(section);
    }

    if (result.omitted) {
        const note = element('p', 'env-regex-results__omitted', t('regex.omitted', { count: result.omitted }));
        host.append(note);
    }
    if (result.inputTruncated) {
        host.append(element('p', 'env-regex-results__omitted', t('regex.inputTruncated')));
    }

    if (!host.childElementCount) host.append(element('p', 'env-regex-results__empty', t('regex.noResults')));
}

async function openRegexChecker() {
    if (activePopup) return;
    const context = SillyTavern.getContext();
    const root = element('div', 'env-regex-dialog');
    root.dataset.channel = 'eyJhIjoiYWNlZW52dyIsInYiOiIyLjMuMCJ9';

    const heading = element('h3', 'env-regex-dialog__title', t('regex.title'));
    heading.id = 'env_regex_dialog_title';
    const intro = element('p', 'env-regex-dialog__intro', t('regex.intro'));
    intro.id = 'env_regex_dialog_intro';
    const editor = element('section', 'env-regex-editor');
    const editorHeader = element('div', 'env-regex-editor__header');
    const label = element('label', 'env-regex-editor__label', t('regex.inputLabel'));
    label.htmlFor = 'env_regex_input';
    const tools = element('div', 'env-regex-editor__tools');
    const selectAll = iconButton('fa-solid fa-object-group', t('regex.selectAll'));
    const paste = iconButton('fa-solid fa-paste', t('regex.paste'));
    const deleteAll = iconButton('fa-solid fa-eraser', t('regex.deleteAll'), 'env-regex-editor__tool--danger');
    const maximize = iconButton('fa-solid fa-maximize', t('regex.maximize'), 'editor_maximize');
    maximize.dataset.for = 'env_regex_input';
    maximize.dataset.tab = 'true';
    tools.append(maximize, selectAll, paste, deleteAll);
    editorHeader.append(label, tools);

    const textarea = element('textarea', 'text_pole env-regex-editor__input');
    textarea.id = 'env_regex_input';
    textarea.rows = 6;
    textarea.name = 'env_regex_input';
    textarea.maxLength = REGEX_TOOL_LIMITS.maxInputLength;
    textarea.autocomplete = 'off';
    textarea.placeholder = t('regex.placeholder');
    textarea.setAttribute('aria-describedby', 'env_regex_dialog_intro env_regex_help');
    textarea.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    textarea.spellcheck = false;
    const help = element('p', 'env-regex-editor__help', t('regex.help'));
    help.id = 'env_regex_help';
    editor.append(editorHeader, textarea, help);

    const status = element('div', 'env-regex-status', t('regex.ready'));
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'env-regex-actions');
    const check = element('button', 'menu_button env-regex-actions__check', t('regex.check'));
    check.type = 'button';
    actions.append(check);

    const results = element('div', 'env-regex-results');
    results.setAttribute('aria-label', t('regex.results'));
    root.append(heading, intro, editor, actions, status, results);

    const run = () => {
        if (!textarea.value.trim()) {
            results.replaceChildren();
            status.textContent = t('regex.emptyInput');
            textarea.focus();
            return;
        }
        try {
            renderResults(results, status, inspectInput(textarea.value));
        } catch (error) {
            results.replaceChildren();
            status.textContent = t('regex.checkFailed');
            log.error('Regex check failed:', error);
        }
    };

    check.addEventListener('click', run);
    selectAll.addEventListener('click', () => {
        textarea.focus();
        textarea.select();
    });
    paste.addEventListener('click', async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const available = Math.max(0, textarea.maxLength - (textarea.value.length - (end - start)));
            const inserted = clipboardText.slice(0, available);
            textarea.setRangeText(inserted, start, end, 'end');
            status.textContent = inserted.length < clipboardText.length ? t('regex.pasteTrimmed') : t('regex.pasted');
            textarea.focus();
        } catch {
            status.textContent = t('regex.pasteFailed');
        }
    });
    deleteAll.addEventListener('click', () => {
        textarea.value = '';
        results.replaceChildren();
        status.textContent = t('regex.ready');
        textarea.focus();
    });
    textarea.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        event.stopPropagation();
        run();
    });

    const popup = new context.Popup(root, context.POPUP_TYPE.TEXT, '', {
        allowVerticalScrolling: true,
        okButton: t('regex.close'),
        cancelButton: false,
        onOpen: () => {
            if (matchMedia('(pointer: fine)').matches) textarea.focus();
        },
    });
    popup.dlg?.classList.add('env-regex-popup');
    popup.dlg?.setAttribute('aria-labelledby', heading.id);
    popup.dlg?.setAttribute('aria-describedby', intro.id);
    activePopup = popup;
    try {
        await popup.show();
    } finally {
        activePopup = null;
        launcher?.focus();
    }
}

export function initRegexChecker() {
    const nextLauncher = document.getElementById('env_open_regex_checker');
    if (!nextLauncher || launcher === nextLauncher) return;
    destroyRegexChecker();
    launcher = nextLauncher;
    launchHandler = () => {
        void openRegexChecker().catch(error => log.error('Failed to open regex checker:', error));
    };
    launcher.addEventListener('click', launchHandler);
}

export function destroyRegexChecker() {
    if (launcher && launchHandler) launcher.removeEventListener('click', launchHandler);
    launcher = null;
    launchHandler = null;
    if (activePopup) {
        const { POPUP_RESULT } = SillyTavern.getContext();
        void activePopup.complete(POPUP_RESULT.CANCELLED);
    }
}
