// ⊹ ACE ENTRY TRACK ⊹ — tracker.js
// Stage 6: entry display, diff tracking, sort controls, budget bar,
//          MATCHED redesign (grouped-by-source), trigger filter, search filter,
//          key matching fixes (per-entry scan flags, substituteParams, multi-source),
//          FIX: Include name prefixes in chat scan buffer (matching ST behavior),
//          FIX: Respect global WI settings (matchWholeWords, caseSensitive, scanDepth)

import { addDiscoveredLorebook, getScannerState, refreshDiscovery } from './scanner.js';
import { ICONS } from './icons.js';

const MODULE_NAME = 'ace-entry-track';

let _getSettings;
let _saveSettingsDebounced;

function isEnabled() {
    const s = _getSettings?.();
    return !s || s.enabled !== false;
}

const POSITION_NAMES = {
    0: 'Before Char',
    1: 'After Char',
    2: 'AN Top',
    3: 'AN Bottom',
    4: 'At Depth',
    5: 'Ext Top',
    6: 'Ext Bottom',
};

const TRIGGER_TYPES = {
    constant:   { icon: ICONS.constant, label: 'CONSTANT',   color: '#6366f1', desc: 'Always active — never requires keyword match' },
    vector:     { icon: ICONS.vector, label: 'VECTOR',     color: '#8b5cf6', desc: 'Activated via RAG/vector similarity search' },
    sticky:     { icon: ICONS.sticky, label: 'STICKY',     color: '#ef4444', desc: 'Remains active for N turns after triggering' },
    forced:     { icon: ICONS.forced, label: 'FORCED',     color: '#f59e0b', desc: 'Force-activated by @@activate decorator' },
    suppressed: { icon: ICONS.suppressed, label: 'SUPPRESSED', color: '#64748b', desc: 'Blocked by @@dontactivate decorator' },
    persona:    { icon: ICONS.persona, label: 'PERSONA',    color: '#d946ef', desc: 'Matched keywords in user persona' },
    character:  { icon: ICONS.character, label: 'CHARACTER',  color: '#f59e0b', desc: 'Matched keywords in character card' },
    scenario:   { icon: ICONS.scenario, label: 'SCENARIO',   color: '#84cc16', desc: 'Matched keywords in scenario text' },
    normal:     { icon: ICONS.normal, label: 'KEY MATCH',  color: '#10b981', desc: 'Activated by keyword match in chat' },
};

// ── Source colors for MATCHED redesign ──
const SOURCE_COLORS = {
    chat:      { color: '#10b981', label: 'Chat',      desc: 'Matched in recent chat messages' },
    character: { color: '#f59e0b', label: 'Character',  desc: 'Matched in character description/personality' },
    scenario:  { color: '#3b82f6', label: 'Scenario',   desc: 'Matched in scenario text' },
    persona:   { color: '#a855f7', label: 'Persona',    desc: 'Matched in user persona description' },
    AN:        { color: '#64748b', label: 'AN',          desc: 'Matched in Author\'s Note' },
};

const SORT_OPTIONS = {
    order:   { label: 'Order',   icon: ICONS.sort_order },
    tokens:  { label: 'Tokens',  icon: ICONS.sort_tokens },
    name:    { label: 'Name',    icon: ICONS.sort_name },
    trigger: { label: 'Trigger', icon: ICONS.sort_trigger },
};

const LOGIC_NAMES = {
    0: 'AND ANY',
    1: 'NOT ALL',
    2: 'NOT ANY',
    3: 'AND ALL',
};

const state = {
    currentEntries: [],
    previousEntries: [],
    panelOpen: false,
    lastUpdate: null,
    expandedUids: new Set(),
    newUids: new Set(),
    removedEntries: [],
    // Filter state (not persisted — resets on reload)
    triggerFilter: new Set(),   // empty = show all; otherwise only show these types
    searchQuery: '',            // text filter for entry names/keys
};

export function initTracker(getSettingsFn, saveFn) {
    _getSettings = getSettingsFn;
    _saveSettingsDebounced = saveFn;

    // Always subscribe to events and create UI elements so setEnabled()
    // can toggle visibility without needing to re-initialize.
    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    createTriggerButton();
    createPanel();

    if (!isEnabled()) {
        console.log('[ACE ENTRY TRACK] Disabled via settings, tracker UI hidden');
    }

    console.log(`[${MODULE_NAME}] Tracker initialized`);
}

// ── Event Handlers ──

async function onWorldInfoActivated(entryList) {
    if (!isEnabled()) return;
    if (!entryList || entryList.length === 0) {
        computeDiff([]);
        state.currentEntries = [];
        updateBadge();
        renderPanel();
        return;
    }

    const knownBooks = new Set(getScannerState().availableLorebooks);
    for (const entry of entryList) {
        if (entry.world && !knownBooks.has(entry.world)) {
            addDiscoveredLorebook(entry.world);
            console.log(`[${MODULE_NAME}] Auto-discovered lorebook: ${entry.world}`);
        }
    }

    const processed = await Promise.all(entryList.map(entry => processEntry(entry)));
    computeDiff(processed);
    state.currentEntries = processed;
    state.lastUpdate = Date.now();

    // Re-discover lorebooks in case charLore changed silently
    refreshDiscovery();

    console.log(`[${MODULE_NAME}] WORLD_INFO_ACTIVATED: ${entryList.length} entries from [${[...new Set(entryList.map(e => e.world))].join(', ')}]`);
    if (state.newUids.size > 0 || state.removedEntries.length > 0) {
        console.log(`[${MODULE_NAME}] Diff: +${state.newUids.size} new, −${state.removedEntries.length} removed`);
    }

    updateBadge();
    renderPanel();
}

function onChatChanged() {
    if (!isEnabled()) return;
    state.currentEntries = [];
    state.previousEntries = [];
    state.expandedUids.clear();
    state.newUids.clear();
    state.removedEntries = [];
    updateBadge();
    renderPanel();
}

// ── Diff Logic ──

function computeDiff(newEntries) {
    const oldUids = new Set(state.currentEntries.map(e => String(e.uid)));
    const newUidSet = new Set(newEntries.map(e => String(e.uid)));

    state.newUids = new Set();
    for (const uid of newUidSet) {
        if (!oldUids.has(uid)) {
            state.newUids.add(uid);
        }
    }

    state.removedEntries = [];
    for (const entry of state.currentEntries) {
        if (!newUidSet.has(String(entry.uid))) {
            state.removedEntries.push(entry);
        }
    }

    state.previousEntries = [...state.currentEntries];
}

// ── Sort Logic ──

function sortEntries(entries) {
    const settings = _getSettings();
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

function cycleSortBy() {
    const settings = _getSettings();
    const keys = Object.keys(SORT_OPTIONS);
    const idx = keys.indexOf(settings.sortBy || 'order');
    settings.sortBy = keys[(idx + 1) % keys.length];
    _saveSettingsDebounced();
    renderPanel();
}

function toggleSortOrder() {
    const settings = _getSettings();
    settings.sortOrder = settings.sortOrder === 'asc' ? 'desc' : 'asc';
    _saveSettingsDebounced();
    renderPanel();
}

// ── Budget Logic ──

function computeBudgetOverflow(sortedEntries, budget) {
    if (!budget || budget <= 0) {
        return {
            withinBudget: sortedEntries,
            overflow: [],
            usedTokens: sortedEntries.reduce((s, e) => s + e.estimatedTokens, 0),
        };
    }
    let running = 0;
    const withinBudget = [];
    const overflow = [];
    for (const entry of sortedEntries) {
        running += entry.estimatedTokens;
        if (running <= budget) {
            withinBudget.push(entry);
        } else {
            overflow.push(entry);
        }
    }
    return { withinBudget, overflow, usedTokens: running };
}

// ── Global WI Settings Reader ──
// ST's global WI settings (scan depth, include names, match whole words, case sensitive)
// are module-level variables in world-info.js — not directly accessible via ctx.
// We read them from the DOM checkboxes that ST renders, which reflect the live values.

function getWIGlobalSettings() {
    const defaults = {
        scanDepth: 2,
        includeNames: true,
        caseSensitive: false,
        matchWholeWords: false,
    };

    try {
        // Read from ST's WI settings DOM elements
        const depthEl = document.getElementById('world_info_depth');
        if (depthEl) {
            const val = Number(depthEl.value);
            if (val > 0) defaults.scanDepth = val;
        }

        const includeNamesEl = document.getElementById('world_info_include_names');
        if (includeNamesEl) {
            defaults.includeNames = !!includeNamesEl.checked;
        }

        const caseSensitiveEl = document.getElementById('world_info_case_sensitive');
        if (caseSensitiveEl) {
            defaults.caseSensitive = !!caseSensitiveEl.checked;
        }

        const matchWholeWordsEl = document.getElementById('world_info_match_whole_words');
        if (matchWholeWordsEl) {
            defaults.matchWholeWords = !!matchWholeWordsEl.checked;
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Could not read WI global settings from DOM:`, e);
    }

    return defaults;
}

// ── Key Matching (Fixed: per-entry scan flags, multi-source, substituteParams, name prefixes) ──

/**
 * Resolve macros like {{user}}, {{char}} in a key string.
 * Falls back to returning the original key if substituteParams is unavailable.
 */
function resolveKeyMacros(key) {
    try {
        const ctx = SillyTavern.getContext();
        // substituteParams is a global in ST — try to access it
        if (typeof ctx.substituteParams === 'function') {
            return ctx.substituteParams(key);
        }
        // Fallback: try the global function directly
        if (typeof window.substituteParams === 'function') {
            return window.substituteParams(key);
        }
    } catch { /* non-fatal */ }
    return key;
}

/**
 * Parse a regex key string like /pattern/flags into a RegExp.
 * Mirrors ST's parseRegexFromString behavior.
 */
function parseRegexKey(input) {
    const match = input.match(/^\/(.+?)\/([gimsuy]*)$/);
    if (!match) return null;

    let [, pattern, flags] = match;

    // Reject unescaped slash delimiters inside pattern
    if (pattern.match(/(^|[^\\])\//)) return null;

    // Unescape slash delimiters (all occurrences)
    pattern = pattern.replaceAll('\\/', '/');

    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

/**
 * Match a single key against a text string.
 * Mirrors ST's WorldInfoBuffer.matchKeys logic:
 * - Regex keys: test directly
 * - Plain text, matchWholeWords + multi-word: includes()
 * - Plain text, matchWholeWords + single-word: \W boundary regex
 * - Plain text, no matchWholeWords: includes()
 */
function matchKeyInText(key, text, caseSensitive, matchWholeWords) {
    // Resolve macros first
    const resolvedKey = resolveKeyMacros(key);
    if (!resolvedKey || !resolvedKey.trim()) return false;
    const trimmedKey = resolvedKey.trim();

    // Try regex
    const keyRegex = parseRegexKey(trimmedKey);
    if (keyRegex) {
        return keyRegex.test(text);
    }

    // Plain text matching
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? trimmedKey : trimmedKey.toLowerCase();

    if (matchWholeWords) {
        const words = needle.split(/\s+/);
        if (words.length > 1) {
            // Multi-word: simple includes
            return haystack.includes(needle);
        } else {
            // Single-word: \W boundary (matches ST behavior, not \b)
            const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`);
            return regex.test(haystack);
        }
    } else {
        return haystack.includes(needle);
    }
}

/**
 * Build per-entry source list based on the entry's own scan flags.
 * Fix #2: Only scan sources the entry opts into, matching ST's WorldInfoBuffer.get() logic.
 * Chat messages are always scanned (they're the base depthBuffer).
 * Additional sources only if the entry's boolean flags are set.
 *
 * FIX: Now includes speaker name prefixes in chat text to match ST's scan buffer.
 * ST prepends "CharName: " to each message when world_info_include_names is enabled (default).
 */
function buildSourcesForEntry(entry) {
    const ctx = SillyTavern.getContext();
    const charId = ctx.characterId;
    const charData = charId !== undefined ? ctx.characters?.[charId]?.data : null;
    const wiSettings = getWIGlobalSettings();

    const sources = [];

    // Chat messages — always included (this is the depthBuffer base in ST)
    const chat = ctx.chat || [];
    // Use entry's scanDepth, fall back to global WI depth setting
    let depth = entry.scanDepth;
    if (depth === null || depth === undefined) {
        depth = wiSettings.scanDepth;
    }
    if (!depth || depth <= 0) depth = 10; // safety fallback

    const recent = chat.slice(-depth);

    // Build chat text — include name prefixes if ST's "Include Names" is enabled
    const chatText = recent.map(m => {
        const msg = m.mes || '';
        if (wiSettings.includeNames && m.name) {
            return `${m.name}: ${msg}`;
        }
        return msg;
    }).join('\n');

    if (chatText) sources.push({ label: 'chat', text: chatText });

    // Character description + personality — only if entry opts in
    if (entry.matchCharacterDescription || entry.matchCharacterPersonality) {
        const parts = [];
        if (entry.matchCharacterDescription && charData?.description) parts.push(charData.description);
        if (entry.matchCharacterPersonality && charData?.personality) parts.push(charData.personality);
        const charDesc = parts.filter(Boolean).join('\n');
        if (charDesc) sources.push({ label: 'character', text: charDesc });
    }

    // Scenario — only if entry opts in
    if (entry.matchScenario && charData?.scenario) {
        sources.push({ label: 'scenario', text: charData.scenario });
    }

    // Persona — only if entry opts in
    if (entry.matchPersonaDescription) {
        let persona = '';
        try {
            persona = ctx.persona?.description || '';
            if (!persona && typeof ctx.persona === 'string') persona = ctx.persona;
        } catch { /* non-fatal */ }
        if (persona && typeof persona === 'string' && persona.trim()) {
            sources.push({ label: 'persona', text: persona });
        }
    }

    // Author's Note — always included (it's part of the inject buffer in ST)
    const anText = ctx.extensionPrompts?.['2_floating_prompt']?.value;
    if (anText) sources.push({ label: 'AN', text: anText });

    return sources;
}

/**
 * Test a set of keys against sources. Returns ALL matches across ALL sources per key.
 * Fix #3: Don't break on first source — report every source where each key matches.
 */
function testKeysAllSources(keys, sources, caseSensitive, matchWholeWords) {
    const results = [];
    for (const key of keys) {
        if (!key) continue;
        for (const src of sources) {
            if (matchKeyInText(key, src.text, caseSensitive, matchWholeWords)) {
                results.push({ key, source: src.label });
            }
        }
    }
    return results;
}

function findMatchedKeys(entry) {
    const noKeyTypes = ['constant', 'vector', 'forced', 'suppressed'];
    if (noKeyTypes.includes(entry.triggerType)) {
        const labels = {
            constant: 'Always active — no key match',
            vector: 'Activated by vector similarity',
            forced: 'Force-activated by @@activate',
            suppressed: 'Blocked by @@dontactivate',
        };
        return { primary: [], secondary: [], sources: [], reason: labels[entry.triggerType] };
    }

    // Build sources respecting per-entry flags (Fix #2)
    const sources = buildSourcesForEntry(entry);

    if (sources.length === 0) {
        const isSticky = entry.triggerType === 'sticky';
        return {
            primary: [], secondary: [], sources: [],
            reason: isSticky ? `Persisting from earlier trigger (sticky ${entry.sticky} turns)` : 'No scannable text found',
        };
    }

    // Resolve effective caseSensitive and matchWholeWords:
    // entry value (if not null) overrides global; null falls through to global.
    const wiSettings = getWIGlobalSettings();
    const effectiveCaseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
    const effectiveMatchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;

    // Test all keys against all eligible sources (Fix #3 + #4 via matchKeyInText)
    const primary = testKeysAllSources(entry.keys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords);
    const secondary = testKeysAllSources(entry.secondaryKeys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords);

    // Sticky fallback
    if (entry.triggerType === 'sticky' && primary.length === 0 && secondary.length === 0) {
        return {
            primary: [], secondary: [], sources: [],
            reason: `Persisting from earlier trigger (sticky ${entry.sticky} turns)`,
        };
    }

    // If ST activated the entry but we found no matches, provide a fallback reason
    // This can happen due to scan depth/timing differences between ST's engine and ours
    if (primary.length === 0 && secondary.length === 0) {
        return {
            primary: [], secondary: [], sources: [],
            reason: 'Activated by ST — key match not reproduced (scan depth or timing difference)',
        };
    }

    // Collect unique matched sources for display
    const matchedSourceLabels = new Set();
    for (const m of [...primary, ...secondary]) {
        matchedSourceLabels.add(m.source);
    }

    return { primary, secondary, sources: [...matchedSourceLabels], reason: null };
}

// ── Entry Processing ──

async function processEntry(entry) {
    const triggerType = classifyTrigger(entry);
    const charCount = entry.content?.length || 0;

    // FIX: Use ST's real tokenizer instead of charCount/3.5 heuristic
    let estimatedTokens;
    try {
        const { getTokenCountAsync } = SillyTavern.getContext();
        if (typeof getTokenCountAsync === 'function') {
            estimatedTokens = await getTokenCountAsync(entry.content || '');
        } else {
            estimatedTokens = Math.round(charCount / 3.5);
        }
    } catch {
        estimatedTokens = Math.round(charCount / 3.5);
    }

    const result = {
        uid: entry.uid,
        world: entry.world || 'Unknown',
        title: entry.comment || entry.key?.[0] || 'Untitled',
        triggerType,
        position: entry.position,
        depth: entry.depth,
        order: entry.order,
        charCount,
        estimatedTokens,
        sticky: entry.sticky || 0,
        constant: !!entry.constant,
        keys: entry.key || [],
        secondaryKeys: entry.keysecondary || [],
        selectiveLogic: entry.selectiveLogic,
        content: entry.content || '',
        probability: entry.probability,
        group: entry.group,
        groupWeight: entry.groupWeight,
        // FIX: Preserve null for caseSensitive/matchWholeWords so findMatchedKeys
        // can fall back to global WI settings (mirroring ST's ?? operator behavior)
        caseSensitive: entry.caseSensitive ?? null,
        disable: !!entry.disable,
        scanDepth: entry.scanDepth,
        matchWholeWords: entry.matchWholeWords ?? null,
        useGroupScoring: !!entry.useGroupScoring,
        automationId: entry.automationId,
        vectorized: !!entry.vectorized,
        preventRecursion: !!entry.preventRecursion,
        excludeRecursion: !!entry.excludeRecursion,
        delayUntilRecursion: !!entry.delayUntilRecursion,
        // Per-entry scan flags (needed for findMatchedKeys)
        matchCharacterDescription: !!entry.matchCharacterDescription,
        matchCharacterPersonality: !!entry.matchCharacterPersonality,
        matchPersonaDescription: !!entry.matchPersonaDescription,
        matchScenario: !!entry.matchScenario,
    };

    result.matchedKeys = findMatchedKeys(result);
    return result;
}

function classifyTrigger(entry) {
    if (entry.constant === true) return 'constant';
    if (entry.vectorized === true) return 'vector';
    if (entry.decorators?.includes?.('activate')) return 'forced';
    if (entry.decorators?.includes?.('dontactivate')) return 'suppressed';
    if (entry.sticky && entry.sticky !== 0) return 'sticky';

    // Scan flags (matchPersonaDescription, matchCharacterDescription, etc.) tell ST
    // *where* to look for keywords, not *why* the entry triggered. Only classify as
    // persona/character/scenario if those are the *only* scan sources (no chat keys).
    // If the entry also has regular keys, it's a normal key match that just scans
    // additional sources.
    const hasKeys = (entry.key?.length > 0) || (entry.keysecondary?.length > 0);
    if (entry.matchPersonaDescription && !hasKeys) return 'persona';
    if ((entry.matchCharacterDescription || entry.matchCharacterPersonality) && !hasKeys) return 'character';
    if (entry.matchScenario && !hasKeys) return 'scenario';

    return 'normal';
}

// ── Filtering ──

function applyFilters(entries) {
    let filtered = entries;

    // Trigger type filter
    if (state.triggerFilter.size > 0) {
        filtered = filtered.filter(e => state.triggerFilter.has(e.triggerType));
    }

    // Text search filter
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(e => {
            // Search entry title
            if (e.title && e.title.toLowerCase().includes(q)) return true;
            // Search primary keys
            if (e.keys.some(k => k.toLowerCase().includes(q))) return true;
            // Search secondary keys
            if (e.secondaryKeys.some(k => k.toLowerCase().includes(q))) return true;
            // Search lorebook name
            if (e.world && e.world.toLowerCase().includes(q)) return true;
            return false;
        });
    }

    return filtered;
}

// ── Drag (Desktop + Mobile) ──
// Uses pointer events for unified desktop/mobile drag support.
// Position resets to CSS defaults on each page refresh (no persistence).
// On mobile: snaps to nearest horizontal edge after drag.
// On desktop: stays where dropped (no edge snap).

function enableDrag(btn) {
    const DRAG_THRESHOLD = 5;
    const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

    let offsetX, offsetY, startX, startY;
    let isDragging = false;

    function onPointerDown(e) {
        // Only respond to primary button (left click / single touch)
        if (e.button !== 0) return;
        const rect = btn.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        startX = e.clientX;
        startY = e.clientY;
        isDragging = false;
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('env-trigger--dragging');
    }

    function onPointerMove(e) {
        if (!btn.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        isDragging = true;

        const bw = btn.offsetWidth;
        const bh = btn.offsetHeight;
        const newX = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - bw));
        const newY = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - bh));

        btn.style.left = newX + 'px';
        btn.style.top = newY + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }

    function onPointerUp(e) {
        btn.classList.remove('env-trigger--dragging');
        if (!btn.hasPointerCapture(e.pointerId)) return;
        btn.releasePointerCapture(e.pointerId);

        if (isDragging) {
            btn._justDragged = true;
            // Safety timeout: clear the flag in case click never fires
            setTimeout(() => { btn._justDragged = false; }, 300);

            // Mobile: snap to nearest horizontal edge
            if (isMobile()) {
                const rect = btn.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                if (centerX > window.innerWidth / 2) {
                    btn.style.left = 'auto';
                    btn.style.right = '8px';
                } else {
                    btn.style.right = 'auto';
                    btn.style.left = '8px';
                }
            }
        }
    }

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);

    // Prevent native touch scrolling while dragging the button
    btn.style.touchAction = 'none';
}

// ── UI: Trigger Button ──

function togglePanel() {
    state.panelOpen = !state.panelOpen;
    const panel = document.getElementById('env_tracker_panel');
    if (panel) {
        panel.classList.toggle('env-panel--active', state.panelOpen);
        if (state.panelOpen) positionPanelNearButton();
    }
}

/**
 * Position the panel near the trigger button so it follows after drag.
 * On mobile, the panel uses full-width CSS so we only adjust the vertical offset.
 * On desktop, the panel anchors to the button's corner.
 */
function positionPanelNearButton() {
    const btn = document.getElementById('env_trigger_btn');
    const panel = document.getElementById('env_tracker_panel');
    if (!btn || !panel) return;

    const rect = btn.getBoundingClientRect();
    const panelWidth = 360;
    const margin = 8;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
        // Mobile: panel is full-width, just position below or above the button
        const spaceBelow = window.innerHeight - rect.bottom;
        const panelMaxH = window.innerHeight - 80;

        if (spaceBelow > panelMaxH * 0.4) {
            // Below button
            panel.style.top = (rect.bottom + margin) + 'px';
            panel.style.bottom = 'auto';
        } else {
            // Above button
            panel.style.top = 'auto';
            panel.style.bottom = (window.innerHeight - rect.top + margin) + 'px';
        }
        // Reset desktop-specific positioning
        panel.style.left = '';
        panel.style.right = '';
    } else {
        // Desktop: anchor panel corner near button
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceRight = window.innerWidth - rect.left;

        // Vertical: prefer above the button (like the original layout)
        if (rect.top > spaceBelow && rect.top > 200) {
            panel.style.bottom = (window.innerHeight - rect.top + margin) + 'px';
            panel.style.top = 'auto';
        } else {
            panel.style.top = (rect.bottom + margin) + 'px';
            panel.style.bottom = 'auto';
        }

        // Horizontal: prefer aligning left edge with button
        if (spaceRight >= panelWidth + margin) {
            panel.style.left = Math.max(margin, rect.left) + 'px';
            panel.style.right = 'auto';
        } else {
            panel.style.right = margin + 'px';
            panel.style.left = 'auto';
        }
    }
}

function createTriggerButton() {
    if (document.getElementById('env_trigger_btn')) return;

    const btn = document.createElement('div');
    btn.id = 'env_trigger_btn';
    btn.className = 'env-trigger';
    btn.title = '⊹ ACE ENTRY TRACK ⊹';
    btn.innerHTML = ICONS.tracker;
    btn.setAttribute('data-env-badge', '0');
    // Accessibility
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');

    btn.addEventListener('click', (e) => {
        if (btn._justDragged) { btn._justDragged = false; return; }
        e.stopPropagation();
        togglePanel();
    });

    // Keyboard support: Enter / Space to toggle panel
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePanel();
        }
    });

    document.body.appendChild(btn);
    enableDrag(btn);
}

function updateBadge() {
    const btn = document.getElementById('env_trigger_btn');
    if (!btn) return;

    const settings = _getSettings();
    const monitored = settings.monitoredLorebooks || [];
    const filtered = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world))
        : state.currentEntries;

    btn.setAttribute('data-env-badge', String(filtered.length));
}

// ── UI: Panel ──

function createPanel() {
    if (document.getElementById('env_tracker_panel')) return;

    const panel = document.createElement('div');
    panel.id = 'env_tracker_panel';
    panel.className = 'env-panel';
    panel.innerHTML = '<div class="env-panel__empty">Send a message to see active entries</div>';

    // Event delegation for entries + sort controls + filter chips
    panel.addEventListener('click', (e) => {
        // Sort button: cycle sort field
        if (e.target.closest('.env-sort__field')) {
            cycleSortBy();
            return;
        }
        // Sort button: toggle direction
        if (e.target.closest('.env-sort__dir')) {
            toggleSortOrder();
            return;
        }
        // Trigger filter chip toggle
        const filterChip = e.target.closest('.env-filter__chip');
        if (filterChip) {
            const type = filterChip.dataset.trigger;
            if (type) {
                if (state.triggerFilter.has(type)) {
                    state.triggerFilter.delete(type);
                } else {
                    state.triggerFilter.add(type);
                }
                renderPanel();
            }
            return;
        }
        // Clear all filters button
        if (e.target.closest('.env-filter__clear')) {
            state.triggerFilter.clear();
            state.searchQuery = '';
            renderPanel();
            return;
        }
        // Entry expand/collapse
        const entry = e.target.closest('.env-entry');
        if (!entry) return;
        if (entry.classList.contains('env-entry--removed')) return;
        const uid = entry.dataset.uid;
        if (uid === undefined) return;

        if (state.expandedUids.has(uid)) {
            state.expandedUids.delete(uid);
            entry.classList.remove('env-entry--open');
        } else {
            state.expandedUids.add(uid);
            entry.classList.add('env-entry--open');
        }
    });

    // Search input handler (delegated)
    panel.addEventListener('input', (e) => {
        if (e.target.closest('.env-search__input')) {
            state.searchQuery = e.target.value.trim();
            // Debounce the re-render for smooth typing
            clearTimeout(panel._searchTimeout);
            panel._searchTimeout = setTimeout(() => renderPanel(), 150);
        }
    });

    // Close panel on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.panelOpen) {
            state.panelOpen = false;
            panel.classList.remove('env-panel--active');
        }
    });

    // Close panel on outside click
    document.addEventListener('pointerdown', (e) => {
        if (!panel.contains(e.target) && !document.getElementById('env_trigger_btn')?.contains(e.target)) {
            if (state.panelOpen) {
                state.panelOpen = false;
                panel.classList.remove('env-panel--active');
            }
        }
    });

    document.body.appendChild(panel);
}

function renderPanel() {
    const panel = document.getElementById('env_tracker_panel');
    if (!panel) return;

    const settings = _getSettings();
    const monitored = settings.monitoredLorebooks || [];

    let entries = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world))
        : state.currentEntries;

    const removed = monitored.length > 0
        ? state.removedEntries.filter(e => monitored.includes(e.world))
        : state.removedEntries;

    // Count entries per trigger type BEFORE filtering (for filter chip counts)
    const triggerCounts = {};
    for (const e of entries) {
        triggerCounts[e.triggerType] = (triggerCounts[e.triggerType] || 0) + 1;
    }

    // Apply filters
    entries = applyFilters(entries);

    const totalAll = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world)).length
        : state.currentEntries.length;

    if (totalAll === 0 && removed.length === 0) {
        panel.innerHTML = `<div class="env-panel__empty">${ICONS.empty} No active World Info entries yet.<br><small>Send a message to trigger lorebook entries.</small></div>`;
        return;
    }

    const totalTokens = entries.reduce((sum, e) => sum + e.estimatedTokens, 0);
    const budget = settings.tokenBudgetOverride || 0;
    const currentSort = settings.sortBy || 'order';
    const currentDir = settings.sortOrder || 'asc';
    const sortOpt = SORT_OPTIONS[currentSort] || SORT_OPTIONS.order;

    // Group active entries by lorebook
    const grouped = {};
    for (const entry of entries) {
        if (!grouped[entry.world]) grouped[entry.world] = [];
        grouped[entry.world].push(entry);
    }

    // Group removed entries by lorebook
    const removedGrouped = {};
    for (const entry of removed) {
        if (!removedGrouped[entry.world]) removedGrouped[entry.world] = [];
        removedGrouped[entry.world].push(entry);
    }

    // Compute global overflow set when budget is active
    const overflowUids = new Set();
    if (budget > 0) {
        const allSorted = sortEntries(entries);
        const { overflow: overflowList } = computeBudgetOverflow(allSorted, budget);
        for (const e of overflowList) overflowUids.add(String(e.uid));
    }

    let html = '';

    // Header
    html += `<div class="env-panel__header">`;
    html += `<span class="env-panel__title">${ICONS.tracker} Active Entries</span>`;
    html += `<span class="env-panel__stats">`;
    html += `${entries.length} entries · ~${totalTokens} tok`;
    if (state.newUids.size > 0 || removed.length > 0) {
        html += ` <span class="env-diff-summary">`;
        if (state.newUids.size > 0) html += `<span class="env-diff-new">+${state.newUids.size}</span>`;
        if (removed.length > 0) html += `<span class="env-diff-removed">−${removed.length}</span>`;
        html += `</span>`;
    }
    html += `</span>`;
    html += `</div>`;

    // Budget bar (shown only when budget > 0)
    if (budget > 0) {
        const pct = Math.min(100, Math.round((totalTokens / budget) * 100));
        const overBudget = totalTokens > budget;
        const barClass = overBudget ? 'env-budget--over' : (pct >= 80 ? 'env-budget--warn' : '');
        html += `<div class="env-budget ${barClass}">`;
        html += `<div class="env-budget__label">`;
        html += `<span>~${totalTokens} / ${budget} tok</span>`;
        if (overBudget) html += `<span class="env-budget__alert">${ICONS.warning} OVER BUDGET</span>`;
        html += `</div>`;
        html += `<div class="env-budget__track">`;
        html += `<div class="env-budget__fill" style="width:${pct}%"></div>`;
        html += `</div>`;
        html += `</div>`;
    }

    // Search bar
    html += `<div class="env-search">`;
    html += `<input class="env-search__input" type="text" placeholder="Filter entries…" value="${escapeHtml(state.searchQuery)}" />`;
    html += `</div>`;

    // Trigger type filter chips
    const hasActiveFilters = state.triggerFilter.size > 0 || state.searchQuery;
    const presentTypes = Object.keys(triggerCounts).sort();
    if (presentTypes.length > 0) {
        html += `<div class="env-filter">`;
        for (const type of presentTypes) {
            const tt = TRIGGER_TYPES[type] || TRIGGER_TYPES.normal;
            const isActive = state.triggerFilter.has(type);
            const chipClass = isActive ? ' env-filter__chip--active' : '';
            html += `<button class="env-filter__chip${chipClass}" data-trigger="${type}" style="--chip-color: ${tt.color}" title="${escapeHtml(tt.desc)}">`;
            html += `<span class="env-filter__chip-icon">${tt.icon}</span>`;
            html += `<span class="env-filter__chip-count">${triggerCounts[type]}</span>`;
            html += `</button>`;
        }
        if (hasActiveFilters) {
            html += `<button class="env-filter__clear" title="Clear all filters">✕</button>`;
        }
        html += `</div>`;
    }

    // Sort controls bar
    html += `<div class="env-sort">`;
    html += `<button class="env-sort__field" title="Click to cycle sort field">`;
    html += `<span class="env-sort__icon">${sortOpt.icon}</span> ${sortOpt.label}`;
    html += `</button>`;
    html += `<button class="env-sort__dir" title="Click to toggle sort direction">`;
    html += currentDir === 'asc' ? ICONS.chevron_up : ICONS.chevron_down;
    html += `</button>`;
    html += `</div>`;

    // Active entries by group
    for (const [worldName, worldEntries] of Object.entries(grouped)) {
        const worldTokens = worldEntries.reduce((s, e) => s + e.estimatedTokens, 0);
        const sorted = sortEntries(worldEntries);

        html += `<div class="env-world">`;
        html += `<div class="env-world__header">`;
        html += `<span class="env-world__name">${escapeHtml(worldName)}</span>`;
        html += `<span class="env-world__badge">${worldEntries.length} · ~${worldTokens}t</span>`;
        html += `</div>`;

        for (const entry of sorted) {
            const isOpen = state.expandedUids.has(String(entry.uid));
            const isNew = state.newUids.has(String(entry.uid));
            const isOverflow = overflowUids.has(String(entry.uid));
            html += renderEntry(entry, isOpen, isNew ? 'new' : 'unchanged', isOverflow);
        }

        html += `</div>`;
    }

    // Removed entries
    if (removed.length > 0) {
        html += `<div class="env-removed-section">`;
        html += `<div class="env-removed-section__header">`;
        html += `<span>Removed this generation</span>`;
        html += `<span class="env-removed-section__count">−${removed.length}</span>`;
        html += `</div>`;

        for (const [worldName, worldEntries] of Object.entries(removedGrouped)) {
            for (const entry of worldEntries) {
                html += renderRemovedEntry(entry);
            }
        }

        html += `</div>`;
    }

    // No results after filtering
    if (entries.length === 0 && totalAll > 0) {
        html += `<div class="env-panel__empty">No entries match current filters.<br><small>${totalAll} entries hidden by filter.</small></div>`;
    }

    // Check if search input was focused before re-render
    const searchWasFocused = panel.querySelector('.env-search__input') === document.activeElement;

    panel.innerHTML = html;

    // Re-focus search input if it was active before re-render
    if (searchWasFocused) {
        const input = panel.querySelector('.env-search__input');
        if (input) {
            input.focus();
            input.selectionStart = input.selectionEnd = input.value.length;
        }
    }
}

function renderEntry(entry, isOpen, diffStatus, isOverflow = false) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;
    const posLabel = POSITION_NAMES[entry.position] ?? `pos:${entry.position}`;
    const openClass = isOpen ? ' env-entry--open' : '';
    const diffClass = diffStatus === 'new' ? ' env-entry--new' : '';
    const overflowClass = isOverflow ? ' env-entry--overflow' : '';

    let html = `<div class="env-entry${openClass}${diffClass}${overflowClass}" data-trigger="${entry.triggerType}" data-uid="${entry.uid}">`;

    // Fix #6: Chevron down = collapsed (click to expand), chevron up = expanded (click to collapse)
    html += `<div class="env-entry__row">`;
    if (diffStatus === 'new') {
        html += `<span class="env-entry__diff-badge">NEW</span>`;
    }
    if (isOverflow) {
        html += `<span class="env-entry__diff-badge env-entry__diff-badge--overflow">OVER</span>`;
    }
    html += `<span class="env-entry__icon">${tt.icon}</span>`;
    html += `<span class="env-entry__title">${escapeHtml(entry.title)}</span>`;
    html += `<span class="env-entry__tokens">${entry.estimatedTokens}t</span>`;
    html += `<span class="env-entry__chevron">${isOpen ? ICONS.chevron_up : ICONS.chevron_down}</span>`;
    html += `</div>`;

    // Detail section (collapsible)
    html += `<div class="env-detail">`;

    html += `<div class="env-detail__section">`;
    html += `<span class="env-detail__badge" style="background:${tt.color}">${tt.label}</span> `;
    html += `<span class="env-detail__desc">${tt.desc}</span>`;
    html += `</div>`;

    html += `<div class="env-detail__section">`;
    html += `<span class="env-detail__label">Position</span>`;
    html += `<span class="env-detail__value">${posLabel}`;
    if (entry.position === 4 && entry.depth !== undefined) html += ` (depth: ${entry.depth})`;
    html += `</span>`;
    html += `</div>`;

    html += `<div class="env-detail__section">`;
    html += `<span class="env-detail__label">Order</span>`;
    html += `<span class="env-detail__value">${entry.order ?? '—'}</span>`;
    html += `</div>`;

    html += `<div class="env-detail__section">`;
    html += `<span class="env-detail__label">Size</span>`;
    html += `<span class="env-detail__value">${entry.charCount} chars · ~${entry.estimatedTokens} tokens</span>`;
    html += `</div>`;

    if (entry.sticky) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Sticky</span>`;
        html += `<span class="env-detail__value">${entry.sticky} turn duration</span>`;
        html += `</div>`;
    }

    if (entry.probability !== undefined && entry.probability < 100) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Probability</span>`;
        html += `<span class="env-detail__value">${entry.probability}%</span>`;
        html += `</div>`;
    }

    if (entry.group) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Group</span>`;
        html += `<span class="env-detail__value">${escapeHtml(entry.group)}`;
        if (entry.groupWeight) html += ` (weight: ${entry.groupWeight})`;
        html += `</span></div>`;
    }

    if (entry.selectiveLogic !== undefined) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Logic</span>`;
        html += `<span class="env-detail__value">${LOGIC_NAMES[entry.selectiveLogic] || entry.selectiveLogic}</span>`;
        html += `</div>`;
    }

    const recursionFlags = [];
    if (entry.preventRecursion) recursionFlags.push('Prevent');
    if (entry.excludeRecursion) recursionFlags.push('Exclude');
    if (entry.delayUntilRecursion) recursionFlags.push('Delay until');
    if (recursionFlags.length > 0) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Recursion</span>`;
        html += `<span class="env-detail__value">${recursionFlags.join(', ')}</span>`;
        html += `</div>`;
    }

    // Scan flags summary
    const scanFlags = [];
    if (entry.matchCharacterDescription) scanFlags.push('Character');
    if (entry.matchCharacterPersonality) scanFlags.push('Personality');
    if (entry.matchPersonaDescription) scanFlags.push('Persona');
    if (entry.matchScenario) scanFlags.push('Scenario');
    if (scanFlags.length > 0) {
        html += `<div class="env-detail__section">`;
        html += `<span class="env-detail__label">Scans</span>`;
        html += `<span class="env-detail__value">Chat + ${scanFlags.join(', ')}</span>`;
        html += `</div>`;
    }

    if (entry.keys.length > 0) {
        html += `<div class="env-detail__section env-detail__section--full">`;
        html += `<span class="env-detail__label">Primary keys</span>`;
        html += `<div class="env-detail__keys">`;
        for (const k of entry.keys) {
            html += `<span class="env-key">${escapeHtml(k)}</span>`;
        }
        html += `</div></div>`;
    }

    if (entry.secondaryKeys.length > 0) {
        html += `<div class="env-detail__section env-detail__section--full">`;
        html += `<span class="env-detail__label">Secondary keys</span>`;
        html += `<div class="env-detail__keys">`;
        for (const k of entry.secondaryKeys) {
            html += `<span class="env-key env-key--secondary">${escapeHtml(k)}</span>`;
        }
        html += `</div></div>`;
    }

    // ── MATCHED section: Option A grouped-by-source + color-coded labels + hover tooltips ──
    if (entry.matchedKeys) {
        const mk = entry.matchedKeys;
        if (mk.reason) {
            html += `<div class="env-detail__section env-detail__section--full">`;
            html += `<span class="env-detail__label">Matched</span>`;
            html += `<span class="env-detail__match-reason">${escapeHtml(mk.reason)}</span>`;
            html += `</div>`;
        } else if (mk.primary.length > 0 || mk.secondary.length > 0) {
            // Group all matches by source
            const bySource = {};
            for (const m of mk.primary) {
                if (!bySource[m.source]) bySource[m.source] = { primary: [], secondary: [] };
                bySource[m.source].primary.push(m.key);
            }
            for (const m of mk.secondary) {
                if (!bySource[m.source]) bySource[m.source] = { primary: [], secondary: [] };
                bySource[m.source].secondary.push(m.key);
            }

            html += `<div class="env-detail__section env-detail__section--full">`;
            html += `<span class="env-detail__label">Matched</span>`;
            html += `<div class="env-matched">`;

            for (const [sourceName, keys] of Object.entries(bySource)) {
                const sc = SOURCE_COLORS[sourceName] || { color: '#64748b', label: sourceName, desc: `Matched in ${sourceName}` };

                html += `<div class="env-matched__row">`;
                // Source label chip with tooltip
                html += `<span class="env-matched__source" style="--source-color: ${sc.color}" title="${escapeHtml(sc.desc)}">${escapeHtml(sc.label)}</span>`;
                // Key chips
                html += `<div class="env-matched__keys">`;
                // Deduplicate keys per source
                const uniquePrimary = [...new Set(keys.primary)];
                const uniqueSecondary = [...new Set(keys.secondary)];
                for (const k of uniquePrimary) {
                    html += `<span class="env-key env-key--matched" style="--match-color: ${sc.color}" title="${escapeHtml(sc.label)}: primary key">${escapeHtml(k)}</span>`;
                }
                for (const k of uniqueSecondary) {
                    html += `<span class="env-key env-key--matched env-key--matched-secondary" style="--match-color: ${sc.color}" title="${escapeHtml(sc.label)}: secondary key">${escapeHtml(k)}</span>`;
                }
                html += `</div>`;
                html += `</div>`;
            }

            html += `</div>`;
            html += `</div>`;
        }
    }

    if (entry.content) {
        const preview = entry.content.length > 500
            ? entry.content.substring(0, 500) + '…'
            : entry.content;
        html += `<div class="env-detail__section env-detail__section--full">`;
        html += `<span class="env-detail__label">Content</span>`;
        html += `<div class="env-detail__content">${escapeHtml(preview)}</div>`;
        html += `</div>`;
    }

    html += `</div>`; // .env-detail
    html += `</div>`; // .env-entry

    return html;
}

function renderRemovedEntry(entry) {
    const tt = TRIGGER_TYPES[entry.triggerType] || TRIGGER_TYPES.normal;

    let html = `<div class="env-entry env-entry--removed" data-trigger="${entry.triggerType}" data-uid="${entry.uid}">`;
    html += `<div class="env-entry__row">`;
    html += `<span class="env-entry__diff-badge env-entry__diff-badge--removed">OUT</span>`;
    html += `<span class="env-entry__icon">${tt.icon}</span>`;
    html += `<span class="env-entry__title">${escapeHtml(entry.title)}</span>`;
    html += `<span class="env-entry__tokens">${entry.estimatedTokens}t</span>`;
    html += `</div>`;
    html += `</div>`;

    return html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Exports ──

export function setEnabled(enabled) {
    const btn = document.getElementById('env_trigger_btn');
    const panel = document.getElementById('env_tracker_panel');

    if (!btn && !panel) return;

    if (!enabled) {
        if (btn) btn.style.display = 'none';
        if (panel) panel.classList.remove('env-panel--active');
        state.panelOpen = false;
    } else {
        if (btn) btn.style.display = '';
    }
}

export function getTrackerState() {
    return state;
}
