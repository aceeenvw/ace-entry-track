// ⊹ ACE ENTRY TRACK ⊹ — ui/lorebook-list.js
// Settings-panel lorebook checkbox list. Uses an injected getter so we
// don't take a circular import on scanner.js.

let _getSettings;
let _getAvailableLorebooks;   // () => { name: string, source: string }[]

const SOURCE_LABELS = {
    'global':          'GLB',
    'char-primary':    'CHR',
    'char-additional': 'AUX',
    'chat':            'CHAT',
    'persona':         'PRS',
    'auto':            'AUTO',
};

const SOURCE_COLORS = {
    'global':          '#3b82f6',
    'char-primary':    '#f59e0b',
    'char-additional': '#e08a2c',
    'chat':            '#10b981',
    'persona':         '#a855f7',
    'auto':            '#64748b',
};

/**
 * @param {Function} getSettingsFn  - returns extension settings object
 * @param {Function} getAvailableFn - returns [{ name, source }, ...]
 */
export function initLorebookList(getSettingsFn, getAvailableFn) {
    _getSettings = getSettingsFn;
    _getAvailableLorebooks = getAvailableFn;
}

/** Repopulate the checkbox list against currently discovered lorebooks. */
export function populateLorebookList() {
    const container = $('#env_monitored_lorebooks');
    if (!container.length) return;

    const settings = _getSettings?.();
    if (!settings) return;

    const monitored = settings.monitoredLorebooks || [];
    const available = _getAvailableLorebooks?.() || [];

    container.empty();

    if (available.length === 0) {
        container.html('<div class="env-lorebook-empty">No lorebooks discovered yet</div>');
        return;
    }

    for (let i = 0; i < available.length; i++) {
        const book = available[i];
        const name = typeof book === 'string' ? book : book.name;
        if (typeof name !== 'string' || !name) continue;
        const source = typeof book === 'string' ? 'auto' : (book.source || 'auto');
        const isChecked = monitored.includes(name);
        // Index suffix disambiguates names that collapse to the same slug
        // (e.g. "hello world" vs "hello_world").
        const safeId = `env_lb_${i}_${name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80)}`;

        const label = $('<label>', { class: 'env-lorebook-item', for: safeId });
        const input = $('<input>', { type: 'checkbox', id: safeId }).val(name);
        if (isChecked) input.prop('checked', true);

        const badgeLabel = SOURCE_LABELS[source] || source.toUpperCase();
        const badgeColor = SOURCE_COLORS[source] || '#64748b';
        const badge = $('<span>', { class: 'env-lorebook-source' })
            .text(badgeLabel)
            .css({
                'font-size': '8px',
                'font-weight': '700',
                'color': badgeColor,
                'background': `color-mix(in srgb, ${badgeColor} 12%, transparent)`,
                'border': `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
                'padding': '0 4px',
                'border-radius': '3px',
                'text-transform': 'uppercase',
                'letter-spacing': '0.3px',
                'flex-shrink': '0',
            });

        const span = $('<span>').text(name).css('flex', '1');
        label.append(input, badge, span);
        container.append(label);
    }
}
