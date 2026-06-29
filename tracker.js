// ⊹ ACE ENTRY TRACK ⊹ — tracker.js
// Orchestrator: event wiring, lifecycle. All logic in core/* and ui/*.

import { addDiscoveredLorebook, getScannerState, refreshDiscovery } from './scanner.js';
import { log } from './utils/log.js';
import { entryKey } from './utils/ids.js';
import { state, computeDiff, resetState } from './core/state.js';
import { processEntry } from './core/processor.js';
import { findMatchedKeys, resolveRecursiveMatches } from './core/matching.js';
import { evaluateAccuracy } from './core/self-test.js';
import { initTriggerButton, updateBadge, setButtonVisible, closePanel, clearWIHighlights } from './ui/trigger-button.js';
import { initPanel, renderPanel, detachPanelGlobals } from './ui/panel.js';

let _getSettings;

// Generation counter: stale async results from a prior turn are discarded.
let _activationGeneration = 0;

// ST's WORLD_INFO_ACTIVATED only fires for scan-pipeline entries; many ST
// versions insert constants directly without firing the event. We merge
// them in by reading raw lorebook data here, cached briefly.
const _lorebookCache = new Map(); // name → { data, at: timestamp }
const _LOREBOOK_TTL_MS = 10_000;
const _LOREBOOK_CACHE_MAX = 32;
const _CONSTANT_PROCESS_CONCURRENCY = 8;
const _MAX_MERGED_CONSTANTS = 1000;

// Debounced "surface constants" timer; cancelled on chat-change storms.
let _constantsTimer = null;

function isEnabled() {
    const s = _getSettings?.();
    return !s || s.enabled !== false;
}

/** Drop expired entries; LRU-evict if over cap. */
function _pruneLorebookCache() {
    const now = Date.now();
    for (const [k, v] of _lorebookCache) {
        if ((now - v.at) >= _LOREBOOK_TTL_MS) _lorebookCache.delete(k);
    }
    while (_lorebookCache.size > _LOREBOOK_CACHE_MAX) {
        // Map preserves insertion order; first key is the oldest.
        const oldest = _lorebookCache.keys().next().value;
        if (oldest === undefined) break;
        _lorebookCache.delete(oldest);
    }
}

/** Load a lorebook through ST's loader; memoized with a short TTL. */
async function loadLorebookCached(name) {
    const hit = _lorebookCache.get(name);
    const now = Date.now();
    if (hit && (now - hit.at) < _LOREBOOK_TTL_MS) return hit.data;
    try {
        const ctx = SillyTavern.getContext();
        const loadFn = ctx.loadWorldInfo;
        if (typeof loadFn !== 'function') return null;
        const data = await loadFn(name);
        _lorebookCache.set(name, { data, at: now });
        _pruneLorebookCache();
        return data;
    } catch (e) {
        log.debug('loadLorebookCached failed for', name, ':', e?.message);
        return null;
    }
}

// Entry visibility under its characterFilter (names + tags).
// Fail-open: uncertainty shows the entry so a real constant is never hidden.
function passesCharacterFilter(rawEntry) {
    const cf = rawEntry.characterFilter;
    if (!cf || typeof cf !== 'object') return true;

    const names = Array.isArray(cf.names) ? cf.names : [];
    const tags = Array.isArray(cf.tags) ? cf.tags : [];
    if (names.length === 0 && tags.length === 0) return true;

    const isExclude = !!cf.isExclude;

    try {
        const ctx = SillyTavern.getContext();
        const charId = ctx.characterId;
        const character = charId !== undefined ? ctx.characters?.[charId] : null;
        if (!character) return true;

        // Names: matched against the char display name.
        if (names.length > 0) {
            const charName = character.name;
            if (charName) {
                const listed = names.includes(charName);
                if (isExclude ? listed : !listed) return false;
            }
        }

        // Tags: cf.tags (tag IDs) vs the char's IDs in tagMap[avatar].
        // String-compared since IDs vary string/number across versions.
        if (tags.length > 0) {
            const tagKey = character.avatar;
            const tagMapEntry = tagKey ? ctx.tagMap?.[tagKey] : null;
            if (Array.isArray(tagMapEntry)) {
                const filterTagIds = new Set(tags.map(t => String(t)));
                const includesTag = tagMapEntry.some(t => filterTagIds.has(String(t)));
                if (isExclude ? includesTag : !includesTag) return false;
            }
        }

        return true;
    } catch {
        return true;
    }
}

/** Run async fn over items with a fixed concurrency window. */
async function _mapPool(items, limit, fn) {
    const out = [];
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            try { out[idx] = await fn(items[idx]); }
            catch (e) { out[idx] = { __err: e }; }
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * Merge in constants ST didn't surface via WORLD_INFO_ACTIVATED.
 * De-dup key is composite world::uid. Books are loaded in parallel and
 * candidate constants are processed via a bounded concurrency pool.
 */
async function mergeMissingConstants(processed) {
    const books = getScannerState().availableLorebooks || [];
    if (books.length === 0) return processed;

    const seen = new Set(processed.map(entryKey));

    // Load every book in parallel.
    const bookDataList = await Promise.all(books.map(async book => {
        const name = typeof book === 'string' ? book : book?.name;
        if (!name) return null;
        const data = await loadLorebookCached(name);
        return data ? { name, data } : null;
    }));

    // Collect candidates (cheap, sync).
    const candidates = [];
    for (const item of bookDataList) {
        if (!item || !item.data?.entries) continue;
        const { name, data } = item;
        const entries = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
        for (const raw of entries) {
            if (!raw || typeof raw !== 'object') continue;
            if (raw.constant !== true) continue;
            if (raw.disable === true) continue;
            if (!passesCharacterFilter(raw)) continue;

            // Clone before adding `world` — never mutate the cached lorebook
            // payload, which ST may share with its own pipeline.
            const enriched = raw.world ? raw : { ...raw, world: name };
            const dedupKey = entryKey(enriched);
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);
            candidates.push(enriched);

            if (candidates.length >= _MAX_MERGED_CONSTANTS) {
                log.warn(`Hit _MAX_MERGED_CONSTANTS (${_MAX_MERGED_CONSTANTS}); skipping the rest`);
                break;
            }
        }
        if (candidates.length >= _MAX_MERGED_CONSTANTS) break;
    }

    if (candidates.length === 0) return processed;

    const settled = await _mapPool(candidates, _CONSTANT_PROCESS_CONCURRENCY, processEntry);
    const extras = [];
    for (const r of settled) {
        if (r && r.__err) log.debug('processEntry failed for merged constant:', r.__err?.message);
        else if (r) extras.push(r);
    }

    return [...processed, ...extras];
}

export function initTracker(getSettingsFn, _saveFn) {
    _getSettings = getSettingsFn;

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => scheduleConstantsRefresh(100));
    }

    // Lorebook edits invalidate cached payloads.
    if (event_types.WORLDINFO_UPDATED) {
        eventSource.on(event_types.WORLDINFO_UPDATED, () => _lorebookCache.clear());
    }
    if (event_types.WORLDINFO_SETTINGS_UPDATED) {
        eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, () => _lorebookCache.clear());
    }

    initTriggerButton(getSettingsFn);
    initPanel(getSettingsFn, _saveFn, reEvaluate);

    if (!isEnabled()) log.info('Disabled via settings, tracker UI hidden');
    log.info('Tracker initialized');
}

/** Debounce constant-surfacing across chat-change storms. */
function scheduleConstantsRefresh(delayMs) {
    if (_constantsTimer !== null) clearTimeout(_constantsTimer);
    _constantsTimer = setTimeout(() => {
        _constantsTimer = null;
        surfaceConstantsOnly();
    }, delayMs);
}

/**
 * Rebuild the constant-entry subset in currentEntries. Used on chat load
 * and post-generation; also drops stale constants that ST removed.
 */
async function surfaceConstantsOnly() {
    if (!isEnabled()) return;
    const gen = ++_activationGeneration;

    const t0 = performance.now();

    // Strip any prior constant entries so removed ones don't persist.
    const nonConstants = state.currentEntries.filter(e => !(e.constant || e.triggerType === 'constant'));
    const merged = await mergeMissingConstants(nonConstants);

    if (gen !== _activationGeneration) return;
    if (merged.length === state.currentEntries.length
        && merged.every((e, i) => entryKey(e) === entryKey(state.currentEntries[i]))) return;

    const elapsed = Math.round(performance.now() - t0);

    resolveRecursiveMatches(merged);
    state.selfTest = evaluateAccuracy(merged);
    computeDiff(merged);
    state.currentEntries = merged;
    state.lastUpdate = Date.now();
    state.lastProcessingMs = elapsed;

    log.info(`Surfaced constants (${merged.length} total entries, ${elapsed}ms)`);
    updateBadge();
    renderPanel();
}

// ── Event Handlers ──

async function onWorldInfoActivated(entryList) {
    if (!isEnabled()) return;

    const gen = ++_activationGeneration;
    const t0 = performance.now();

    const safeList = Array.isArray(entryList) ? entryList : [];
    const results = await Promise.allSettled(safeList.map(entry => processEntry(entry)));

    if (gen !== _activationGeneration) return;

    // Auto-discovery is gated by the race check — otherwise a stale
    // activation (chat-changed mid-flight) would leak old lorebook names.
    const knownBookNames = new Set(getScannerState().availableLorebooks.map(b => b.name));
    for (const entry of safeList) {
        if (entry.world && typeof entry.world === 'string' && !knownBookNames.has(entry.world)) {
            addDiscoveredLorebook(entry.world);
        }
    }

    const scanActivated = [];
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') scanActivated.push(results[i].value);
        else log.warn('Failed to process entry', safeList[i]?.uid, ':', results[i].reason);
    }

    let processed = await mergeMissingConstants(scanActivated);
    if (gen !== _activationGeneration) return;

    const elapsed = Math.round(performance.now() - t0);

    resolveRecursiveMatches(processed);
    state.selfTest = evaluateAccuracy(processed);

    computeDiff(processed);
    state.currentEntries = processed;
    state.lastUpdate = Date.now();
    state.lastProcessingMs = elapsed;

    // Re-check gen before each side-effect: chat could have switched again.
    if (gen !== _activationGeneration) return;
    refreshDiscovery();

    const constants = processed.filter(e => e.constant || e.triggerType === 'constant');
    const worlds = [...new Set(processed.map(e => e.world).filter(Boolean))];

    // One concise line per generation; details gated behind verbose.
    const acc = state.selfTest ? ` · ${state.selfTest.accuracy}% acc` : '';
    const diff = (state.newUids.size || state.removedEntries.length)
        ? ` · +${state.newUids.size}/−${state.removedEntries.length}` : '';
    log.summary(`${processed.length} entries · ${constants.length} const · ${elapsed}ms${acc}${diff}`);

    log.info(`activated: ${scanActivated.length} scanned + ${processed.length - scanActivated.length} merged from [${worlds.join(', ')}]`);
    if (state.selfTest) {
        log.info(`self-test: ${state.selfTest.match} match · ${state.selfTest.explained} explained · ${state.selfTest.recursive} recursive · ${state.selfTest.unresolved} unresolved`);
    }

    if (gen !== _activationGeneration) return;
    updateBadge();
    renderPanel();
}

function onChatChanged() {
    if (_constantsTimer !== null) { clearTimeout(_constantsTimer); _constantsTimer = null; }
    _activationGeneration++;
    _lorebookCache.clear();

    if (!isEnabled()) return;
    resetState();
    updateBadge();
    renderPanel();

    // Surface constants once chat settles (handles ST builds that don't
    // fire WORLD_INFO_ACTIVATED on a quiet scan pipeline).
    scheduleConstantsRefresh(500);
}

// ── Re-evaluate ──
// Re-runs findMatchedKeys against the current context for all entries.
// Does NOT re-fetch from ST — only re-matches. Useful when persona,
// character card, or AN changed between generations.

async function reEvaluate() {
    if (!isEnabled() || state.currentEntries.length === 0) return;
    log.info('Re-evaluating entries against current context...');
    const t0 = performance.now();
    for (const entry of state.currentEntries) {
        entry.matchedKeys = findMatchedKeys(entry);
    }
    resolveRecursiveMatches(state.currentEntries);
    state.selfTest = evaluateAccuracy(state.currentEntries);
    state.lastProcessingMs = Math.round(performance.now() - t0);
    log.info(`Re-evaluated ${state.currentEntries.length} entries in ${state.lastProcessingMs}ms (accuracy: ${state.selfTest?.accuracy}%)`);
    renderPanel();
}

// ── Public API ──

export function setEnabled(enabled) {
    setButtonVisible(enabled);

    if (!enabled) {
        // Cancel in-flight work: bump generation so any pending async
        // gen-check short-circuits before writing state.
        _activationGeneration++;
        if (_constantsTimer !== null) { clearTimeout(_constantsTimer); _constantsTimer = null; }
        _lorebookCache.clear();
        if (state.panelOpen) closePanel();
        clearWIHighlights();
        detachPanelGlobals();
        resetState();
        updateBadge();
        renderPanel();
    }
}

export function getTrackerState() {
    return state;
}
