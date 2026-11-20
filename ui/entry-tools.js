import { testEntryText } from '../core/entry-tools.js';
import { t } from '../i18n.js';
import { getWIGlobalSettings } from '../core/matching.js';

export function initEntryTools() {
    const id = name => document.getElementById(`env-${name}`);
    const tools = id('entry-tools'), books = id('lab-book');
    const text = id('lab-text'), result = id('lab-result'), note = id('lab-note'), test = id('lab-test');
    const prev = id('lab-prev'), next = id('lab-next');
    let data, request = 0;
    let run = 0, matches = [], skipped = 0, page = 0;
    const pageSize = 12;
    function clearTest() {
        run++; matches = []; skipped = page = 0;
        result.textContent = '';
        prev.parentElement.hidden = true;
        test.disabled = !data || !text.value.trim();
    }
    async function load(updated) {
        const gen = ++request;
        data = null;
        clearTest();
        note.textContent = '';
        if (!books.value) return;
        note.textContent = t('lab.loading');
        try {
            const book = updated ?? await SillyTavern.getContext().loadWorldInfo(books.value);
            if (gen !== request) return;
            if (!book?.entries) throw new Error();
            data = book.entries;
            clearTest();
            note.textContent = '';
        } catch { if (gen === request) note.textContent = t('lab.error'); }
    }
    function reset() {
        request++;
        data = null;
        books.replaceChildren();
        text.value = '';
        clearTest();
        note.textContent = '';
    }
    tools.ontoggle = () => {
        reset();
        if (!tools.open) return;
        const names = SillyTavern.getContext().getWorldInfoNames();
        books.add(new Option(t(names.length ? 'lab.choose' : 'lab.noBooks'), ''));
        for (const name of names) books.add(new Option(name, name));
        if (names.length === 1) {
            books.value = names[0];
            void load();
        }
    };
    books.onchange = () => { void load(); };
    text.oninput = clearTest;
    function showPage() {
        const lines = [t('lab.matches', { count: matches.length })];
        if (skipped) lines.push(t('lab.skipped', { count: skipped }));
        for (const { e, primary, secondary } of matches.slice(page * pageSize, (page + 1) * pageSize)) {
            lines.push('', `#${e.uid} ${String(e.comment || e.key?.[0] || '').slice(0, 160)}`, t('lab.primary', { keys: primary.join(', ') }));
            if (secondary.length) lines.push(t('lab.secondary', { keys: secondary.join(', ') }));
        }
        result.textContent = lines.join('\n');
        prev.parentElement.hidden = matches.length <= pageSize;
        prev.disabled = page === 0;
        next.disabled = (page + 1) * pageSize >= matches.length;
    }
    prev.onclick = () => { if (page > 0) { page--; showPage(); } };
    next.onclick = () => { if (!next.disabled) { page++; showPage(); } };
    test.onclick = async () => {
        if (!data || !text.value.trim()) return;
        clearTest();
        const gen = run, sample = text.value, settings = getWIGlobalSettings();
        test.disabled = true;
        result.textContent = t('lab.testing');
        let since = performance.now();
        for (const uid in data) {
            if (!Object.hasOwn(data, uid)) continue;
            const e = data[uid];
            if (e && !e.disable) {
                const r = testEntryText(e, sample, settings);
                if (r.issue) skipped++;
                else if (r.satisfied) matches.push({ e, primary: r.primary, secondary: r.secondary });
            }
            if (performance.now() - since >= 8) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (gen !== run) return;
                since = performance.now();
            }
        }
        showPage();
        test.disabled = false;
    };
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.CHAT_CHANGED, () => { tools.open = false; reset(); });
    eventSource.on(event_types.WORLDINFO_UPDATED, (name, updated) => { if (tools.open && books.value === name) void load(updated); });
}
