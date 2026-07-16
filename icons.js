// ⊹ ACE ENTRY TRACK ⊹ — icons.js
// Monochrome SVG icons (24x24 viewBox, stroke-based, currentColor).

const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {

    // ── Trigger type icons (9) ──
    constant:     svg('<line x1="12" y1="3" x2="12" y2="15"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/><path d="M8 3h8"/>'),
    vector:       svg('<path d="M6 3v4c0 1 1.5 2 3 2h1"/><path d="M18 3v4c0 1-1.5 2-3 2h-1"/><path d="M9 9l3 3 3-3"/><line x1="12" y1="12" x2="12" y2="21"/>'),
    sticky:       svg('<path d="M15.5 3.5L7 12l-2 6 6-2 8.5-8.5a2.83 2.83 0 0 0-4-4z"/><path d="M5 18l3-3"/>'),
    forced:       svg('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
    persona:      svg('<path d="M19 21v-2a4 4 0 0 0-3-3.87"/><path d="M13 3.13a4 4 0 0 1 0 7.75"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'),
    character:    svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
    scenario:     svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/><path d="M10 4v4"/>'),
    normal:       svg('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),

    // ── Sort icons (4) ──
    sort_order:   svg('<path d="M4 6h7"/><path d="M4 12h5"/><path d="M4 18h3"/><path d="M17 6v12"/><path d="M14 15l3 3 3-3"/>'),
    sort_tokens:  svg('<circle cx="12" cy="12" r="8"/><path d="M9.5 9.5c.5-1.5 4-1.5 4.5 0s-1 2-2.5 2.5v1"/><circle cx="12" cy="16.5" r="0.5" fill="currentColor" stroke="none"/>'),
    sort_name:    svg('<path d="M4 18V6l4 12"/><path d="M4 14h4"/><path d="M14 18V6l6 12"/><path d="M14 14h6"/>'),
    sort_trigger: svg('<circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/>'),

    // ── UI icons (8) ──
    tracker:      svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
    empty:        svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h6"/>'),
    warning:      svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
    budget:       svg('<path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="4"/>'),
    chevron_down: svg('<polyline points="6 9 12 15 18 9"/>'),
    chevron_up:   svg('<polyline points="6 15 12 9 18 15"/>'),
    context:      svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    collapse:     svg('<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    expand:       svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    refresh:      svg('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
};
