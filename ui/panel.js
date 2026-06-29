// ⊹ ACE ENTRY TRACK ⊹ — ui/panel.js
// Side panel: context preview, selective-logic display, persistent WI
// highlighting, bidirectional cross-highlighting, custom tooltips,
// re-evaluate, performance warning.

import { ICONS } from '../icons.js';
import { escapeHtml } from '../utils/html.js';
import { entryKey } from '../utils/ids.js';
import { state, sortEntries, cycleSortBy, toggleSortOrder, applyFilters, computeBudgetOverflow, getActivationHistory } from '../core/state.js';
import { TRIGGER_TYPES, SOURCE_COLORS, SORT_OPTIONS, POSITION_NAMES, ROLE_NAMES, LOGIC_NAMES } from '../core/processor.js';
import { closePanel } from './trigger-button.js';
import { resolveKeyMacros, parseRegexKey, buildAllSources, getWIGlobalSettings } from '../core/matching.js';
import { Category } from '../core/self-test.js';

let _getSettings;
let _saveFn;
let _reEvaluateFn; // injected from tracker.js to avoid circular import

// Document-level listener kept as a named ref so setEnabled(false) can
// detach it cleanly (re-attached on re-init).
const _escHandler = (e) => {
    if (e.key === 'Escape' && state.panelOpen) closePanel();
};

// Tap-away dismissal for the highlight tooltip. On touch devices the
// mouseout event that would normally hide the tooltip never fires — the
// synthesized mouseover on the tap persists until another element gets
// hovered, which on mobile essentially never happens. This listener
// hides the tooltip when the user taps anywhere that isn't a highlight
// mark. The tooltip itself has `pointer-events: none` so taps land on
// whatever sits underneath it.
const _tapAwayHandler = (e) => {
    const tip = document.getElementById('env_tooltip');
    if (!tip || tip.style.display === 'none') return;
    if (e.target.closest('.env-highlight')) return;
    hideTooltip();
    if (_hoveredMark) { clearAccentedEntries(); _hoveredMark = null; }
};
let _escAttached = false;

// Hover bookkeeping lifted to module scope so renderPanel() can null
// the references after panel.innerHTML overwrite (otherwise the closure
// retains orphaned DOM subtrees).
let _hoveredEntry = null;
let _hoveredMark = null;

export function initPanel(getSettingsFn, saveFn, reEvaluateFn) {
    _getSettings = getSettingsFn;
    _saveFn = saveFn;
    _reEvaluateFn = reEvaluateFn;
    createPanel();
    createTooltip();
    attachPanelGlobals();
    try { applyPanelLayout(_getSettings?.().panelLayout); } catch { /* non-fatal */ }
}

export function attachPanelGlobals() {
    if (_escAttached) return;
    document.addEventListener('keydown', _escHandler);
    // pointerdown fires before click and works uniformly across mouse,
    // touch and pen. Capture phase so we see it even if downstream
    // handlers stopPropagation().
    document.addEventListener('pointerdown', _tapAwayHandler, true);
    _escAttached = true;
}

/** Detach document-level listeners. Used when the extension is disabled. */
export function detachPanelGlobals() {
    if (!_escAttached) return;
    document.removeEventListener('keydown', _escHandler);
    document.removeEventListener('pointerdown', _tapAwayHandler, true);
    _escAttached = false;
}

// ── Layout Mode ──

// Local mirror of index.js PANEL_LAYOUTS — avoids an index↔panel import cycle.
const PANEL_LAYOUTS = ['solid', 'compact'];

// Reflect layout onto the panel root as a data-attribute for CSS.
// Allowlist-validated so a poisoned setting can't inject an arbitrary value.
export function applyPanelLayout(layout) {
    const panel = document.getElementById('env_tracker_panel');
    if (!panel) return;
    const safe = PANEL_LAYOUTS.includes(layout) ? layout : 'solid';
    panel.dataset.envLayout = safe;
}

// ── Panel Creation ──

function createPanel() {
    if (document.getElementById('env_tracker_panel')) return;

    const panel = document.createElement('div');
    panel.id = 'env_tracker_panel';
    panel.className = 'env-panel';
    panel.innerHTML = '<div class="env-panel__body"><div class="env-panel__empty">Send a message to see active entries</div></div>';

    // ── Click delegation ──
    panel.addEventListener('click', (e) => {
        if (e.target.closest('.env-panel__close')) { closePanel(); return; }
        if (e.target.closest('.env-panel__refresh')) { _reEvaluateFn?.(); return; }
        if (e.target.closest('.env-toolbar__expand-all')) { expandAll(); renderPanel(); return; }
        if (e.target.closest('.env-toolbar__collapse-all')) { collapseAll(); renderPanel(); return; }
        if (e.target.closest('.env-sort__field')) { cycleSortBy(_getSettings, _saveFn); renderPanel(); return; }
        if (e.target.closest('.env-sort__dir')) { toggleSortOrder(_getSettings, _saveFn); renderPanel(); return; }
        if (e.target.closest('.env-context-toggle')) { state.contextPreviewOpen = !state.contextPreviewOpen; renderPanel(); return; }

        // Context highlight click → toggle key filter.
        // Keys are JSON-encoded so commas inside keys survive round-trip.
        const highlight = e.target.closest('.env-highlight');
        if (highlight) {
            const keysJson = highlight.dataset.keys;
            if (keysJson) {
                let firstKey = null;
                try {
                    const parsed = JSON.parse(keysJson);
                    if (Array.isArray(parsed) && typeof parsed[0] === 'string') firstKey = parsed[0];
                } catch { /* malformed */ }
                if (firstKey !== null) {
                    state.highlightKeyFilter = (state.highlightKeyFilter === firstKey) ? null : firstKey;
                    renderPanel();
                }
            }
            return;
        }

        const srcHeader = e.target.closest('.env-ctx__source-header');
        if (srcHeader) {
            const label = srcHeader.dataset.source;
            if (label) {
                if (state.contextSourcesOpen.has(label)) state.contextSourcesOpen.delete(label);
                else state.contextSourcesOpen.add(label);
                renderPanel();
            }
            return;
        }

        const filterChip = e.target.closest('.env-filter__chip');
        if (filterChip) {
            const type = filterChip.dataset.trigger;
            if (type) {
                if (state.triggerFilter.has(type)) state.triggerFilter.delete(type);
                else state.triggerFilter.add(type);
                renderPanel();
            }
            return;
        }
        if (e.target.closest('.env-filter__clear')) { state.triggerFilter.clear(); state.searchQuery = ''; state.highlightKeyFilter = null; renderPanel(); return; }
        if (e.target.closest('.env-key-filter__clear')) { state.highlightKeyFilter = null; renderPanel(); return; }

        const ctxShowAll = e.target.closest('.env-ctx__show-all');
        if (ctxShowAll) {
            e.stopPropagation();
            const block = ctxShowAll.parentElement;
            const preview = block.querySelector('.env-ctx__preview-text');
            const full = block.querySelector('.env-ctx__full-text');
            if (preview && full) {
                preview.style.display = 'none';
                full.style.display = '';
                ctxShowAll.remove();
            }
            return;
        }

        const expandBtn = e.target.closest('.env-detail__content-expand');
        if (expandBtn) {
            e.stopPropagation();
            // data-key is composite world::uid (bare uid collides across books).
            const key = expandBtn.dataset.key;
            const entryData = state.currentEntries.find(en => entryKey(en) === key);
            if (entryData?.content) {
                const textEl = expandBtn.parentElement.querySelector('.env-detail__content-text');
                if (textEl) {
                    textEl.textContent = entryData.content;
                    expandBtn.remove();
                }
            }
            return;
        }

        // Key dropdown toggle; stopPropagation so the entry stays open.
        const keysToggle = e.target.closest('.env-keys-toggle');
        if (keysToggle) {
            e.stopPropagation();
            const section = keysToggle.closest('.env-keys');
            if (section) {
                const open = section.classList.toggle('env-keys--open');
                const chevron = keysToggle.querySelector('.env-keys-toggle__chevron');
                if (chevron) chevron.innerHTML = open ? ICONS.chevron_up : ICONS.chevron_down;
            }
            return;
        }


        // Entry expand/collapse — no re-render, just toggle + lazy detail inject.
        const entryEl = e.target.closest('.env-entry');
        if (!entryEl || entryEl.classList.contains('env-entry--removed')) return;
        const key = entryEl.dataset.key;
        if (!key) return;
        if (state.expandedUids.has(key)) {
            state.expandedUids.delete(key);
            entryEl.classList.remove('env-entry--open');
        } else {
            state.expandedUids.add(key);
            entryEl.classList.add('env-entry--open');
            if (!entryEl.querySelector('.env-detail')) {
                const entryData = state.currentEntries.find(en => entryKey(en) === key);
                if (entryData) {
                    entryEl.insertAdjacentHTML('beforeend', renderEntryDetail(entryData));
                }
            }
        }
        const chevron = entryEl.querySelector('.env-entry__chevron');
        if (chevron) chevron.innerHTML = state.expandedUids.has(key) ? ICONS.chevron_up : ICONS.chevron_down;
    });

    // ── Cross-highlighting via mouseover/mouseout ──
    // mouseenter/mouseleave don't bubble; we track the active element and
    // fire enter/leave logic only when relatedTarget exits the region.
    panel.addEventListener('mouseover', (e) => {
        const entry = e.target.closest('.env-entry[data-key]');
        if (entry && entry !== _hoveredEntry && !entry.classList.contains('env-entry--removed')) {
            if (_hoveredEntry) { clearPreviewHighlights(); _hoveredEntry.classList.remove('env-entry--hover-accent'); }
            _hoveredEntry = entry;
            highlightKeysInPreview(entry.dataset.key);
            entry.classList.add('env-entry--hover-accent');
        }
        const mark = e.target.closest('.env-highlight');
        if (mark && mark !== _hoveredMark) {
            if (_hoveredMark) { clearAccentedEntries(); hideTooltip(); }
            _hoveredMark = mark;
            // data-keys-refs is a JSON array of composite world::uid keys.
            // JSON survives commas inside world names (legacy comma-split broke).
            let keys = [];
            try {
                const parsed = JSON.parse(mark.dataset.keysRefs || '[]');
                if (Array.isArray(parsed)) keys = parsed.filter(k => typeof k === 'string');
            } catch { /* malformed */ }
            accentEntriesByUids(keys);
            showTooltip(mark, keys);
        }
    });

    panel.addEventListener('mouseout', (e) => {
        const related = e.relatedTarget;
        if (_hoveredEntry && (!related || !_hoveredEntry.contains(related))) {
            clearPreviewHighlights();
            _hoveredEntry.classList.remove('env-entry--hover-accent');
            _hoveredEntry = null;
        }
        if (_hoveredMark && (!related || !_hoveredMark.contains(related))) {
            clearAccentedEntries();
            hideTooltip();
            _hoveredMark = null;
        }
    });

    panel.addEventListener('input', (e) => {
        if (e.target.closest('.env-search__input')) {
            state.searchQuery = e.target.value.trim();
            clearTimeout(panel._searchTimeout);
            panel._searchTimeout = setTimeout(() => renderPanel(), 150);
        }
    });

    document.body.appendChild(panel);
}

// ── Tooltip ──

function createTooltip() {
    if (document.getElementById('env_tooltip')) return;
    const tip = document.createElement('div');
    tip.id = 'env_tooltip';
    document.body.appendChild(tip);
}

function showTooltip(mark, keys) {
    const tip = document.getElementById('env_tooltip');
    if (!tip) return;

    // keys are composite world::uid identifiers.
    const keySet = new Set(keys);
    const entries = state.currentEntries.filter(e => keySet.has(entryKey(e)));
    if (entries.length === 0) return;

    const section = mark.closest('.env-ctx__section');
    const sourceLabel = section?.querySelector('.env-ctx__source-header')?.dataset?.source || '';
    const sc = sourceLabel ? (SOURCE_COLORS[sourceLabel] || { label: sourceLabel }) : null;

    let html = '';
    for (const entry of entries) {
        const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
        html += `<div class="env-tip__entry">`;
        html += `<span class="env-tip__icon" style="color:${tt.color}">${tt.icon}</span>`;
        html += `<span class="env-tip__name">${escapeHtml(entry.title)}</span>`;
        html += `<span class="env-tip__type" style="color:${tt.color}">${tt.label}</span>`;
        if (sc) html += `<span class="env-tip__source" style="color:${sc.color || '#64748b'}">${escapeHtml(sc.label || sourceLabel)}</span>`;
        html += `</div>`;
    }
    tip.innerHTML = html;
    tip.style.display = 'block';

    // Position below the mark, clamped to viewport.
    const rect = mark.getBoundingClientRect();
    const tipW = tip.offsetWidth;
    const tipH = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tipW / 2;
    let top = rect.bottom + 6;

    if (left < 8) left = 8;
    if (left + tipW > window.innerWidth - 8) left = window.innerWidth - tipW - 8;
    if (top + tipH > window.innerHeight - 8) top = rect.top - tipH - 6;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

function hideTooltip() {
    const tip = document.getElementById('env_tooltip');
    if (tip) tip.style.display = 'none';
}

// ── Expand / Collapse All ──

function expandAll() {
    for (const entry of state.currentEntries) state.expandedUids.add(entryKey(entry));
}
function collapseAll() {
    state.expandedUids.clear();
}

// ── WI Editor Highlighting ──

/**
 * Locate a row in ST's World Info editor by uid. ST uses `[uid]` or
 * `[data-uid]` depending on version. uid is coerced numeric upstream so
 * safe to interpolate into a selector. Returns null if not rendered.
 */
function findWIEntry(uid) {
    // ST uids are non-negative integers (clamped via _toNum upstream).
    if (!/^\d+$/.test(String(uid))) return null;
    const safeUid = String(uid);
    return document.querySelector(
        `#world_popup_entries_list [uid="${safeUid}"], #world_popup_entries_list [data-uid="${safeUid}"]`,
    );
}

function applyWIHighlights(entries) {
    document.querySelectorAll('.env-wi-active').forEach(el => el.classList.remove('env-wi-active'));
    // ST's WI editor shows one book at a time and uses bare-uid attrs.
    // If two attached books share a uid, an inactive same-uid row in the
    // open book may briefly accent — accepted UX cost of ST's DOM model.
    const uids = new Set(entries.map(e => String(e.uid)));
    for (const uid of uids) {
        const el = findWIEntry(uid);
        if (el) el.classList.add('env-wi-active');
    }
}

// ── Cross-Highlighting ──

/** Highlight marks whose refs contain the hovered entry's composite key. */
function highlightKeysInPreview(key) {
    const panel = document.getElementById('env_tracker_panel');
    if (!panel) return;
    panel.querySelectorAll('.env-highlight').forEach(mark => {
        let refs = [];
        try {
            const parsed = JSON.parse(mark.dataset.keysRefs || '[]');
            if (Array.isArray(parsed)) refs = parsed;
        } catch { /* malformed */ }
        const matches = refs.includes(key);
        mark.classList.toggle('env-highlight--active', matches);
        mark.classList.toggle('env-highlight--dimmed', !matches);
    });
}

function clearPreviewHighlights() {
    const panel = document.getElementById('env_tracker_panel');
    if (!panel) return;
    panel.querySelectorAll('.env-highlight').forEach(mark => {
        mark.classList.remove('env-highlight--active', 'env-highlight--dimmed');
    });
}

/**
 * Accent matching entry cards in our panel and rows in ST's WI editor.
 * keys are composite world::uid; ST's editor needs bare uid extracted.
 */
function accentEntriesByUids(keys) {
    const panel = document.getElementById('env_tracker_panel');
    if (panel) {
        for (const key of keys) {
            // dataset comparison sidesteps CSS attr-selector quoting issues
            // when keys contain special characters.
            const cards = panel.querySelectorAll('.env-entry[data-key]');
            cards.forEach(card => {
                if (card.dataset.key === key) card.classList.add('env-entry--hover-accent');
            });
        }
    }
    for (const key of keys) {
        const idx = key.lastIndexOf('::');
        const uid = idx >= 0 ? key.slice(idx + 2) : key;
        const el = findWIEntry(uid);
        if (el) el.classList.add('env-wi-accent');
    }
}

function clearAccentedEntries() {
    const panel = document.getElementById('env_tracker_panel');
    if (panel) {
        panel.querySelectorAll('.env-entry--hover-accent').forEach(el => el.classList.remove('env-entry--hover-accent'));
    }
    document.querySelectorAll('.env-wi-accent').forEach(el => el.classList.remove('env-wi-accent'));
}

// ── Context Preview ──

function buildContextPreview(entries) {
    const allSources = buildAllSources();
    if (allSources.length === 0) return '<span class="env-ctx__empty">No scannable context available</span>';

    // ref = composite world::uid (bare uid collides across books).
    const keyEntryMap = [];
    const potentialKeyMap = [];

    for (const entry of entries) {
        const mk = entry.matchedKeys;
        if (!mk) continue;
        const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
        const ref = entryKey(entry);
        for (const m of [...(mk.primary || []), ...(mk.secondary || [])]) {
            keyEntryMap.push({ key: m.key, ref, color: tt.color, title: entry.title, source: m.source });
        }
        for (const m of (mk.potential || [])) {
            potentialKeyMap.push({ key: m.key, ref, color: tt.color, title: entry.title, source: m.source });
        }
    }

    const wiSettings = getWIGlobalSettings();
    const scanDepth = wiSettings.scanDepth || 10;

    let html = '';

    for (const src of allSources) {
        const sc = SOURCE_COLORS[src.label] || { color: '#64748b', label: src.label };
        const keysForSource = keyEntryMap.filter(k => k.source === src.label);
        const potentialForSource = potentialKeyMap.filter(k => k.source === src.label);
        const hitCount = keysForSource.length;
        const potentialCount = potentialForSource.length;

        if (!src.text && hitCount === 0 && potentialCount === 0) continue;

        const isOpen = state.contextSourcesOpen.has(src.label);
        const chevron = isOpen ? ICONS.chevron_up : ICONS.chevron_down;

        html += `<div class="env-ctx__section${isOpen ? ' env-ctx__section--open' : ''}">`;
        html += `<div class="env-ctx__source-header" data-source="${escapeHtml(src.label)}" role="button">`;
        html += `<span class="env-ctx__source-label" style="--source-color:${sc.color}">${escapeHtml(sc.label)}</span>`;
        if (hitCount > 0) html += `<span class="env-ctx__source-hits" style="color:${sc.color}">${hitCount} hit${hitCount !== 1 ? 's' : ''}</span>`;
        if (potentialCount > 0) html += `<span class="env-ctx__source-potential-count">${potentialCount} potential</span>`;
        html += `<span class="env-ctx__source-chevron">${chevron}</span>`;
        html += `</div>`;

        if (isOpen) {
            html += `<div class="env-ctx__source-body">`;
            if (src.label === 'chat') {
                const ctx = SillyTavern.getContext();
                const chat = ctx.chat || [];
                const recent = chat.slice(-scanDepth);
                if (recent.length === 0) {
                    html += `<span class="env-ctx__empty">No chat messages</span>`;
                } else {
                    // Cap per-message preview for huge messages (RP logs, pasted articles).
                    const MSG_PREVIEW_LEN = 2000;
                    for (const msg of recent) {
                        const name = msg.name || (msg.is_user ? 'You' : 'AI');
                        const isUser = !!msg.is_user;
                        const nameClass = isUser ? 'env-ctx__name--user' : 'env-ctx__name--char';
                        let body = msg.mes || '';
                        const truncated = body.length > MSG_PREVIEW_LEN;
                        if (truncated) body = body.slice(0, MSG_PREVIEW_LEN);
                        html += `<div class="env-ctx__msg"><span class="env-ctx__name ${nameClass}">${escapeHtml(name)}</span>`;
                        html += `<span class="env-ctx__text">${highlightTextWithKeys(body, keysForSource, potentialForSource)}${truncated ? '…' : ''}</span></div>`;
                    }
                }
            } else {
                const raw = src.text || '';
                const CTX_PREVIEW_LEN = 600;
                if (raw.length > CTX_PREVIEW_LEN) {
                    html += `<div class="env-ctx__block">`;
                    html += `<span class="env-ctx__preview-text">${highlightTextWithKeys(raw.substring(0, CTX_PREVIEW_LEN), keysForSource, potentialForSource)}…</span>`;
                    html += `<button class="env-ctx__show-all" data-source="${escapeHtml(src.label)}">Show all (${raw.length} chars)</button>`;
                    html += `<span class="env-ctx__full-text" style="display:none">${highlightTextWithKeys(raw, keysForSource, potentialForSource)}</span>`;
                    html += `</div>`;
                } else {
                    html += `<div class="env-ctx__block">${highlightTextWithKeys(raw, keysForSource, potentialForSource)}</div>`;
                }
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    return html;
}

// ── Text Highlighting ──

function highlightTextWithKeys(text, keyEntryMap, potentialKeyMap = []) {
    if (!text || (keyEntryMap.length === 0 && potentialKeyMap.length === 0)) return escapeHtml(text);

    const positions = [];

    for (const { key, ref, color, title } of keyEntryMap) {
        findKeyPositions(text, key, (start, end) => {
            positions.push({ start, end, ref, color, title, key, type: 'actual' });
        });
    }
    for (const { key, ref, color, title } of potentialKeyMap) {
        findKeyPositions(text, key, (start, end) => {
            positions.push({ start, end, ref, color, title, key, type: 'potential' });
        });
    }

    if (positions.length === 0) return escapeHtml(text);

    // Sort actual-before-potential so real matches win during overlap merge.
    positions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start) || (a.type === 'actual' ? -1 : 1));

    const merged = [];
    let cur = { ...positions[0], refs: [positions[0].ref], colors: [positions[0].color], titles: [positions[0].title], keys: [positions[0].key], types: [positions[0].type] };
    for (let i = 1; i < positions.length; i++) {
        const p = positions[i];
        if (p.start < cur.end) {
            cur.end = Math.max(cur.end, p.end);
            if (!cur.refs.includes(p.ref)) { cur.refs.push(p.ref); cur.colors.push(p.color); cur.titles.push(p.title); }
            if (!cur.keys.includes(p.key)) cur.keys.push(p.key);
            if (!cur.types.includes(p.type)) cur.types.push(p.type);
        } else {
            merged.push(cur);
            cur = { ...p, refs: [p.ref], colors: [p.color], titles: [p.title], keys: [p.key], types: [p.type] };
        }
    }
    merged.push(cur);

    let html = '';
    let last = 0;
    for (const m of merged) {
        if (m.start > last) html += escapeHtml(text.substring(last, m.start));
        const highlighted = text.substring(m.start, m.end);
        // JSON encoding survives commas in worlds and any punctuation in keys.
        const refsStr = JSON.stringify(m.refs);
        const keyStr = JSON.stringify(m.keys);
        const color = m.colors[0];
        const isActual = m.types.includes('actual');
        const isPotentialOnly = !isActual;
        const isFiltered = state.highlightKeyFilter && m.keys.includes(state.highlightKeyFilter);
        let hlClass = isPotentialOnly ? 'env-highlight env-highlight--potential' : 'env-highlight';
        if (isFiltered) hlClass += ' env-highlight--filtered';
        html += `<mark class="${hlClass}" data-keys-refs="${escapeHtml(refsStr)}" data-keys="${escapeHtml(keyStr)}" style="--hl-color:${color}">${escapeHtml(highlighted)}</mark>`;
        last = m.end;
    }
    if (last < text.length) html += escapeHtml(text.substring(last));
    return html;
}

/** Find all positions of a key (regex or literal) in text. */
function findKeyPositions(text, key, callback) {
    const resolvedKey = resolveKeyMacros(key);
    if (!resolvedKey || !resolvedKey.trim()) return;
    const trimmed = resolvedKey.trim();

    // Caps bound worst-case time for catastrophic-backtracking or
    // match-every-position patterns from malicious lorebooks. Zero-width
    // matches get a much tighter cap because they can produce one <mark>
    // tag per character, freezing the renderer with thousands of nodes.
    const MAX_MATCHES = 1000;
    const MAX_ZERO_WIDTH = 50;

    const regexKey = parseRegexKey(trimmed);
    if (regexKey) {
        try {
            const globalRegex = new RegExp(regexKey.source, regexKey.flags.includes('g') ? regexKey.flags : regexKey.flags + 'g');
            let match;
            let count = 0;
            let zeroWidthCount = 0;
            while ((match = globalRegex.exec(text)) !== null) {
                callback(match.index, match.index + match[0].length);
                if (match[0].length === 0) {
                    globalRegex.lastIndex++;
                    if (++zeroWidthCount >= MAX_ZERO_WIDTH) break;
                }
                if (++count >= MAX_MATCHES) break;
            }
        } catch { /* skip */ }
    } else {
        const lower = text.toLowerCase();
        const needle = trimmed.toLowerCase();
        if (!needle) return;
        let idx = 0;
        let count = 0;
        while ((idx = lower.indexOf(needle, idx)) !== -1) {
            callback(idx, idx + trimmed.length);
            // +1 preserves overlapping-match semantics ("aa" in "aaaa" → 3 hits).
            idx += 1;
            if (++count >= MAX_MATCHES) break;
        }
    }
}

// ── Sparkline ──

function renderSparkline(key) {
    const history = getActivationHistory(key);
    if (history.length < 2) return '';
    let dots = '';
    for (const active of history) {
        dots += `<span class="env-spark__dot ${active ? 'env-spark__dot--on' : 'env-spark__dot--off'}"></span>`;
    }
    return `<span class="env-spark" title="Activation history (last ${history.length} gens)">${dots}</span>`;
}

// ── Main Render ──

export function renderPanel() {
    const panel = document.getElementById('env_tracker_panel');
    if (!panel || !_getSettings) return;

    const settings = _getSettings();
    const monitored = Array.isArray(settings.monitoredLorebooks) ? settings.monitoredLorebooks : [];

    let entries = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world))
        : state.currentEntries;

    const removed = monitored.length > 0
        ? state.removedEntries.filter(e => monitored.includes(e.world))
        : state.removedEntries;

    const triggerCounts = {};
    for (const e of entries) triggerCounts[e.triggerType] = (triggerCounts[e.triggerType] || 0) + 1;

    entries = applyFilters(entries);

    const totalAll = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world)).length
        : state.currentEntries.length;

    const totalTokens = entries.reduce((sum, e) => sum + e.estimatedTokens, 0);
    const budget = settings.tokenBudgetOverride || 0;
    const currentSort = settings.sortBy || 'order';
    const currentDir = settings.sortOrder || 'asc';
    const sortOpt = SORT_OPTIONS[currentSort] || SORT_OPTIONS.order;

    let html = '';

    // Header
    html += `<div class="env-panel__header">`;
    html += `<span class="env-panel__title">${ICONS.tracker} ENTRY TRACK</span>`;
    html += `<div class="env-panel__header-actions">`;
    html += `<span class="env-panel__stats">${totalAll} entries · ~${totalTokens} tok</span>`;
    if (state.newUids.size > 0 || removed.length > 0) {
        html += `<span class="env-diff-summary">`;
        if (state.newUids.size > 0) html += `<span class="env-diff-new">+${state.newUids.size}</span>`;
        if (removed.length > 0) html += `<span class="env-diff-removed">−${removed.length}</span>`;
        html += `</span>`;
    }
    html += `<button class="env-panel__refresh" title="Re-evaluate against current context">${ICONS.refresh}</button>`;
    html += `<button class="env-panel__close" title="Close panel (Esc)">✕</button>`;
    html += `</div></div>`;

    // Performance warning
    if (state.lastProcessingMs !== null && state.lastProcessingMs > 500) {
        html += `<div class="env-perf-warning">${ICONS.warning} Processing took ${state.lastProcessingMs}ms — large lorebooks may cause slowdowns</div>`;
    }

    html += `<div class="env-panel__body">`;

    if (totalAll === 0 && removed.length === 0) {
        html += `<div class="env-panel__empty">${ICONS.empty} No active World Info entries yet.<br><small>Send a message to trigger lorebook entries.</small></div>`;
        html += `</div>`;
        panel.innerHTML = html;
        // Drop hover refs — the elements they pointed to were just detached.
        // Also hide the tooltip: if a highlight-tap triggered this render,
        // the mark it pointed at is now gone but the tooltip would linger
        // (no mouseout fires on touch).
        _hoveredEntry = null;
        _hoveredMark = null;
        hideTooltip();
        if (state.panelOpen) applyWIHighlights([]);
        return;
    }

    // Sort + budget once; reused below for the overflow set.
    const allSorted = budget > 0 ? sortEntries(entries, _getSettings) : null;
    const budgetResult = budget > 0 ? computeBudgetOverflow(allSorted, budget) : null;

    // Budget bar + stacked simulator.
    if (budget > 0 && budgetResult) {
        const { withinBudget: budgetIn, overflow: budgetOut, budgetedTokens, bypassTokens } = budgetResult;
        // OVER decision based on budgeted tokens (bypass is free pass).
        const overBudget = budgetedTokens > budget;
        const pct = Math.min(100, Math.round((budgetedTokens / budget) * 100));
        const barClass = overBudget ? 'env-budget--over' : (pct >= 80 ? 'env-budget--warn' : '');

        html += `<div class="env-budget ${barClass}"><div class="env-budget__label">`;
        html += `<span>~${budgetedTokens} / ${budget} tok</span>`;
        if (bypassTokens > 0) html += ` <span class="env-budget__bypass-tokens">+${bypassTokens} bypass</span>`;
        if (overBudget) html += ` <span class="env-budget__alert">${ICONS.warning} OVER BUDGET</span>`;
        html += `</div>`;

        const bypassEntries = budgetIn.filter(e => e.ignoreBudget);
        const budgetedEntries = [...budgetIn.filter(e => !e.ignoreBudget), ...budgetOut];

        if (bypassEntries.length > 0) {
            html += `<div class="env-budget__bypass-label">Bypass budget: ~${bypassTokens} tok (${bypassEntries.length} entries — included unconditionally, not counted against cap)</div>`;
        }

        html += `<div class="env-budget__stacked">`;
        for (const entry of budgetedEntries) {
            const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
            const segPct = Math.max(1, (entry.estimatedTokens / budget) * 100);
            const isOver = budgetOut.includes(entry);
            const segClass = isOver ? 'env-budget__seg--over' : '';
            const title = `${escapeHtml(entry.title)} — ${entry.estimatedTokens}t`;
            html += `<div class="env-budget__seg ${segClass}" style="width:${segPct}%;background:${tt.color}" title="${title}"></div>`;
        }
        html += `</div>`;
        html += `<div class="env-budget__track"><div class="env-budget__fill" style="width:${pct}%"></div></div>`;
        html += `</div>`;
    }

    // Context preview
    const ctxOpen = state.contextPreviewOpen;
    html += `<div class="env-context">`;
    html += `<button class="env-context-toggle"><span class="env-context-toggle__icon">${ICONS.context}</span><span>Context Preview</span><span class="env-context-toggle__arrow">${ctxOpen ? ICONS.chevron_up : ICONS.chevron_down}</span></button>`;
    if (ctxOpen) html += `<div class="env-ctx__body">${buildContextPreview(entries)}</div>`;
    html += `</div>`;

    // Toolbar
    html += `<div class="env-toolbar">`;
    html += `<input class="env-search__input" type="text" placeholder="Filter entries…" value="${escapeHtml(state.searchQuery)}" />`;
    html += `<button class="env-sort__field" title="Cycle sort field"><span class="env-sort__icon">${sortOpt.icon}</span><span class="env-sort__label">${sortOpt.label}</span></button>`;
    html += `<button class="env-sort__dir" title="Toggle direction">${currentDir === 'asc' ? ICONS.chevron_up : ICONS.chevron_down}</button>`;
    html += `<button class="env-toolbar__expand-all" title="Expand all">${ICONS.expand}</button>`;
    html += `<button class="env-toolbar__collapse-all" title="Collapse all">${ICONS.collapse}</button>`;
    html += `</div>`;

    // Filter chips
    const hasActiveFilters = state.triggerFilter.size > 0 || state.searchQuery || state.highlightKeyFilter;
    const presentTypes = Object.keys(triggerCounts).sort();
    if (presentTypes.length > 0) {
        html += `<div class="env-filter">`;
        for (const type of presentTypes) {
            const tt = TRIGGER_TYPES[type] || TRIGGER_TYPES.normal;
            const isActive = state.triggerFilter.has(type);
            html += `<button class="env-filter__chip${isActive ? ' env-filter__chip--active' : ''}" data-trigger="${type}" style="--chip-color:${tt.color}" title="${escapeHtml(tt.desc)}"><span class="env-filter__chip-icon">${tt.icon}</span><span class="env-filter__chip-label">${escapeHtml(tt.label)}</span><span class="env-filter__chip-count">${triggerCounts[type]}</span></button>`;
        }
        if (hasActiveFilters) html += `<button class="env-filter__clear" title="Clear all filters">✕</button>`;
        html += `</div>`;
    }

    if (state.highlightKeyFilter) {
        html += `<div class="env-key-filter"><span class="env-key-filter__label">Key:</span><span class="env-key-filter__value">${escapeHtml(state.highlightKeyFilter)}</span><button class="env-key-filter__clear" title="Clear key filter">✕</button></div>`;
    }

    // Composite-key set so multi-book overflows don't collide on bare uid.
    // Reuses the budgetResult computed above — no second sort/simulate pass.
    const overflowKeys = new Set();
    if (budgetResult) {
        for (const e of budgetResult.overflow) overflowKeys.add(entryKey(e));
    }

    // Group by world. Null-prototype object so a hostile world name like
    // "__proto__" / "toString" / "constructor" can't poison the lookup.
    const grouped = Object.create(null);
    for (const entry of entries) { if (!grouped[entry.world]) grouped[entry.world] = []; grouped[entry.world].push(entry); }

    for (const [worldName, worldEntries] of Object.entries(grouped)) {
        const worldTokens = worldEntries.reduce((s, e) => s + e.estimatedTokens, 0);
        const sorted = sortEntries(worldEntries, _getSettings);
        html += `<div class="env-world"><div class="env-world__header"><span class="env-world__name">${escapeHtml(worldName)}</span><span class="env-world__badge">${worldEntries.length} · ~${worldTokens}t</span></div>`;
        for (const entry of sorted) {
            const key = entryKey(entry);
            html += renderEntry(entry, state.expandedUids.has(key), state.newUids.has(key) ? 'new' : 'unchanged', overflowKeys.has(key));
        }
        html += `</div>`;
    }

    if (removed.length > 0) {
        const removedGrouped = Object.create(null);
        for (const entry of removed) { if (!removedGrouped[entry.world]) removedGrouped[entry.world] = []; removedGrouped[entry.world].push(entry); }
        html += `<div class="env-removed-section"><div class="env-removed-section__header"><span>Removed this generation</span><span class="env-removed-section__count">−${removed.length}</span></div>`;
        for (const [, worldEntries] of Object.entries(removedGrouped)) {
            for (const entry of worldEntries) html += renderRemovedEntry(entry);
        }
        html += `</div>`;
    }

    if (entries.length === 0 && totalAll > 0) {
        html += `<div class="env-panel__empty">No entries match current filters.<br><small>${totalAll} entries hidden.</small></div>`;
    }

    if (state.lastProcessingMs !== null) {
        html += `<div class="env-panel__footer">Processed in ${state.lastProcessingMs}ms</div>`;
    }

    html += `</div>`;

    // Preserve scroll + focus + selection across re-render.
    const body = panel.querySelector('.env-panel__body');
    const scrollPos = body ? body.scrollTop : 0;
    const searchEl = panel.querySelector('.env-search__input');
    const searchWasFocused = searchEl === document.activeElement;
    const selStart = searchEl?.selectionStart ?? null;
    const selEnd = searchEl?.selectionEnd ?? null;

    panel.innerHTML = html;
    // Drop hover refs — the elements they pointed to were just detached.
    // Also hide the tooltip: if a highlight-tap triggered this render,
    // the mark it pointed at is now gone but the tooltip would linger
    // (no mouseout fires on touch).
    _hoveredEntry = null;
    _hoveredMark = null;
    hideTooltip();

    const newBody = panel.querySelector('.env-panel__body');
    if (newBody) newBody.scrollTop = scrollPos;
    if (searchWasFocused) {
        const input = panel.querySelector('.env-search__input');
        if (input) { input.focus(); if (selStart !== null) { input.selectionStart = selStart; input.selectionEnd = selEnd; } }
    }

    if (state.panelOpen) applyWIHighlights(entries);
}

// ── Entry Warnings ──

function computeWarnings(entry) {
    const w = [];
    if (entry.probability < 100 && !entry.sticky) {
        w.push(`Probability ${entry.probability}% without sticky — entry may flicker on/off`);
    }
    if (entry.group) {
        const peers = state.currentEntries.filter(e => e.group === entry.group);
        if (peers.length > 1 && !entry.groupOverride) {
            const weights = peers.map(e => e.groupWeight || 100);
            if (new Set(weights).size === 1) {
                w.push('All group members have equal weight — selection is random');
            }
        }
    }
    if (!entry.constant && !entry.vectorized && entry.scanDepth === 0 && entry.keys.length === 0) {
        w.push('Scan depth 0 with no keys and not constant/vector — will never activate by key match');
    }
    if (!entry.content || entry.content.trim().length === 0) {
        w.push('Empty content — entry activated but contributes nothing to prompt');
    }
    return w;
}

// ── Self-Test Accuracy Dot ──

const ACCURACY_COLORS = {
    [Category.MATCH]:      '#10b981',
    [Category.EXPLAINED]:  '#3b82f6',
    [Category.RECURSIVE]:  '#f59e0b',
    [Category.UNRESOLVED]: '#ef4444',
};
const ACCURACY_LABELS = {
    [Category.MATCH]:      'Key match reproduced',
    [Category.EXPLAINED]:  'Mechanism-driven (constant/vector/forced/sticky)',
    [Category.RECURSIVE]:  'Explained via recursive scan',
    [Category.UNRESOLVED]: 'Match not reproduced — accuracy gap',
};

function renderAccuracyDot(key) {
    if (!state.selfTest?.perEntry) return '';
    const entry = state.selfTest.perEntry.find(e => e.uid === key);
    if (!entry) return '';
    const color = ACCURACY_COLORS[entry.category] || '#64748b';
    const label = ACCURACY_LABELS[entry.category] || entry.category;
    return `<span class="env-entry__acc-dot" style="background:${color}" title="${label}"></span>`;
}

// ── Entry Card ──

function renderEntry(entry, isOpen, diffStatus, isOverflow = false) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const warnings = computeWarnings(entry);
    const cls = `env-entry${isOpen ? ' env-entry--open' : ''}${diffStatus === 'new' ? ' env-entry--new' : ''}${isOverflow ? ' env-entry--overflow' : ''}`;
    // data-key uses composite world::uid so every click/hover lookup
    // picks the right entry across multiple attached lorebooks.
    const key = entryKey(entry);

    let html = `<div class="${cls}" data-trigger="${entry.triggerType}" data-key="${escapeHtml(key)}" style="--trigger-color:${tt.color}">`;

    html += `<div class="env-entry__row">`;
    if (diffStatus === 'new') html += `<span class="env-entry__diff-badge">NEW</span>`;
    if (isOverflow) html += `<span class="env-entry__diff-badge env-entry__diff-badge--overflow">OVER</span>`;
    html += `<span class="env-entry__icon">${tt.icon}</span>`;
    html += `<span class="env-entry__title">${escapeHtml(entry.title)}</span>`;
    html += renderAccuracyDot(key);
    if (warnings.length > 0) html += `<span class="env-entry__warn" title="${escapeHtml(warnings.join('; '))}">${ICONS.warning}</span>`;
    html += renderSparkline(key);
    html += `<span class="env-entry__tokens">${entry.estimatedTokens}t</span>`;
    html += `<span class="env-entry__chevron">${isOpen ? ICONS.chevron_up : ICONS.chevron_down}</span>`;
    html += `</div>`;

    // Detail rendered on first expand (also lazy-injected by click handler).
    if (isOpen) html += renderEntryDetail(entry);

    html += `</div>`;
    return html;
}

// Collapsed-by-default key dropdown (header + count + chevron over chips).
// Keeps long key lists from dominating the detail view.
function renderKeyDropdown(labelText, keys, chipClass) {
    if (!keys || keys.length === 0) return '';
    let html = `<div class="env-detail__section env-detail__section--full env-keys">`;
    html += `<button class="env-keys-toggle" type="button">`;
    html += `<span class="env-detail__label">${escapeHtml(labelText)}</span>`;
    html += `<span class="env-keys-toggle__count">${keys.length}</span>`;
    html += `<span class="env-keys-toggle__chevron">${ICONS.chevron_down}</span>`;
    html += `</button>`;
    html += `<div class="env-keys-body env-detail__keys">`;
    for (const k of keys) html += `<span class="env-key${chipClass ? ' ' + chipClass : ''}">${escapeHtml(k)}</span>`;
    html += `</div></div>`;
    return html;
}

/** Detail block — lazy-injected on expand. */
function renderEntryDetail(entry) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const posLabel = POSITION_NAMES[entry.position] ?? `pos:${entry.position}`;

    let html = `<div class="env-detail">`;
    html += `<div class="env-detail__section"><span class="env-detail__badge" style="background:${tt.color}">${tt.label}</span> <span class="env-detail__desc">${tt.desc}</span></div>`;

    if (entry.vectorized) {
        let ragText = 'Vectorized entry';
        if (entry.vectorInfo) {
            ragText += entry.vectorInfo.ragEnabled
                ? ` · RAG enabled (threshold: ${entry.vectorInfo.threshold}, max: ${entry.vectorInfo.maxEntries})`
                : ' · RAG disabled in settings';
        }
        // Likely RAG activation: vectorized + no key hit.
        const mk = entry.matchedKeys;
        const noKeyMatch = mk && mk.primary.length === 0 && mk.secondary.length === 0;
        if (noKeyMatch && entry.vectorInfo?.ragEnabled) {
            ragText += ' · <span class="env-detail__badge-inline">ACTIVATED VIA RAG</span>';
        }
        html += `<div class="env-detail__section"><span class="env-detail__label">Vector</span><span class="env-detail__value">${ragText}</span></div>`;
    }

    let posDetail = posLabel;
    if (entry.position === 4) posDetail += ` (depth: ${entry.depth})`;
    if (entry.position === 7 && entry.outletName) posDetail += `: ${escapeHtml(entry.outletName)}`;
    const roleName = ROLE_NAMES[entry.role] || 'System';
    if (entry.role !== 0) posDetail += ` · ${roleName}`;

    html += `<div class="env-detail__section"><span class="env-detail__label">Position</span><span class="env-detail__value">${posDetail}</span></div>`;
    html += `<div class="env-detail__section"><span class="env-detail__label">Order</span><span class="env-detail__value">${entry.order ?? '—'}</span></div>`;
    html += `<div class="env-detail__section"><span class="env-detail__label">Size</span><span class="env-detail__value">${entry.charCount} chars · ~${entry.estimatedTokens} tokens${entry.ignoreBudget ? ' · <span class="env-detail__badge-inline">IGNORES BUDGET</span>' : ''}</span></div>`;

    // Timed-effect rows grouped in one accent block, separate from base
    // metadata. Rendered only when at least one applies.
    let timed = '';
    if (entry.sticky) {
        let stickyText = `${entry.sticky} turn duration`;
        if (entry.stickyRemaining !== null) stickyText += ` · <span class="env-detail__badge-inline">${entry.stickyRemaining} remaining</span>`;
        timed += `<div class="env-detail__section"><span class="env-detail__label">Sticky</span><span class="env-detail__value">${stickyText}</span></div>`;
    }
    if (entry.cooldown) {
        let cdText = `${entry.cooldown} turn cooldown`;
        if (entry.cooldownRemaining !== null) cdText += ` · <span class="env-detail__badge-inline">${entry.cooldownRemaining} remaining</span>`;
        timed += `<div class="env-detail__section"><span class="env-detail__label">Cooldown</span><span class="env-detail__value">${cdText}</span></div>`;
    }
    if (entry.delay) timed += `<div class="env-detail__section"><span class="env-detail__label">Delay</span><span class="env-detail__value">${entry.delay} turn delay before activation</span></div>`;
    if (entry.probability < 100) timed += `<div class="env-detail__section"><span class="env-detail__label">Probability</span><span class="env-detail__value">${entry.probability}%</span></div>`;
    if (timed) html += `<div class="env-detail__group">${timed}</div>`;
    if (entry.group) {
        html += `<div class="env-detail__section"><span class="env-detail__label">Group</span><span class="env-detail__value">${escapeHtml(entry.group)}${entry.groupWeight ? ` (weight: ${entry.groupWeight})` : ''}${entry.groupOverride ? ' · <span class="env-detail__badge-inline">PRIORITY</span>' : ''}</span></div>`;
        // Composite world::uid identity — bare uid collides across books
        // (entry's own card hidden, real same-uid peer in another book missed).
        const ownKey = entryKey(entry);
        const groupPeers = state.currentEntries.filter(e => e.group === entry.group && entryKey(e) !== ownKey);
        if (groupPeers.length > 0) {
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Group members</span><div class="env-group-peers">`;
            for (const peer of groupPeers) {
                html += `<span class="env-group-peer"><span class="env-group-peer__name">${escapeHtml(peer.title)}</span><span class="env-group-peer__weight">w:${peer.groupWeight || 100}</span></span>`;
            }
            html += `</div></div>`;
        }
    }

    // Selective logic + evaluation.
    if (entry.selectiveLogic !== undefined) {
        html += `<div class="env-detail__section"><span class="env-detail__label">Logic</span><span class="env-detail__value">${LOGIC_NAMES[entry.selectiveLogic] || entry.selectiveLogic}</span></div>`;
        if (entry.matchedKeys?.logicResult) {
            const lr = entry.matchedKeys.logicResult;
            const statusClass = lr.satisfied ? 'env-logic--satisfied' : 'env-logic--unsatisfied';
            const statusIcon = lr.satisfied ? '✓' : '✗';
            html += `<div class="env-detail__section env-detail__section--full">`;
            html += `<span class="env-detail__label">Evaluation</span>`;
            html += `<span class="env-logic-status ${statusClass}"><span class="env-logic-status__icon">${statusIcon}</span> ${escapeHtml(lr.explanation)}</span>`;
            html += `</div>`;
        }
    }

    const recursionFlags = [];
    if (entry.preventRecursion) recursionFlags.push('Prevent');
    if (entry.excludeRecursion) recursionFlags.push('Exclude');
    if (entry.delayUntilRecursion) recursionFlags.push(`Delay level ${entry.delayUntilRecursion}`);
    if (recursionFlags.length > 0) html += `<div class="env-detail__section"><span class="env-detail__label">Recursion</span><span class="env-detail__value">${recursionFlags.join(', ')}</span></div>`;

    if (entry.characterFilter) {
        const cf = entry.characterFilter;
        const names = cf.names || [];
        const tags = cf.tags || [];
        const parts = [...names.map(n => escapeHtml(n)), ...tags.map(t => `#${escapeHtml(t)}`)];
        if (parts.length > 0) {
            const mode = cf.isExclude ? 'Exclude' : 'Only';
            html += `<div class="env-detail__section"><span class="env-detail__label">Char filter</span><span class="env-detail__value">${mode}: ${parts.join(', ')}</span></div>`;
        }
    }

    if (entry.triggers && entry.triggers.length > 0) {
        html += `<div class="env-detail__section"><span class="env-detail__label">Triggers</span><span class="env-detail__value">${entry.triggers.map(t => escapeHtml(t)).join(', ')}</span></div>`;
    }

    const warnings = computeWarnings(entry);
    if (warnings.length > 0) {
        html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Warnings</span><div class="env-detail__warnings">`;
        for (const w of warnings) html += `<div class="env-detail__warning">${ICONS.warning} ${escapeHtml(w)}</div>`;
        html += `</div></div>`;
    }

    // Per-source scan breakdown.
    if (entry.matchedKeys) {
        const mk = entry.matchedKeys;
        const scanFlagMap = {
            chat: true,
            description: !!entry.matchCharacterDescription,
            personality: !!entry.matchCharacterPersonality,
            depth_prompt: !!entry.matchCharacterDepthPrompt,
            scenario: !!entry.matchScenario,
            creator_notes: !!entry.matchCreatorNotes,
            persona: !!entry.matchPersonaDescription,
            AN: true,
        };

        // Null-proto objects: m.source can be an extension-prompt key from a
        // sibling extension; a hostile key like "__proto__" must not poison.
        const actualBySource = Object.create(null);
        for (const m of [...(mk.primary || []), ...(mk.secondary || [])]) {
            if (!actualBySource[m.source]) actualBySource[m.source] = [];
            if (!actualBySource[m.source].includes(m.key)) actualBySource[m.source].push(m.key);
        }

        const potentialBySource = Object.create(null);
        for (const m of (mk.potential || [])) {
            if (!potentialBySource[m.source]) potentialBySource[m.source] = [];
            if (!potentialBySource[m.source].includes(m.key)) potentialBySource[m.source].push(m.key);
        }

        const allSourceLabels = Object.keys(scanFlagMap);
        const relevantSources = allSourceLabels.filter(s =>
            scanFlagMap[s] || actualBySource[s] || potentialBySource[s]
        );

        if (relevantSources.length > 0) {
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Source scan</span><div class="env-source-grid">`;
            for (const srcLabel of relevantSources) {
                const sc = SOURCE_COLORS[srcLabel] || { color: '#64748b', label: srcLabel };
                const isScanning = !!scanFlagMap[srcLabel];
                const actual = actualBySource[srcLabel] || [];
                const potential = potentialBySource[srcLabel] || [];
                const statusIcon = isScanning ? '✓' : '—';
                const statusCls = isScanning ? 'env-source-grid__status--on' : 'env-source-grid__status--off';

                html += `<div class="env-source-grid__row">`;
                html += `<span class="env-source-grid__status ${statusCls}">${statusIcon}</span>`;
                html += `<span class="env-source-grid__label" style="--source-color:${sc.color}">${escapeHtml(sc.label)}</span>`;
                html += `<div class="env-source-grid__keys">`;
                for (const k of actual) html += `<span class="env-key env-key--matched" style="--match-color:${sc.color}">${escapeHtml(k)}</span>`;
                for (const k of potential) html += `<span class="env-key env-key--potential" title="Key found but source not scanned">⚠ ${escapeHtml(k)}</span>`;
                if (actual.length === 0 && potential.length === 0 && isScanning) html += `<span class="env-source-grid__none">no keys found</span>`;
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }
    }

    html += renderKeyDropdown('Primary keys', entry.keys, '');
    html += renderKeyDropdown('Secondary keys', entry.secondaryKeys, 'env-key--secondary');

    if (entry.matchedKeys) {
        const mk = entry.matchedKeys;
        if (mk.reason) html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Activation</span><span class="env-detail__match-reason">${escapeHtml(mk.reason)}</span></div>`;

        if (mk.matchStrength && (mk.matchStrength.primaryTotal > 0 || mk.matchStrength.secondaryTotal > 0)) {
            const ms = mk.matchStrength;
            const total = ms.primaryTotal + ms.secondaryTotal;
            const hits = ms.primaryHit + ms.secondaryHit;
            const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
            const barColor = pct >= 80 ? '#10b981' : (pct >= 40 ? '#f59e0b' : '#ef4444');
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Match strength</span><div class="env-match-strength"><div class="env-match-strength__bar"><div class="env-match-strength__fill" style="width:${pct}%;background:${barColor}"></div></div><span class="env-match-strength__label">${hits}/${total} keys · ${ms.sourceCount} src</span></div></div>`;
        }
    }

    // Lazy expand for long content; data-key is composite world::uid so
    // the click handler picks the right book's content.
    if (entry.content) {
        const CONTENT_PREVIEW_LEN = 300;
        const isLong = entry.content.length > CONTENT_PREVIEW_LEN;
        const preview = isLong ? entry.content.substring(0, CONTENT_PREVIEW_LEN) : entry.content;
        const key = entryKey(entry);
        html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">Content</span>`;
        html += `<div class="env-detail__content" data-full-len="${entry.content.length}">`;
        html += `<span class="env-detail__content-text">${escapeHtml(preview)}${isLong ? '…' : ''}</span>`;
        if (isLong) html += `<button class="env-detail__content-expand" data-key="${escapeHtml(key)}">Show all (${entry.content.length} chars)</button>`;
        html += `</div></div>`;
    }

    html += `</div>`;
    return html;
}

function renderRemovedEntry(entry) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const key = entryKey(entry);
    return `<div class="env-entry env-entry--removed" data-trigger="${entry.triggerType}" data-key="${escapeHtml(key)}" style="--trigger-color:${tt.color}"><div class="env-entry__row"><span class="env-entry__diff-badge env-entry__diff-badge--removed">OUT</span><span class="env-entry__icon">${tt.icon}</span><span class="env-entry__title">${escapeHtml(entry.title)}</span><span class="env-entry__tokens">${entry.estimatedTokens}t</span></div></div>`;
}
