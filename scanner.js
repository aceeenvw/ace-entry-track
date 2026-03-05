// ⊹ ACE ENTRY TRACK ⊹ — scanner.js
// Stage 3A v4: Lorebook discovery — reads Primary + Additional character lorebooks
// Additional lorebooks sourced via /getcharbook slash command (reads world_info.charLore)

import { populateLorebookList } from './index.js';

const MODULE_NAME = 'ace-entry-track';

let _getSettings;
let _saveSettingsDebounced;

function isEnabled() {
    const s = _getSettings?.();
    return !s || s.enabled !== false;
}

const state = {
    activeEntries: [],
    totalTokens: 0,
    availableLorebooks: [],
};

export function initScanner(getSettingsFn, saveFn) {
    _getSettings = getSettingsFn;
    _saveSettingsDebounced = saveFn;

    if (!isEnabled()) {
        console.log('[ACE ENTRY TRACK] Disabled via settings, scanner not initialized');
        return;
    }

    // Initial discovery (async — additional books need slash command)
    discoverLorebooks().then(() => {
        populateLorebookList();
    });

    const { eventSource, event_types } = SillyTavern.getContext();

    // Re-discover on chat change (different character = different lorebooks)
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Re-discover when world info settings change (e.g. global WI selection).
    // Note: does NOT fire when charLore is modified via updateAuxBooks().
    eventSource.on(event_types.WORLDINFO_SETTINGS_UPDATED, onLorebookSettingsChanged);

    // Re-discover when character is edited (primary lorebook may change).
    // Guard: event may not exist in all ST versions.
    if (event_types.CHARACTER_EDITED) {
        eventSource.on(event_types.CHARACTER_EDITED, onLorebookSettingsChanged);
    }

    // DOM listener for primary lorebook dropdown changes (immediate feedback)
    try {
        $('#character_world').on('change', onLorebookSettingsChanged);
    } catch { /* non-fatal */ }

    console.log(`[${MODULE_NAME}] Scanner initialized`);
}

function onChatChanged() {
    if (!isEnabled()) return;
    state.activeEntries = [];
    state.totalTokens = 0;
    discoverLorebooks().then(() => {
        pruneStaleMonitored();
        populateLorebookList();
        console.log(`[${MODULE_NAME}] Chat changed — cleared entries, re-discovered lorebooks`);
    });
}

function onLorebookSettingsChanged() {
    if (!isEnabled()) return;
    discoverLorebooks().then(() => {
        pruneStaleMonitored();
        populateLorebookList();
        console.log(`[${MODULE_NAME}] Lorebook settings changed — re-discovered lorebooks`);
    });
}

/**
 * Remove any monitored lorebook selections that are no longer available.
 * Keeps settings clean when books get detached from a character.
 */
function pruneStaleMonitored() {
    const settings = _getSettings?.();
    if (!settings?.monitoredLorebooks?.length) return;

    const available = new Set(state.availableLorebooks);
    const before = settings.monitoredLorebooks.length;
    settings.monitoredLorebooks = settings.monitoredLorebooks.filter(name => available.has(name));

    if (settings.monitoredLorebooks.length < before) {
        _saveSettingsDebounced?.();
        console.log(`[${MODULE_NAME}] Pruned ${before - settings.monitoredLorebooks.length} stale monitored lorebook(s)`);
    }
}

/**
 * Discover all character-bound lorebooks (primary + additional).
 * Uses character data for primary and the /getcharbook slash command for additional.
 */
async function discoverLorebooks() {
    const ctx = SillyTavern.getContext();
    const found = new Set();

    // ── Character's primary lorebook (from character data) ──
    const charId = ctx.characterId;
    if (charId !== undefined && ctx.characters?.[charId]) {
        const charData = ctx.characters[charId]?.data;
        const charBook = charData?.extensions?.world;
        if (charBook) {
            found.add(charBook);
        }
    }

    // ── Character's additional lorebooks (via /getcharbook slash command) ──
    // This reads world_info.charLore internally, which extensions can't import directly.
    if (charId !== undefined) {
        try {
            const result = await ctx.executeSlashCommandsWithOptions('/getcharbook type=additional');
            const pipe = result?.pipe;
            if (pipe && typeof pipe === 'string' && pipe.trim()) {
                // type=additional returns JSON.stringify(array) e.g. '["Book1","Book2"]'
                let additionalBooks = [];
                try {
                    additionalBooks = JSON.parse(pipe);
                } catch {
                    // Fallback: treat as single book name or comma-separated
                    additionalBooks = pipe.split(',').map(s => s.trim()).filter(Boolean);
                }

                if (Array.isArray(additionalBooks)) {
                    for (const book of additionalBooks) {
                        if (book && typeof book === 'string' && book.trim()) {
                            found.add(book.trim());
                        }
                    }
                }
            }
        } catch (e) {
            console.log(`[${MODULE_NAME}] Slash command discovery failed, using DOM fallback:`, e.message);
            tryDomFallback(found);
        }
    }

    state.availableLorebooks = [...found].sort();
    console.log(`[${MODULE_NAME}] Discovered lorebooks: [${state.availableLorebooks.join(', ')}]`);
}

/**
 * Fallback DOM scraping — only used if the slash command method fails.
 * Attempts to read lorebooks from known UI selectors.
 */
function tryDomFallback(found) {
    try {
        const primaryDom = $('#character_world')?.val?.();
        if (primaryDom && typeof primaryDom === 'string' && primaryDom.trim()) {
            found.add(primaryDom.trim());
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
                    found.add(name.trim());
                }
            });
        }
    } catch (e) {
        console.log(`[${MODULE_NAME}] DOM fallback error (non-fatal):`, e.message);
    }
}

/**
 * Force a re-discovery of lorebooks from external trigger.
 * Called after a generation completes, in case charLore changed silently.
 */
export function refreshDiscovery() {
    if (!isEnabled()) return;
    discoverLorebooks().then(() => {
        pruneStaleMonitored();
        populateLorebookList();
    });
}

// Called from tracker.js when WORLD_INFO_ACTIVATED reveals a new lorebook
export function addDiscoveredLorebook(name) {
    if (!state.availableLorebooks.includes(name)) {
        state.availableLorebooks.push(name);
        state.availableLorebooks.sort();
        populateLorebookList();
        console.log(`[${MODULE_NAME}] Auto-discovered lorebook: ${name}`);
    }
}

export function getActiveEntries() {
    return state.activeEntries;
}

export function getScannerState() {
    return state;
}
