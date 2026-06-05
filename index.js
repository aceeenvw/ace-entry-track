// ⊹ ACE ENTRY TRACK ⊹ — index.js
// Bootstrap: settings hydration, UI mount, module wiring.
// Settings load uses an allowlist loop (not lodash.merge) so __proto__ /
// constructor / prototype keys in the persisted JSON cannot poison.

import { initScanner, getScannerState } from './scanner.js';
import { initTracker, setEnabled as setTrackerEnabled } from './tracker.js';
import { initLorebookList, populateLorebookList } from './ui/lorebook-list.js';
import { log } from './utils/log.js';

const MODULE_NAME = 'ace-entry-track';

// Derived from script location so the install folder can be renamed.
const EXT_PATH = new URL('.', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');

const defaultSettings = Object.freeze({
    enabled: true,
    tokenBudgetOverride: 0,
    monitoredLorebooks: [],
    sortBy: 'order',
    sortOrder: 'asc',
});

/**
 * Allowlist-only hydration: only defaultSettings keys are considered, so
 * __proto__ / constructor / prototype in `raw` are never copied. The
 * result replaces extensionSettings[MODULE_NAME] so future debounced
 * saves serialize the sanitized shape.
 */
function hydrateSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    const raw = (extensionSettings[MODULE_NAME] && typeof extensionSettings[MODULE_NAME] === 'object')
        ? extensionSettings[MODULE_NAME] : {};
    const base = structuredClone(defaultSettings);

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const incoming = raw[key];
        const defaultVal = defaultSettings[key];

        if (typeof defaultVal === 'boolean') {
            if (typeof incoming === 'boolean') base[key] = incoming;
        } else if (typeof defaultVal === 'number') {
            if (typeof incoming === 'number' && Number.isFinite(incoming)) base[key] = incoming;
        } else if (typeof defaultVal === 'string') {
            if (typeof incoming === 'string') base[key] = incoming;
        } else if (Array.isArray(defaultVal)) {
            if (Array.isArray(incoming)) base[key] = incoming.filter(v => typeof v === 'string');
        }
    }

    extensionSettings[MODULE_NAME] = base;
    return base;
}

/**
 * Return the live (mutable) settings reference. Re-hydrates if ST swapped
 * in a new object (profile import, fresh load); otherwise returns the
 * same reference so consumer mutations persist until the next save flush.
 */
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    const existing = extensionSettings[MODULE_NAME];
    if (existing && typeof existing === 'object' && existing.__ace_hydrated === true) {
        return existing;
    }
    const base = hydrateSettings();
    // Non-enumerable so the marker doesn't leak into serialized JSON.
    Object.defineProperty(base, '__ace_hydrated', {
        value: true, enumerable: false, configurable: true, writable: true,
    });
    return base;
}

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ── Settings UI ──

function loadSettingsUI() {
    const s = getSettings();
    $('#env_enabled').prop('checked', s.enabled);
    $('#env_token_budget').val(s.tokenBudgetOverride);
    populateLorebookList();
}

function bindSettingsEvents() {
    $('#env_enabled').on('change', function () {
        const s = getSettings();
        s.enabled = $('#env_enabled').is(':checked');
        saveSettings();
        setTrackerEnabled(s.enabled);
    });
    $('#env_token_budget').on('input', function () {
        const v = parseInt($(this).val(), 10);
        // Clamp to [0, 999999]; non-finite or negative means "no override".
        const clamped = Number.isFinite(v) ? Math.max(0, Math.min(v, 999999)) : 0;
        getSettings().tokenBudgetOverride = clamped;
        saveSettings();
    });
    // .val() returns the raw lorebook name set via jQuery .val(name) in
    // lorebook-list.js — safe from XSS even when names contain HTML.
    $('#env_monitored_lorebooks').on('change', 'input[type="checkbox"]', function () {
        const settings = getSettings();
        const checked = [];
        $('#env_monitored_lorebooks input[type="checkbox"]:checked').each(function () {
            checked.push($(this).val());
        });
        settings.monitoredLorebooks = checked;
        saveSettings();
        log.info('Monitored lorebooks:', checked);
    });
}

// ── Bootstrap ──

jQuery(async () => {
    log.info('Loading...');

    try {
        const settingsHtml = await $.get(`${EXT_PATH}/settings.html`);
        $('#extensions_settings').append(settingsHtml);
    } catch (err) {
        log.error('Failed to load settings HTML:', err);
        return;
    }

    const settings = getSettings();

    // Inject getters to avoid circular import on scanner.js.
    initLorebookList(getSettings, () => getScannerState().availableLorebooks || []);

    loadSettingsUI();
    bindSettingsEvents();

    initScanner(getSettings, saveSettings);
    initTracker(getSettings, saveSettings);
    setTrackerEnabled(settings.enabled);

    log.info('Loaded successfully');
});
