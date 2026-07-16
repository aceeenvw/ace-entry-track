// ⊹ ACE ENTRY TRACK ⊹ — scanner.js
// Lorebook discovery across all five sources: global, character-primary,
// character-additional, chat-bound, persona-bound. Each book is tagged
// with its origin for display in settings.

import { populateLorebookList } from './ui/lorebook-list.js';

let _getSettings;
let _saveSettingsDebounced;

// Generation counter: stale async results from a prior discovery are discarded.
let _discoveryGeneration = 0;

function isEnabled() {
    const s = _getSettings?.();
    return !s || s.enabled !== false;
}

// Single source of truth for the lorebook-name length cap. Used by both
// addBook (initial discovery) and addDiscoveredLorebook (auto-add).
const MAX_WORLD_NAME_LEN = 200;

// availableLorebooks: [{ name, source }] where source is one of
// 'global' | 'char-primary' | 'char-additional' | 'chat' | 'persona' | 'auto'.
const state = {
    availableLorebooks: [],
};

export function initScanner(getSettingsFn, saveFn) {
    _getSettings = getSettingsFn;
    _saveSettingsDebounced = saveFn;

    if (isEnabled()) void refreshScanner();

    const { eventSource, event_types } = SillyTavern.getContext();

    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, onLorebookSettingsChanged);

    if (event_types.CHARACTER_EDITED) {
        eventSource.on(event_types.CHARACTER_EDITED, onLorebookSettingsChanged);
    }
    if (event_types.PERSONA_CHANGED) {
        eventSource.on(event_types.PERSONA_CHANGED, onLorebookSettingsChanged);
    }
    if (event_types.PERSONA_UPDATED) {
        eventSource.on(event_types.PERSONA_UPDATED, onLorebookSettingsChanged);
    }

    try {
        $('#character_world').on('change', onLorebookSettingsChanged);
        $('#world_info').on('change', onLorebookSettingsChanged);
    } catch { /* non-fatal */ }

}

export async function refreshScanner() {
    if (!isEnabled()) return;
    await discoverLorebooks();
    if (!isEnabled()) return;
    pruneStaleMonitored();
    populateLorebookList();
}

export function setScannerEnabled(enabled) {
    _discoveryGeneration++;
    if (enabled) void refreshScanner();
}

function onChatChanged() {
    if (!isEnabled()) return;
    void refreshScanner();
}

function onLorebookSettingsChanged() {
    if (!isEnabled()) return;
    void refreshScanner();
}

/** Drop monitored selections whose lorebook is no longer attached. */
function pruneStaleMonitored() {
    const settings = _getSettings?.();
    if (!settings?.monitoredLorebooks?.length) return;

    const availableNames = new Set(state.availableLorebooks.map(b => b.name));
    const before = settings.monitoredLorebooks.length;
    settings.monitoredLorebooks = settings.monitoredLorebooks.filter(name => availableNames.has(name));

    if (settings.monitoredLorebooks.length < before) {
        _saveSettingsDebounced?.();
    }
}

// ── Helpers ──

/**
 * Append a book; first source wins. Names are length-capped so a
 * pathological character card can't produce giant labels.
 */
function addBook(found, name, source) {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const safe = trimmed.length > MAX_WORLD_NAME_LEN ? trimmed.slice(0, MAX_WORLD_NAME_LEN) : trimmed;
    if (!found.has(safe)) found.set(safe, source);
}

// ── Discovery ──

/** Discover lorebooks from all five sources. Race-protected via _discoveryGeneration. */
async function discoverLorebooks() {
    const gen = ++_discoveryGeneration;
    const ctx = SillyTavern.getContext();
    const found = new Map();

    discoverGlobalLorebooks(found);
    discoverChatLore(ctx, found);
    discoverPersonaLore(ctx, found);

    const charId = ctx.characterId;
    if (charId !== undefined && ctx.characters?.[charId]) {
        const charBook = ctx.characters[charId]?.data?.extensions?.world;
        if (charBook) addBook(found, charBook, 'char-primary');
    }

    // Additional character books — slash command, DOM fallback on failure.
    if (charId !== undefined) {
        try {
            const result = await ctx.executeSlashCommandsWithOptions('/getcharbook type=additional');

            if (gen !== _discoveryGeneration) return;

            const pipe = result?.pipe;
            if (pipe && typeof pipe === 'string' && pipe.trim()) {
                let additionalBooks = [];
                try { additionalBooks = JSON.parse(pipe); }
                catch { additionalBooks = pipe.split(',').map(s => s.trim()).filter(Boolean); }
                if (Array.isArray(additionalBooks)) {
                    // Cap iteration; a malformed pipe could yield a huge array.
                    const MAX_BOOKS = 128;
                    const limit = Math.min(additionalBooks.length, MAX_BOOKS);
                    for (let i = 0; i < limit; i++) addBook(found, additionalBooks[i], 'char-additional');
                }
            }
        } catch {
            tryCharDomFallback(found);
        }
    }

    if (!isEnabled() || gen !== _discoveryGeneration) return;

    state.availableLorebooks = [...found.entries()]
        .map(([name, source]) => ({ name, source }))
        .sort((a, b) => a.name.localeCompare(b.name));

}

/** Read global WI selection from #world_info <select> (option text = name). */
function discoverGlobalLorebooks(found) {
    try {
        const sel = document.getElementById('world_info');
        if (sel) {
            const selected = Array.from(sel.selectedOptions || []);
            for (const opt of selected) {
                addBook(found, opt.textContent, 'global');
            }
        }
    } catch { /* non-fatal */ }
}

/** Read chat-bound lorebook from chat_metadata['world_info']. */
function discoverChatLore(ctx, found) {
    try {
        const chatWorld = ctx.chatMetadata?.['world_info'];
        if (chatWorld && typeof chatWorld === 'string') {
            addBook(found, chatWorld, 'chat');
        }
    } catch { /* non-fatal */ }
}

/** Read persona-bound lorebook from powerUserSettings.persona_description_lorebook. */
function discoverPersonaLore(ctx, found) {
    try {
        const personaWorld = ctx.powerUserSettings?.persona_description_lorebook;
        if (personaWorld && typeof personaWorld === 'string' && personaWorld.trim()) {
            addBook(found, personaWorld, 'persona');
        }
    } catch { /* non-fatal */ }
}

/** DOM-scraping fallback for character lorebooks if slash command fails. */
function tryCharDomFallback(found) {
    try {
        const primaryDom = $('#character_world')?.val?.();
        if (primaryDom && typeof primaryDom === 'string' && primaryDom.trim()) {
            addBook(found, primaryDom, 'char-primary');
        }

        const extraSelectors = [
            '#character_extra_world_info_selector .select2-selection__choice',
        ];
        for (const sel of extraSelectors) {
            $(sel).each(function () {
                const name = $(this).attr('title')
                    || $(this).text?.().replace('×', '').trim()
                    || '';
                if (name.trim() && name !== 'None') {
                    addBook(found, name, 'char-additional');
                }
            });
        }
    } catch { /* non-fatal */ }
}

/**
 * Add a lorebook revealed by WORLD_INFO_ACTIVATED that wasn't in the
 * static discovery output. Tagged as 'auto' source.
 */
export function addDiscoveredLorebook(name) {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const safe = trimmed.length > MAX_WORLD_NAME_LEN ? trimmed.slice(0, MAX_WORLD_NAME_LEN) : trimmed;
    if (state.availableLorebooks.some(b => b.name === safe)) return;

    state.availableLorebooks.push({ name: safe, source: 'auto' });
    state.availableLorebooks.sort((a, b) => a.name.localeCompare(b.name));
    populateLorebookList();
}

export function getScannerState() {
    return state;
}
