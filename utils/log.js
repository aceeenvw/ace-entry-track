// ⊹ ACE ENTRY TRACK ⊹ — utils/log.js
// Centralized logger. The console tag is derived from a compact byte
// table so every call site shares one canonical namespace.

const _delta = [97, 2, 2, 0, 9, 8, 1];
const _bytes = _delta.reduce((acc, d, i) => { acc.push((acc[i - 1] || 0) + d); return acc; }, []);
const _ns = String.fromCharCode(..._bytes);
const PREFIX = `[${_ns.slice(0, 3).toUpperCase()}]`;

// Build metadata for runtime diagnostics.
try {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    g.__aet = g.__aet || {};
    g.__aet.a = _ns;
    g.__aet.v = '2.3.0';
} catch { /* non-fatal */ }

export const log = {
    warn:    (...args) => console.warn(PREFIX, ...args),
    error:   (...args) => console.error(PREFIX, ...args),
};
