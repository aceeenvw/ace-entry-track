// ⊹ ACE ENTRY TRACK ⊹ — ui/panel.js
// Side panel: context preview, selective-logic display, persistent WI
// highlighting, bidirectional cross-highlighting, custom tooltips,
// re-evaluate, performance warning.

import { ICONS } from '../icons.js';
import { escapeHtml } from '../utils/html.js';
import { entryKey } from '../utils/ids.js';
import { state, sortEntries, cycleSortBy, toggleSortOrder, applyFilters, getActivationHistory } from '../core/state.js';
import { TRIGGER_TYPES, SOURCE_COLORS, SORT_OPTIONS, POSITION_NAMES, ROLE_NAMES, LOGIC_NAMES } from '../core/processor.js';
import { closePanel } from './trigger-button.js';
import { createMatchingContext, ensurePotentialMatches, resolveKeyMacros, parseRegexKey, buildAllSources } from '../core/matching.js';
import { Category } from '../core/self-test.js';
import { t } from '../i18n.js';

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

    const panel = document.createElement('aside');
    panel.id = 'env_tracker_panel';
    panel.className = 'env-panel';
    panel.setAttribute('aria-label', 'Ace Entry Track');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    panel.innerHTML = `<div class="env-panel__body"><div class="env-panel__empty">${t('panel.initial')}</div></div>`;

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
                keysToggle.setAttribute('aria-expanded', String(open));
                const chevron = keysToggle.querySelector('.env-keys-toggle__chevron');
                if (chevron) chevron.innerHTML = open ? ICONS.chevron_up : ICONS.chevron_down;
            }
            return;
        }


        // Entry expand/collapse — no re-render, just toggle + lazy detail inject.
        const entryRow = e.target.closest('.env-entry__row');
        const entryEl = entryRow?.closest('.env-entry');
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
                    ensurePotentialMatches(entryData, createMatchingContext());
                    entryEl.insertAdjacentHTML('beforeend', renderEntryDetail(entryData));
                }
            }
        }
        const chevron = entryEl.querySelector('.env-entry__chevron');
        if (chevron) chevron.innerHTML = state.expandedUids.has(key) ? ICONS.chevron_up : ICONS.chevron_down;
        entryRow.setAttribute('aria-expanded', String(state.expandedUids.has(key)));
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

    panel.addEventListener('keydown', (e) => {
        const highlight = e.target.closest('.env-highlight');
        if (highlight && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            highlight.click();
        }
    });

    document.body.appendChild(panel);
}

// ── Tooltip ──

function createTooltip() {
    if (document.getElementById('env_tooltip')) return;
    const tip = document.createElement('div');
    tip.id = 'env_tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.setAttribute('aria-hidden', 'true');
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
    tip.setAttribute('aria-hidden', 'false');

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
    if (tip) {
        tip.style.display = 'none';
        tip.setAttribute('aria-hidden', 'true');
    }
}

// ── Expand / Collapse All ──

function expandAll() {
    const MAX_EXPANDED_ENTRIES = 200;
    for (const entry of state.currentEntries.slice(0, MAX_EXPANDED_ENTRIES)) {
        state.expandedUids.add(entryKey(entry));
    }
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

function buildContextPreview(entries, matchingContext = createMatchingContext()) {
    const allSources = buildAllSources(matchingContext);
    if (allSources.length === 0) return `<span class="env-ctx__empty">${t('context.none')}</span>`;

    const MAX_CONTEXT_ENTRIES = 500;
    const MAX_KEY_REFS = 4096;
    const MAX_SOURCE_KEY_REFS = 512;
    const previewEntries = entries.slice(0, MAX_CONTEXT_ENTRIES);

    // ref = composite world::uid (bare uid collides across books).
    const keyRefsBySource = new Map();
    const getSourceRefs = (source) => {
        if (!keyRefsBySource.has(source)) keyRefsBySource.set(source, { actual: [], potential: [] });
        return keyRefsBySource.get(source);
    };
    let actualRefCount = 0;
    let potentialRefCount = 0;

    for (const entry of previewEntries) {
        const mk = entry.matchedKeys;
        if (!mk) continue;
        const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
        const ref = entryKey(entry);
        for (const m of [...(mk.primary || []), ...(mk.secondary || [])]) {
            if (actualRefCount >= MAX_KEY_REFS) break;
            const sourceRefs = getSourceRefs(m.source).actual;
            if (sourceRefs.length >= MAX_SOURCE_KEY_REFS) continue;
            sourceRefs.push({ key: m.key, ref, color: tt.color, title: entry.title, source: m.source });
            actualRefCount++;
        }
        if (potentialRefCount < MAX_KEY_REFS) ensurePotentialMatches(entry, matchingContext);
        for (const m of (mk.potential || [])) {
            if (potentialRefCount >= MAX_KEY_REFS) break;
            const sourceRefs = getSourceRefs(m.source).potential;
            if (sourceRefs.length >= MAX_SOURCE_KEY_REFS) continue;
            sourceRefs.push({ key: m.key, ref, color: tt.color, title: entry.title, source: m.source });
            potentialRefCount++;
        }
    }

    const wiSettings = matchingContext.wiSettings;
    const scanDepth = wiSettings.scanDepth || 10;

    let html = entries.length > previewEntries.length
        ? `<div class="env-ctx__limit">${t('context.limit', { count: previewEntries.length })}</div>`
        : '';
    const highlightBudget = { totalRemaining: 1000, sourceRemaining: 300 };

    for (const src of allSources) {
        const sc = SOURCE_COLORS[src.label] || { color: '#64748b', label: src.label };
        const sourceRefs = keyRefsBySource.get(src.label) || { actual: [], potential: [] };
        const keysForSource = sourceRefs.actual;
        const potentialForSource = sourceRefs.potential;
        const hitCount = keysForSource.length;
        const potentialCount = potentialForSource.length;

        if (!src.text && hitCount === 0 && potentialCount === 0) continue;

        const isOpen = state.contextSourcesOpen.has(src.label);
        const chevron = isOpen ? ICONS.chevron_up : ICONS.chevron_down;

        html += `<div class="env-ctx__section${isOpen ? ' env-ctx__section--open' : ''}">`;
        html += `<button type="button" class="env-ctx__source-header" data-source="${escapeHtml(src.label)}" aria-expanded="${isOpen}">`;
        html += `<span class="env-ctx__source-label" style="--source-color:${sc.color}">${escapeHtml(sc.label)}</span>`;
        if (hitCount > 0) html += `<span class="env-ctx__source-hits" style="color:${sc.color}">${t('context.hits', { count: hitCount, suffix: hitCount !== 1 ? 's' : '' })}</span>`;
        if (potentialCount > 0) html += `<span class="env-ctx__source-potential-count">${t('context.potential', { count: potentialCount })}</span>`;
        html += `<span class="env-ctx__source-chevron">${chevron}</span>`;
        html += `</button>`;

        if (isOpen) {
            highlightBudget.sourceRemaining = 300;
            html += `<div class="env-ctx__source-body">`;
            if (src.label === 'chat') {
                const ctx = SillyTavern.getContext();
                const chat = ctx.chat || [];
                const recent = chat.slice(-scanDepth);
                if (recent.length === 0) {
                    html += `<span class="env-ctx__empty">${t('context.noChat')}</span>`;
                } else {
                    // Cap per-message preview for huge messages (RP logs, pasted articles).
                    const MSG_PREVIEW_LEN = 2000;
                    for (const msg of recent) {
                        const name = msg.name || (msg.is_user ? t('context.you') : t('context.ai'));
                        const isUser = !!msg.is_user;
                        const nameClass = isUser ? 'env-ctx__name--user' : 'env-ctx__name--char';
                        let body = msg.mes || '';
                        const truncated = body.length > MSG_PREVIEW_LEN;
                        if (truncated) body = body.slice(0, MSG_PREVIEW_LEN);
                        html += `<div class="env-ctx__msg"><span class="env-ctx__name ${nameClass}">${escapeHtml(name)}</span>`;
                        html += `<span class="env-ctx__text">${highlightTextWithKeys(body, keysForSource, potentialForSource, matchingContext, highlightBudget)}${truncated ? '…' : ''}</span></div>`;
                    }
                }
            } else {
                const raw = src.text || '';
                const CTX_PREVIEW_LEN = 600;
                if (raw.length > CTX_PREVIEW_LEN) {
                    html += `<div class="env-ctx__block">`;
                    html += `<span class="env-ctx__preview-text">${highlightTextWithKeys(raw.substring(0, CTX_PREVIEW_LEN), keysForSource, potentialForSource, matchingContext, highlightBudget)}…</span>`;
                    html += `<button type="button" class="env-ctx__show-all" data-source="${escapeHtml(src.label)}">${t('context.showAll', { count: raw.length })}</button>`;
                    html += `<span class="env-ctx__full-text" style="display:none">${escapeHtml(raw)}</span>`;
                    html += `</div>`;
                } else {
                    html += `<div class="env-ctx__block">${highlightTextWithKeys(raw, keysForSource, potentialForSource, matchingContext, highlightBudget)}</div>`;
                }
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    return html;
}

// ── Text Highlighting ──

function highlightTextWithKeys(text, keyEntryMap, potentialKeyMap = [], matchingContext = null, highlightBudget = null) {
    if (!text || (keyEntryMap.length === 0 && potentialKeyMap.length === 0)) return escapeHtml(text);
    if (highlightBudget && (highlightBudget.totalRemaining <= 0 || highlightBudget.sourceRemaining <= 0)) return escapeHtml(text);

    const positions = [];

    for (const { key, ref, color, title } of keyEntryMap) {
        if (highlightBudget && (highlightBudget.totalRemaining <= 0 || highlightBudget.sourceRemaining <= 0)) break;
        findKeyPositions(text, key, (start, end) => {
            positions.push({ start, end, ref, color, title, key, type: 'actual' });
            if (!highlightBudget) return true;
            highlightBudget.totalRemaining--;
            highlightBudget.sourceRemaining--;
            return highlightBudget.totalRemaining > 0 && highlightBudget.sourceRemaining > 0;
        }, matchingContext);
    }
    for (const { key, ref, color, title } of potentialKeyMap) {
        if (highlightBudget && (highlightBudget.totalRemaining <= 0 || highlightBudget.sourceRemaining <= 0)) break;
        findKeyPositions(text, key, (start, end) => {
            positions.push({ start, end, ref, color, title, key, type: 'potential' });
            if (!highlightBudget) return true;
            highlightBudget.totalRemaining--;
            highlightBudget.sourceRemaining--;
            return highlightBudget.totalRemaining > 0 && highlightBudget.sourceRemaining > 0;
        }, matchingContext);
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
        html += `<mark class="${hlClass}" tabindex="0" role="button" aria-label="${escapeHtml(t('highlight.filter', { key: m.keys[0] }))}" data-keys-refs="${escapeHtml(refsStr)}" data-keys="${escapeHtml(keyStr)}" style="--hl-color:${color}">${escapeHtml(highlighted)}</mark>`;
        last = m.end;
    }
    if (last < text.length) html += escapeHtml(text.substring(last));
    return html;
}

/** Find all positions of a key (regex or literal) in text. */
function findKeyPositions(text, key, callback, matchingContext = null) {
    const resolvedKey = resolveKeyMacros(key, matchingContext);
    if (!resolvedKey || !resolvedKey.trim()) return;
    const trimmed = resolvedKey.trim();

    // Caps bound worst-case time for catastrophic-backtracking or
    // match-every-position patterns from malicious lorebooks. Zero-width
    // matches get a much tighter cap because they can produce one <mark>
    // tag per character, freezing the renderer with thousands of nodes.
    const MAX_MATCHES = 1000;
    const MAX_ZERO_WIDTH = 50;

    const regexKey = parseRegexKey(trimmed, matchingContext);
    if (regexKey) {
        try {
            const globalRegex = new RegExp(regexKey.source, regexKey.flags.includes('g') ? regexKey.flags : regexKey.flags + 'g');
            let match;
            let count = 0;
            let zeroWidthCount = 0;
            while ((match = globalRegex.exec(text)) !== null) {
                if (callback(match.index, match.index + match[0].length) === false) break;
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
            if (callback(idx, idx + trimmed.length) === false) break;
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
    return `<span class="env-spark" title="${t('history.title', { count: history.length })}">${dots}</span>`;
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
    const totalAll = entries.length;
    const totalTokens = entries.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
    const trackedKeys = new Set(entries.map(entryKey));
    const newCount = [...state.newUids].filter(key => trackedKeys.has(key)).length;

    const removed = monitored.length > 0
        ? state.removedEntries.filter(e => monitored.includes(e.world))
        : state.removedEntries;

    const triggerCounts = {};
    for (const e of entries) triggerCounts[e.triggerType] = (triggerCounts[e.triggerType] || 0) + 1;

    entries = applyFilters(entries);

    let renderMatchingContext = null;
    const expandedEntries = entries.filter(entry => state.expandedUids.has(entryKey(entry)));
    if (expandedEntries.length > 0) {
        renderMatchingContext = createMatchingContext();
        for (const entry of expandedEntries) ensurePotentialMatches(entry, renderMatchingContext);
    }

    const currentSort = settings.sortBy || 'order';
    const currentDir = settings.sortOrder || 'asc';
    const sortOpt = SORT_OPTIONS[currentSort] || SORT_OPTIONS.order;

    let html = '';

    // Header
    html += `<div class="env-panel__header">`;
    html += `<span class="env-panel__title">${ICONS.tracker} ${t('panel.title')}</span>`;
    html += `<div class="env-panel__header-actions">`;
    html += `<span class="env-panel__stats" aria-live="polite">${t('panel.stats', { count: totalAll, tokens: totalTokens })}</span>`;
    if (newCount > 0 || removed.length > 0) {
        html += `<span class="env-diff-summary">`;
        if (newCount > 0) html += `<span class="env-diff-new">+${newCount}</span>`;
        if (removed.length > 0) html += `<span class="env-diff-removed">−${removed.length}</span>`;
        html += `</span>`;
    }
    html += `<button type="button" class="env-panel__refresh" title="${t('panel.refresh')}" aria-label="${t('panel.refresh')}">${ICONS.refresh}</button>`;
    html += `<button type="button" class="env-panel__close" title="${t('panel.close')}" aria-label="${t('panel.close')}">✕</button>`;
    html += `</div></div>`;

    // Performance warning
    if (state.lastProcessingMs !== null && state.lastProcessingMs > 500) {
        html += `<div class="env-perf-warning">${ICONS.warning} ${t('panel.slow', { ms: state.lastProcessingMs })}</div>`;
    }

    html += `<div class="env-panel__body">`;

    if (totalAll === 0 && removed.length === 0) {
        html += `<div class="env-panel__empty">${ICONS.empty} ${t('panel.empty')}<br><small>${t('panel.emptyHint')}</small></div>`;
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

    const scan = state.scanSummary;
    if (scan?.final) {
        const statusClass = scan.overflowed ? ' env-native-scan--limit' : '';
        const budgetText = scan.budget === null ? t('scan.budgetUnknown') : t('scan.budget', { count: scan.budget });
        const statusText = scan.overflowed ? t('scan.limitReached') : t('scan.limitClear');
        const loopText = t('scan.loops', { count: scan.loopCount, suffix: scan.loopCount === 1 ? '' : 's' });
        html += `<div class="env-native-scan${statusClass}">`;
        html += `<span class="env-native-scan__title">${ICONS.budget} ${t('scan.title')}</span>`;
        html += `<span>${t('scan.active', { count: scan.activeCount })}</span>`;
        if (state.explanationCoverage) {
            html += `<span>${t('scan.coverage', { count: state.explanationCoverage.coverage })}</span>`;
        }
        html += `<span>${escapeHtml(loopText)}</span>`;
        html += `<span>${escapeHtml(budgetText)}</span>`;
        html += `<span class="env-native-scan__status">${escapeHtml(statusText)}</span>`;
        html += `</div>`;
    }

    // Context preview
    const ctxOpen = state.contextPreviewOpen;
    html += `<div class="env-context">`;
    html += `<button type="button" class="env-context-toggle" aria-expanded="${ctxOpen}"><span class="env-context-toggle__icon">${ICONS.context}</span><span>${t('context.title')}</span><span class="env-context-toggle__arrow">${ctxOpen ? ICONS.chevron_up : ICONS.chevron_down}</span></button>`;
    if (ctxOpen) {
        renderMatchingContext ||= createMatchingContext();
        html += `<div class="env-ctx__body">${buildContextPreview(entries, renderMatchingContext)}</div>`;
    }
    html += `</div>`;

    // Toolbar
    html += `<div class="env-toolbar">`;
    html += `<input class="env-search__input" type="search" name="ace-entry-search" autocomplete="off" aria-label="${t('search.placeholder')}" placeholder="${t('search.placeholder')}" value="${escapeHtml(state.searchQuery)}" />`;
    html += `<button type="button" class="env-sort__field" title="${t('sort.cycle')}"><span class="env-sort__icon">${sortOpt.icon}</span><span class="env-sort__label">${t(`sort.${currentSort}`)}</span></button>`;
    html += `<button type="button" class="env-sort__dir" title="${t('sort.toggle')}" aria-label="${t('sort.toggle')}">${currentDir === 'asc' ? ICONS.chevron_up : ICONS.chevron_down}</button>`;
    html += `<button type="button" class="env-toolbar__expand-all" title="${t('toolbar.expand')}" aria-label="${t('toolbar.expand')}">${ICONS.expand}</button>`;
    html += `<button type="button" class="env-toolbar__collapse-all" title="${t('toolbar.collapse')}" aria-label="${t('toolbar.collapse')}">${ICONS.collapse}</button>`;
    html += `</div>`;

    // Filter chips
    const hasActiveFilters = state.triggerFilter.size > 0 || state.searchQuery || state.highlightKeyFilter;
    const presentTypes = Object.keys(triggerCounts).sort();
    if (presentTypes.length > 0) {
        html += `<div class="env-filter">`;
        for (const type of presentTypes) {
            const tt = TRIGGER_TYPES[type] || TRIGGER_TYPES.normal;
            const isActive = state.triggerFilter.has(type);
            html += `<button type="button" class="env-filter__chip${isActive ? ' env-filter__chip--active' : ''}" data-trigger="${type}" aria-pressed="${isActive}" style="--chip-color:${tt.color}" title="${escapeHtml(tt.desc)}"><span class="env-filter__chip-icon">${tt.icon}</span><span class="env-filter__chip-label">${escapeHtml(tt.label)}</span><span class="env-filter__chip-count">${triggerCounts[type]}</span></button>`;
        }
        if (hasActiveFilters) html += `<button type="button" class="env-filter__clear" title="${t('filter.clear')}" aria-label="${t('filter.clear')}">✕</button>`;
        html += `</div>`;
    }

    if (state.highlightKeyFilter) {
        html += `<div class="env-key-filter"><span class="env-key-filter__label">${t('filter.key')}</span><span class="env-key-filter__value">${escapeHtml(state.highlightKeyFilter)}</span><button type="button" class="env-key-filter__clear" title="${t('filter.clearKey')}" aria-label="${t('filter.clearKey')}">✕</button></div>`;
    }

    // Group by world. Null-prototype object so a hostile world name like
    // "__proto__" / "toString" / "constructor" can't poison the lookup.
    const grouped = Object.create(null);
    for (const entry of entries) { if (!grouped[entry.world]) grouped[entry.world] = []; grouped[entry.world].push(entry); }

    for (const [worldName, worldEntries] of Object.entries(grouped)) {
        const worldTokens = worldEntries.reduce((s, e) => s + e.estimatedTokens, 0);
        const sorted = sortEntries(worldEntries, _getSettings);
        html += `<div class="env-world"><div class="env-world__header"><span class="env-world__name">${escapeHtml(worldName)}</span><span class="env-world__badge">${t('world.summary', { count: worldEntries.length, tokens: worldTokens })}</span></div>`;
        for (const entry of sorted) {
            const key = entryKey(entry);
            html += renderEntry(entry, state.expandedUids.has(key), state.newUids.has(key) ? 'new' : 'unchanged');
        }
        html += `</div>`;
    }

    if (removed.length > 0) {
        const removedGrouped = Object.create(null);
        for (const entry of removed) { if (!removedGrouped[entry.world]) removedGrouped[entry.world] = []; removedGrouped[entry.world].push(entry); }
        html += `<div class="env-removed-section"><div class="env-removed-section__header"><span>${t('removed.title')}</span><span class="env-removed-section__count">−${removed.length}</span></div>`;
        for (const [, worldEntries] of Object.entries(removedGrouped)) {
            for (const entry of worldEntries) html += renderRemovedEntry(entry);
        }
        html += `</div>`;
    }

    if (entries.length === 0 && totalAll > 0) {
        html += `<div class="env-panel__empty">${t('panel.noFilterResults')}<br><small>${t('panel.hidden', { count: totalAll })}</small></div>`;
    }

    if (state.lastProcessingMs !== null) {
        html += `<div class="env-panel__footer">${t('panel.processed', { ms: state.lastProcessingMs })}</div>`;
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
        w.push(t('warning.probability', { value: entry.probability }));
    }
    if (!entry.constant && !entry.vectorized && entry.scanDepth === 0 && entry.keys.length === 0) {
        w.push(t('warning.noKeys'));
    }
    if (!entry.content || entry.content.trim().length === 0) {
        w.push(t('warning.empty'));
    }
    return w;
}

// ── Explanation Coverage Dot ──

const COVERAGE_COLORS = {
    [Category.MATCH]:      '#10b981',
    [Category.EXPLAINED]:  '#06b6d4',
    [Category.RECURSIVE]:  '#f59e0b',
    [Category.UNRESOLVED]: '#64748b',
};
const COVERAGE_LABELS = {
    [Category.MATCH]:      'coverage.match',
    [Category.EXPLAINED]:  'coverage.explained',
    [Category.RECURSIVE]:  'coverage.recursive',
    [Category.UNRESOLVED]: 'coverage.unresolved',
};

function renderCoverageDot(key) {
    if (!state.explanationCoverage?.perEntry) return '';
    const category = state.explanationCoverage.perEntry.get(key);
    if (!category) return '';
    const color = COVERAGE_COLORS[category] || '#64748b';
    const label = t(COVERAGE_LABELS[category] || category);
    return `<span class="env-entry__coverage-dot" style="background:${color}" title="${label}"></span>`;
}

// ── Entry Card ──

function renderEntry(entry, isOpen, diffStatus) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const warnings = computeWarnings(entry);
    const cls = `env-entry${isOpen ? ' env-entry--open' : ''}${diffStatus === 'new' ? ' env-entry--new' : ''}`;
    // data-key uses composite world::uid so every click/hover lookup
    // picks the right entry across multiple attached lorebooks.
    const key = entryKey(entry);

    let html = `<div class="${cls}" data-trigger="${entry.triggerType}" data-key="${escapeHtml(key)}" style="--trigger-color:${tt.color}">`;

    html += `<button type="button" class="env-entry__row" aria-expanded="${isOpen}">`;
    if (diffStatus === 'new') html += `<span class="env-entry__diff-badge">${t('badge.new')}</span>`;
    html += `<span class="env-entry__icon">${tt.icon}</span>`;
    html += `<span class="env-entry__title">${escapeHtml(entry.title)}</span>`;
    html += renderCoverageDot(key);
    if (warnings.length > 0) html += `<span class="env-entry__warn" title="${escapeHtml(warnings.join('; '))}">${ICONS.warning}</span>`;
    html += renderSparkline(key);
    html += `<span class="env-entry__tokens">${entry.estimatedTokens}t</span>`;
    html += `<span class="env-entry__chevron">${isOpen ? ICONS.chevron_up : ICONS.chevron_down}</span>`;
    html += `</button>`;

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
        html += `<button class="env-keys-toggle" type="button" aria-expanded="false">`;
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
    html += `<div class="env-detail__section"><span class="env-detail__label">${t('status.native')}</span><span class="env-detail__badge-inline">${t('status.active')}</span></div>`;
    html += `<div class="env-detail__section"><span class="env-detail__badge" style="background:${tt.color}">${tt.label}</span> <span class="env-detail__desc">${tt.desc}</span></div>`;

    if (entry.vectorized) {
        let ragText = t('detail.vectorEnabled');
        if (entry.vectorInfo) {
            ragText += entry.vectorInfo.ragEnabled
                ? ` · ${t('detail.ragEnabled', { threshold: entry.vectorInfo.threshold, max: entry.vectorInfo.maxEntries })}`
                : ` · ${t('detail.ragDisabled')}`;
        }
        html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.vector')}</span><span class="env-detail__value">${ragText}</span></div>`;
    }

    let posDetail = posLabel;
    if (entry.position === 4) posDetail += ` (depth: ${entry.depth})`;
    if (entry.position === 7 && entry.outletName) posDetail += `: ${escapeHtml(entry.outletName)}`;
    const roleName = ROLE_NAMES[entry.role] || 'System';
    if (entry.role !== 0) posDetail += ` · ${roleName}`;

    html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.position')}</span><span class="env-detail__value">${posDetail}</span></div>`;
    html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.order')}</span><span class="env-detail__value">${entry.order ?? '—'}</span></div>`;
    html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.size')}</span><span class="env-detail__value">${t('detail.sizeValue', { chars: entry.charCount, tokens: entry.estimatedTokens })}${entry.ignoreBudget ? ` · <span class="env-detail__badge-inline">${t('detail.ignoresBudget')}</span>` : ''}</span></div>`;

    // Timed-effect rows grouped in one accent block, separate from base
    // metadata. Rendered only when at least one applies.
    let timed = '';
    if (entry.sticky) {
        let stickyText = t('detail.stickyValue', { count: entry.sticky });
        if (entry.stickyRemaining !== null) stickyText += ` · <span class="env-detail__badge-inline">${t('detail.remaining', { count: entry.stickyRemaining })}</span>`;
        timed += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.sticky')}</span><span class="env-detail__value">${stickyText}</span></div>`;
    }
    if (entry.cooldown) {
        let cdText = t('detail.cooldownValue', { count: entry.cooldown });
        if (entry.cooldownRemaining !== null) cdText += ` · <span class="env-detail__badge-inline">${t('detail.remaining', { count: entry.cooldownRemaining })}</span>`;
        timed += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.cooldown')}</span><span class="env-detail__value">${cdText}</span></div>`;
    }
    if (entry.delay) timed += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.delay')}</span><span class="env-detail__value">${t('detail.delayValue', { count: entry.delay })}</span></div>`;
    if (entry.probability < 100) timed += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.probability')}</span><span class="env-detail__value">${entry.probability}%</span></div>`;
    if (timed) html += `<div class="env-detail__group">${timed}</div>`;
    if (entry.group) {
        html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.group')}</span><span class="env-detail__value">${escapeHtml(entry.group)}${entry.groupWeight ? ` (${t('detail.weight', { count: entry.groupWeight })})` : ''}${entry.groupOverride ? ` · <span class="env-detail__badge-inline">${t('detail.priority')}</span>` : ''}</span></div>`;
        // Composite world::uid identity — bare uid collides across books
        // (entry's own card hidden, real same-uid peer in another book missed).
        const ownKey = entryKey(entry);
        const groupPeers = (state.groupMetadata.get(entry.group) || []).filter(e => entryKey(e) !== ownKey);
        if (groupPeers.length > 0) {
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.groupMembers')}</span><div class="env-group-peers">`;
            for (const peer of groupPeers) {
                html += `<span class="env-group-peer"><span class="env-group-peer__name">${escapeHtml(peer.title)}</span><span class="env-group-peer__weight">${t('detail.weightShort', { count: peer.groupWeight || 100 })}</span></span>`;
            }
            html += `</div></div>`;
        }
    }

    // Selective logic + evaluation.
    if (entry.selectiveLogic !== undefined) {
        html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.logic')}</span><span class="env-detail__value">${LOGIC_NAMES[entry.selectiveLogic] || entry.selectiveLogic}</span></div>`;
        if (entry.matchedKeys?.logicResult) {
            const lr = entry.matchedKeys.logicResult;
            const statusClass = lr.satisfied ? 'env-logic--satisfied' : 'env-logic--unsatisfied';
            const statusIcon = lr.satisfied ? '✓' : '✗';
            html += `<div class="env-detail__section env-detail__section--full">`;
            html += `<span class="env-detail__label">${t('detail.reconstructedLogic')}</span>`;
            html += `<span class="env-logic-status ${statusClass}"><span class="env-logic-status__icon">${statusIcon}</span> ${escapeHtml(lr.explanation)}</span>`;
            html += `</div>`;
        }
    }

    const recursionFlags = [];
    if (entry.preventRecursion) recursionFlags.push(t('detail.recursePrevent'));
    if (entry.excludeRecursion) recursionFlags.push(t('detail.recurseExclude'));
    if (entry.delayUntilRecursion) recursionFlags.push(t('detail.recurseDelay', { count: entry.delayUntilRecursion }));
    if (recursionFlags.length > 0) html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.recursion')}</span><span class="env-detail__value">${recursionFlags.join(', ')}</span></div>`;

    if (entry.characterFilter) {
        const cf = entry.characterFilter;
        const names = cf.names || [];
        const tags = cf.tags || [];
        const parts = [...names.map(n => escapeHtml(n)), ...tags.map(t => `#${escapeHtml(t)}`)];
        if (parts.length > 0) {
            const mode = cf.isExclude ? t('detail.filterExclude') : t('detail.filterOnly');
            html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.charFilter')}</span><span class="env-detail__value">${mode}: ${parts.join(', ')}</span></div>`;
        }
    }

    if (entry.triggers && entry.triggers.length > 0) {
        html += `<div class="env-detail__section"><span class="env-detail__label">${t('detail.triggers')}</span><span class="env-detail__value">${entry.triggers.map(trigger => escapeHtml(trigger)).join(', ')}</span></div>`;
    }

    const warnings = computeWarnings(entry);
    if (warnings.length > 0) {
        html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.warnings')}</span><div class="env-detail__warnings">`;
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
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.sourceScan')}</span><div class="env-source-grid">`;
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
                for (const k of potential) html += `<span class="env-key env-key--potential" title="${t('detail.potentialTitle')}">⚠ ${escapeHtml(k)}</span>`;
                if (actual.length === 0 && potential.length === 0 && isScanning) html += `<span class="env-source-grid__none">${t('detail.noKeys')}</span>`;
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }
    }

    html += renderKeyDropdown(t('detail.primaryKeys'), entry.keys, '');
    html += renderKeyDropdown(t('detail.secondaryKeys'), entry.secondaryKeys, 'env-key--secondary');

    if (entry.matchedKeys) {
        const mk = entry.matchedKeys;
        if (mk.reason) html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.explanation')}</span><span class="env-detail__match-reason">${escapeHtml(mk.reason)}</span></div>`;

        if (mk.matchStrength && (mk.matchStrength.primaryTotal > 0 || mk.matchStrength.secondaryTotal > 0)) {
            const ms = mk.matchStrength;
            const total = ms.primaryTotal + ms.secondaryTotal;
            const hits = ms.primaryHit + ms.secondaryHit;
            const pct = total > 0 ? Math.round((hits / total) * 100) : 0;
            const barColor = pct >= 80 ? '#10b981' : (pct >= 40 ? '#f59e0b' : '#ef4444');
            html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.keyCoverage')}</span><div class="env-match-strength"><div class="env-match-strength__bar"><div class="env-match-strength__fill" style="width:${pct}%;background:${barColor}"></div></div><span class="env-match-strength__label">${t('detail.keyStats', { hits, total, sources: ms.sourceCount })}</span></div></div>`;
        }
    }

    // Lazy expand for long content; data-key is composite world::uid so
    // the click handler picks the right book's content.
    if (entry.content) {
        const CONTENT_PREVIEW_LEN = 300;
        const isLong = entry.content.length > CONTENT_PREVIEW_LEN;
        const preview = isLong ? entry.content.substring(0, CONTENT_PREVIEW_LEN) : entry.content;
        const key = entryKey(entry);
        html += `<div class="env-detail__section env-detail__section--full"><span class="env-detail__label">${t('detail.content')}</span>`;
        html += `<div class="env-detail__content" data-full-len="${entry.content.length}">`;
        html += `<span class="env-detail__content-text">${escapeHtml(preview)}${isLong ? '…' : ''}</span>`;
        if (isLong) html += `<button type="button" class="env-detail__content-expand" data-key="${escapeHtml(key)}">${t('detail.showAll', { count: entry.content.length })}</button>`;
        html += `</div></div>`;
    }

    html += `</div>`;
    return html;
}

function renderRemovedEntry(entry) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const key = entryKey(entry);
    return `<div class="env-entry env-entry--removed" data-trigger="${entry.triggerType}" data-key="${escapeHtml(key)}" style="--trigger-color:${tt.color}"><div class="env-entry__row"><span class="env-entry__diff-badge env-entry__diff-badge--removed">${t('badge.out')}</span><span class="env-entry__icon">${tt.icon}</span><span class="env-entry__title">${escapeHtml(entry.title)}</span><span class="env-entry__tokens">${entry.estimatedTokens}t</span></div></div>`;
}
