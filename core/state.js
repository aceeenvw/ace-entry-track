// ⊹ ACE ENTRY TRACK ⊹ — core/state.js
// Centralized state: diff, sorting, filtering, native scan summary.

import { SORT_OPTIONS } from './processor.js';
import { entryKey } from '../utils/ids.js';

// ── State ──

export const state = {
    currentEntries: [],
    previousEntries: [],
    panelOpen: false,
    lastUpdate: null,
    lastProcessingMs: null,
    expandedUids: new Set(),
    newUids: new Set(),
    removedEntries: [],
    // Filter state — runtime only, not persisted.
    triggerFilter: new Set(),
    searchQuery: '',
    highlightKeyFilter: null,
    // Map<entryKey, boolean[]> of last N activation flags per entry.
    activationHistory: new Map(),
    generationCount: 0,
    contextPreviewOpen: false,
    contextSourcesOpen: new Set(),
    // Explanation coverage for the latest native activation list.
    explanationCoverage: null,
    // Native WORLDINFO_SCAN_DONE summary for the latest generation.
    scanSummary: null,
    // Map<groupName, entry[]> built once per committed result.
    groupMetadata: new Map(),
};

// ── Diff ──

const MAX_HISTORY = 12;
const MAX_HISTORY_KEYS = 5000;

export function computeDiff(newEntries) {
    // Identity uses composite world::uid (bare uids collide across books).
    const oldKeys = new Set(state.currentEntries.map(entryKey));
    const newKeySet = new Set(newEntries.map(entryKey));

    state.newUids = new Set();
    for (const key of newKeySet) {
        if (!oldKeys.has(key)) state.newUids.add(key);
    }

    state.removedEntries = [];
    for (const entry of state.currentEntries) {
        if (!newKeySet.has(entryKey(entry))) state.removedEntries.push(entry);
    }

    state.previousEntries = [...state.currentEntries];

    // ── Sparkline history ──
    state.generationCount++;
    const allKnown = new Set([...state.activationHistory.keys(), ...newKeySet]);
    for (const key of allKnown) {
        if (!state.activationHistory.has(key)) state.activationHistory.set(key, []);
        const hist = state.activationHistory.get(key);
        hist.push(newKeySet.has(key));
        if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
    }

    // Eviction pass 1: drop entries dormant for the full window.
    for (const [key, hist] of state.activationHistory) {
        if (hist.length >= MAX_HISTORY && !hist.some(Boolean)) {
            state.activationHistory.delete(key);
        }
    }

    // Eviction pass 2: absolute size cap. Map preserves insertion order,
    // so the oldest entries (by first-seen) are at the front. Drops apply
    // even when entries are still occasionally active — necessary under
    // uid-rotation churn that defeats pass-1 dormancy.
    if (state.activationHistory.size > MAX_HISTORY_KEYS) {
        const excess = state.activationHistory.size - MAX_HISTORY_KEYS;
        let i = 0;
        for (const key of state.activationHistory.keys()) {
            if (i++ >= excess) break;
            state.activationHistory.delete(key);
        }
    }
}

export function computeGroupMetadata(entries) {
    const groups = new Map();
    for (const entry of entries) {
        if (!entry.group) continue;
        if (!groups.has(entry.group)) groups.set(entry.group, []);
        groups.get(entry.group).push(entry);
    }
    state.groupMetadata = groups;
}

// ── Sort Logic ──

export function sortEntries(entries, getSettingsFn) {
    const settings = getSettingsFn();
    const sortBy = settings.sortBy || 'order';
    const sortOrder = settings.sortOrder || 'asc';
    const dir = sortOrder === 'asc' ? 1 : -1;

    const sorted = [...entries];
    sorted.sort((a, b) => {
        let cmp = 0;
        switch (sortBy) {
            case 'order':   cmp = (a.order || 0) - (b.order || 0); break;
            case 'tokens':  cmp = a.estimatedTokens - b.estimatedTokens; break;
            case 'name':    cmp = (a.title || '').localeCompare(b.title || ''); break;
            case 'trigger': cmp = (a.triggerType || '').localeCompare(b.triggerType || ''); break;
            default:        cmp = (a.order || 0) - (b.order || 0);
        }
        return cmp * dir;
    });
    return sorted;
}

export function cycleSortBy(getSettingsFn, saveFn) {
    const settings = getSettingsFn();
    const keys = Object.keys(SORT_OPTIONS);
    const idx = keys.indexOf(settings.sortBy || 'order');
    settings.sortBy = keys[(idx + 1) % keys.length];
    saveFn();
}

export function toggleSortOrder(getSettingsFn, saveFn) {
    const settings = getSettingsFn();
    settings.sortOrder = settings.sortOrder === 'asc' ? 'desc' : 'asc';
    saveFn();
}

// ── Filtering ──

export function applyFilters(entries) {
    let filtered = entries;

    if (state.triggerFilter.size > 0) {
        filtered = filtered.filter(e => state.triggerFilter.has(e.triggerType));
    }

    if (state.searchQuery && typeof state.searchQuery === 'string') {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(e => {
            if (e.title && e.title.toLowerCase().includes(q)) return true;
            if ((e.keys || []).some(k => k.toLowerCase().includes(q))) return true;
            if ((e.secondaryKeys || []).some(k => k.toLowerCase().includes(q))) return true;
            if (e.world && e.world.toLowerCase().includes(q)) return true;
            return false;
        });
    }

    // Highlight click filter must include `potential` matches and declared
    // keys, otherwise clicking a key over an unscanned source would empty
    // the list (no entry would have a real match for it).
    if (state.highlightKeyFilter) {
        const key = state.highlightKeyFilter;
        filtered = filtered.filter(e => {
            const mk = e.matchedKeys;
            if (!mk) return false;
            const all = [...(mk.primary || []), ...(mk.secondary || []), ...(mk.potential || [])];
            if (all.some(m => m.key === key)) return true;
            if ((e.keys || []).includes(key)) return true;
            if ((e.secondaryKeys || []).includes(key)) return true;
            return false;
        });
    }

    return filtered;
}

// ── Reset ──

export function resetState() {
    state.currentEntries = [];
    state.previousEntries = [];
    state.expandedUids.clear();
    state.newUids.clear();
    state.removedEntries = [];
    state.lastUpdate = null;
    state.lastProcessingMs = null;
    state.activationHistory.clear();
    state.generationCount = 0;
    state.triggerFilter.clear();
    state.searchQuery = '';
    state.highlightKeyFilter = null;
    state.contextPreviewOpen = false;
    state.contextSourcesOpen = new Set();
    state.explanationCoverage = null;
    state.scanSummary = null;
    state.groupMetadata = new Map();
}

/**
 * Activation history for sparkline rendering.
 * Takes a composite world::uid key (NOT a bare uid).
 */
export function getActivationHistory(key) {
    return state.activationHistory.get(String(key)) || [];
}
