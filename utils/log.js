// ⊹ ACE ENTRY TRACK ⊹ — utils/log.js
// Centralized logger. The console tag is derived from a compact byte
// table so every call site shares one canonical namespace.

const _delta = [97, 2, 2, 0, 9, 8, 1];
const _bytes = _delta.reduce((acc, d, i) => { acc.push((acc[i - 1] || 0) + d); return acc; }, []);
const _ns = String.fromCharCode(..._bytes);
const PREFIX = `[${_ns.slice(0, 3).toUpperCase()}]`;

// Build metadata for runtime diagnostics. Set __aet.verbose = true in the
// console to surface full info/debug output beyond the default summary line.
try {
    const g = (typeof globalThis !== 'undefined') ? globalThis : window;
    g.__aet = g.__aet || {};
    g.__aet.a = _ns;
    g.__aet.v = '2.1.0';
} catch { /* non-fatal */ }

// Quiet by default: only warnings, errors, and one-line per-generation
// summaries print. Set globalThis.__aet.verbose = true for full info/debug.
const _verbose = () => {
    try { return !!(globalThis.__aet && globalThis.__aet.verbose); } catch { return false; }
};

export const log = {
    summary: (...args) => console.log(PREFIX, ...args),
    info:    (...args) => { if (_verbose()) console.log(PREFIX, ...args); },
    warn:    (...args) => console.warn(PREFIX, ...args),
    error:   (...args) => console.error(PREFIX, ...args),
    debug:   (...args) => { if (_verbose()) console.debug(PREFIX, ...args); },
};
