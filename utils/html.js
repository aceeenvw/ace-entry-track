// ⊹ ACE ENTRY TRACK ⊹ — utils/html.js
// Single source of truth for HTML escaping.

/** Escape HTML special characters. Preserves "0" / "false" — only null/undefined collapses to ''. */
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
