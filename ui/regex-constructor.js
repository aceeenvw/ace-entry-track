import { t } from '../i18n.js';
import { log } from '../utils/log.js';
import { REGEX_TOOL_LIMITS, constructRegexList } from '../core/regex-tools.js';

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

function renderResults(host, status, result, includedSuggestions, onSuggestionChange, suggestionsOpen = false) {
    host.replaceChildren();
    const issueCount = result.errors.length + result.warnings.length + result.omitted
        + result.suggestionsOmitted + Number(result.inputTruncated);
    status.textContent = t('constructor.summary', { patterns: result.patterns.length, issues: issueCount });

    if (result.patterns.length) {
        const copy = iconButton('fa-solid fa-copy', t('constructor.copy'), 'env-regex-results__copy');
        copy.addEventListener('click', async () => {
            const value = result.patterns.join(', ');
            if (value.length > REGEX_TOOL_LIMITS.maxClipboardLength) {
                status.textContent = t('regex.copyTooLarge');
                return;
            }
            status.textContent = await copyText(value)
                ? t('constructor.copied', { count: result.patterns.length })
                : t('regex.copyFailed');
        });
        const section = resultSection(t('constructor.output'), result.patterns.length, 'valid', copy);
        const list = element('div', 'env-regex-constructed-list');
        list.append(element('code', 'env-regex-constructed', result.patterns.join(', ')));
        section.append(list);
        host.append(section);
    }

    if (result.suggestions.length) {
        const section = element('details', 'env-regex-results__section env-regex-results__section--suggestion');
        section.open = suggestionsOpen;
        const summary = element('summary', 'env-regex-results__heading');
        summary.append(
            element('span', '', t('constructor.suggestions')),
            element('span', 'env-regex-results__count', String(result.suggestions.length)),
        );
        section.append(summary, element('p', 'env-regex-results__annotation', t('constructor.suggestionsHelp')));
        const list = element('div', 'env-regex-suggestions');
        for (const suggestion of result.suggestions) {
            const option = element('label', 'env-regex-suggestion');
            const checkbox = element('input');
            checkbox.type = 'checkbox';
            checkbox.value = suggestion.value;
            checkbox.checked = includedSuggestions.has(suggestion.value);
            checkbox.setAttribute('aria-label', t('constructor.includeSuggestion', { word: suggestion.value }));
            checkbox.addEventListener('change', () => onSuggestionChange(
                suggestion.value,
                checkbox.checked,
                list.scrollTop,
            ));
            const text = element('span', 'env-regex-suggestion__text');
            text.append(
                element('code', 'env-regex-suggestion__value', suggestion.value),
                element('small', 'env-regex-suggestion__detail', t('constructor.suggestionDetail', {
                    source: suggestion.sources.join(', '),
                    kind: suggestion.kinds.map(kind => t(`constructor.suggestionKind.${kind}`)).join(' · '),
                })),
            );
            option.append(checkbox, text);
            list.append(option);
        }
        section.append(list);
        if (result.suggestionsOmitted) {
            section.append(element('p', 'env-regex-results__omitted', t('constructor.suggestionsOmitted', {
                count: result.suggestionsOmitted,
            })));
        }
        host.append(section);
    }

    if (result.warnings.length) {
        const section = resultSection(t('constructor.warnings'), result.warnings.length, 'warning');
        for (const entry of result.warnings) {
            const card = element('article', 'env-regex-result');
            card.append(
                element('code', 'env-regex-result__source', entry.source),
                element('p', '', t(`constructor.warning.${entry.code}`)),
            );
            section.append(card);
        }
        host.append(section);
    }

    if (result.errors.length) {
        const section = resultSection(t('constructor.errors'), result.errors.length, 'invalid');
        for (const entry of result.errors) {
            const card = element('article', 'env-regex-result');
            card.append(
                element('code', 'env-regex-result__source', entry.source),
                element('p', '', t(`constructor.error.${entry.code}`)),
            );
            section.append(card);
        }
        host.append(section);
    }

    if (result.omitted) host.append(element('p', 'env-regex-results__omitted', t('constructor.omitted', { count: result.omitted })));
    if (result.inputTruncated) host.append(element('p', 'env-regex-results__omitted', t('regex.inputTruncated')));
    if (!host.childElementCount) host.append(element('p', 'env-regex-results__empty', t('constructor.noResults')));
}

async function openRegexConstructor() {
    if (activePopup) return;
    const context = SillyTavern.getContext();
    const root = element('div', 'env-regex-dialog');
    root.dataset.channel = 'eyJhIjoiYWNlZW52dyIsInYiOiIyLjMuMCJ9';

    const heading = element('h3', 'env-regex-dialog__title', t('constructor.title'));
    heading.id = 'env_regex_constructor_title';
    const intro = element('p', 'env-regex-dialog__intro', t('constructor.intro'));
    intro.id = 'env_regex_constructor_intro';

    const language = element('div', 'env-regex-language');
    const languageLabel = element('span', 'env-regex-language__label', t('constructor.language'));
    languageLabel.id = 'env_regex_constructor_language_label';
    const languageOptions = element('div', 'env-regex-language__options');
    languageOptions.setAttribute('role', 'radiogroup');
    languageOptions.setAttribute('aria-labelledby', languageLabel.id);
    language.append(languageLabel, languageOptions);
    for (const [value, labelText] of [
        ['latin', t('constructor.latin')],
        ['cyrillic', t('constructor.cyrillic')],
    ]) {
        const label = element('label', 'env-regex-language__option');
        const input = element('input');
        input.type = 'radio';
        input.name = 'env_regex_constructor_language';
        input.value = value;
        input.checked = value === 'latin';
        label.append(input, element('span', '', labelText));
        languageOptions.append(label);
    }

    const editor = element('section', 'env-regex-editor');
    const editorHeader = element('div', 'env-regex-editor__header');
    const inputLabel = element('label', 'env-regex-editor__label', t('constructor.inputLabel'));
    inputLabel.htmlFor = 'env_regex_constructor_input';
    const tools = element('div', 'env-regex-editor__tools');
    const selectAll = iconButton('fa-solid fa-object-group', t('regex.selectAll'));
    const paste = iconButton('fa-solid fa-paste', t('regex.paste'));
    const deleteAll = iconButton('fa-solid fa-eraser', t('regex.deleteAll'), 'env-regex-editor__tool--danger');
    const maximize = iconButton('fa-solid fa-maximize', t('regex.maximize'), 'editor_maximize');
    maximize.dataset.for = 'env_regex_constructor_input';
    maximize.dataset.tab = 'true';
    tools.append(maximize, selectAll, paste, deleteAll);
    editorHeader.append(inputLabel, tools);

    const textarea = element('textarea', 'text_pole env-regex-editor__input');
    textarea.id = 'env_regex_constructor_input';
    textarea.name = 'env_regex_constructor_input';
    textarea.rows = 6;
    textarea.maxLength = REGEX_TOOL_LIMITS.maxInputLength;
    textarea.autocomplete = 'off';
    textarea.placeholder = t('constructor.placeholderLatin');
    textarea.setAttribute('aria-describedby', 'env_regex_constructor_intro env_regex_constructor_help');
    textarea.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    textarea.spellcheck = false;
    const help = element('p', 'env-regex-editor__help', t('constructor.help'));
    help.id = 'env_regex_constructor_help';
    editor.append(editorHeader, textarea, help);

    const status = element('div', 'env-regex-status', t('constructor.ready'));
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'env-regex-actions');
    const convert = element('button', 'menu_button env-regex-actions__check', t('constructor.convert'));
    convert.type = 'button';
    actions.append(convert);
    const results = element('div', 'env-regex-results');
    results.setAttribute('aria-label', t('constructor.results'));
    root.append(heading, intro, language, editor, actions, status, results);

    const includedSuggestions = new Set();
    const selectedLanguage = () => language.querySelector('input:checked')?.value || 'latin';
    const render = (focusValue = '', suggestionScrollTop = 0, suggestionsOpen = false) => {
        const result = constructRegexList(textarea.value, selectedLanguage(), [...includedSuggestions]);
        const availableSuggestions = new Map(result.suggestions.map(suggestion => [
            suggestion.value.toLocaleLowerCase('en-US'),
            suggestion.value,
        ]));
        const selectedKeys = [...includedSuggestions].map(value => value.toLocaleLowerCase('en-US'));
        includedSuggestions.clear();
        for (const key of selectedKeys) {
            const currentValue = availableSuggestions.get(key);
            if (currentValue) includedSuggestions.add(currentValue);
        }
        renderResults(
            results,
            status,
            result,
            includedSuggestions,
            (value, included, scrollTop) => {
                if (included) includedSuggestions.add(value);
                else includedSuggestions.delete(value);
                render(value, scrollTop, true);
            },
            suggestionsOpen,
        );
        const suggestionList = results.querySelector('.env-regex-suggestions');
        if (suggestionList) suggestionList.scrollTop = suggestionScrollTop;
        if (focusValue) {
            const nextCheckbox = [...results.querySelectorAll('.env-regex-suggestion input')]
                .find(input => input.value === focusValue);
            nextCheckbox?.focus();
        }
    };

    const run = () => {
        if (!textarea.value.trim()) {
            results.replaceChildren();
            status.textContent = t('constructor.emptyInput');
            textarea.focus();
            return;
        }
        includedSuggestions.clear();
        render();
    };

    languageOptions.addEventListener('change', event => {
        if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'radio') return;
        textarea.placeholder = t(event.target.value === 'cyrillic'
            ? 'constructor.placeholderCyrillic'
            : 'constructor.placeholderLatin');
        includedSuggestions.clear();
        results.replaceChildren();
        status.textContent = t('constructor.ready');
    });

    convert.addEventListener('click', run);
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
        status.textContent = t('constructor.ready');
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

export function initRegexConstructor() {
    const nextLauncher = document.getElementById('env_open_regex_constructor');
    if (!nextLauncher || launcher === nextLauncher) return;
    destroyRegexConstructor();
    launcher = nextLauncher;
    launchHandler = () => {
        void openRegexConstructor().catch(error => log.error('Failed to open regex constructor:', error));
    };
    launcher.addEventListener('click', launchHandler);
}

export function destroyRegexConstructor() {
    if (launcher && launchHandler) launcher.removeEventListener('click', launchHandler);
    launcher = null;
    launchHandler = null;
    if (activePopup) {
        const { POPUP_RESULT } = SillyTavern.getContext();
        void activePopup.complete(POPUP_RESULT.CANCELLED);
    }
}
