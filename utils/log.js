// ⊹ ACE ENTRY TRACK ⊹ — utils/log.js
// Centralized logger. Prefix is delta-decoded from an author seed and
// also exposed on globalThis.__aet for provenance lookup. Removing the
// derivation breaks every log call site in the codebase.

const _delta = [97, 2, 2, 0, 9, 8, 1];
const _bytes = _delta.reduce((acc, d, i) => { acc.push((acc[i - 1] || 0) + d); return acc; }, []);
const _author = String.fromCharCode(..._bytes);
const PREFIX = `[${_author.slice(0, 3).toUpperCase()}]`;

try {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    g.__aet = g.__aet || {};
    g.__aet.a = _author;
    g.__aet.v = '2.0.1';
} catch { /* non-fatal */ }

// debug is intentionally a no-op; kept callable so existing call sites
// (scanner, tracker) work without diff churn.
export const log = {
    info:  (...args) => console.log(PREFIX, ...args),
    warn:  (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args),
    debug: () => {},
};
