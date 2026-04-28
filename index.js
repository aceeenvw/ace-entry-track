// ⊹ ACE ENTRY TRACK ⊹ — index.js
// Main entry point: settings init, UI, lifecycle orchestration

import { initScanner, getScannerState } from './scanner.js';
import { initTracker, setEnabled as setTrackerEnabled } from './tracker.js';

const MODULE_NAME = 'ace-entry-track';

// Derive EXT_PATH from the actual script location so it works
// regardless of what the install folder is named.
const EXT_PATH = new URL('.', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');

const defaultSettings = Object.freeze({
    enabled: true,
    tokenBudgetOverride: 0,
    monitoredLorebooks: [],
    sortBy: 'order',
    sortOrder: 'asc',
});

// Allowlist hydration: copy only known keys from defaults, coerce types,
// ignore any __proto__/constructor/prototype mischief in persisted JSON.
// Replaces lodash.merge which is vulnerable to prototype pollution.
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    const raw = (extensionSettings[MODULE_NAME] && typeof extensionSettings[MODULE_NAME] === 'object')
        ? extensionSettings[MODULE_NAME] : {};
    const base = structuredClone(defaultSettings);

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
        const incoming = raw[key];
        const defaultVal = defaultSettings[key];

        // Type-matched coercion; silently drop mismatched values.
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

function saveSettings() {
    const { saveSettingsDebounced } = SillyTavern.getContext();
    saveSettingsDebounced();
}

// ── Lorebook Checkbox List ──

export function populateLorebookList() {
    const container = $('#env_monitored_lorebooks');
    if (!container.length) return;

    const settings = getSettings();
    const monitored = settings.monitoredLorebooks || [];
    const available = getScannerState().availableLorebooks || [];

    container.empty();

    if (available.length === 0) {
        container.html('<div class="env-lorebook-empty">No lorebooks discovered yet</div>');
        return;
    }

    for (const name of available) {
        const isChecked = monitored.includes(name);
        const safeId = `env_lb_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;

        // Fix #8: Build DOM nodes via jQuery to avoid XSS from lorebook names.
        // Using .text() and .val() ensures proper escaping without double-encoding.
        const label = $('<label>', { class: 'env-lorebook-item', for: safeId });
        const input = $('<input>', { type: 'checkbox', id: safeId }).val(name);
        if (isChecked) input.prop('checked', true);
        const span = $('<span>').text(name);
        label.append(input, span);
        container.append(label);
    }
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
        getSettings().tokenBudgetOverride = parseInt($(this).val()) || 0;
        saveSettings();
    });
    // Lorebook checkboxes — event delegation
    // Fix #8: Read the raw name from data attribute to avoid HTML-entity issues
    $('#env_monitored_lorebooks').on('change', 'input[type="checkbox"]', function () {
        const settings = getSettings();
        const checked = [];
        $('#env_monitored_lorebooks input[type="checkbox"]:checked').each(function () {
            checked.push($(this).val());
        });
        settings.monitoredLorebooks = checked;
        saveSettings();
        console.log(`[${MODULE_NAME}] Monitored lorebooks:`, checked);
    });
}

// ── Bootstrap ──

jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loading...`);

    try {
        const settingsHtml = await $.get(`${EXT_PATH}/settings.html`);
        $('#extensions_settings2').append(settingsHtml);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to load settings HTML:`, err);
        return;
    }

    const settings = getSettings();
    loadSettingsUI();
    bindSettingsEvents();

    initScanner(getSettings, saveSettings);
    initTracker(getSettings, saveSettings);
    setTrackerEnabled(settings.enabled);

    console.log(`[${MODULE_NAME}] Loaded successfully`);
});
