// ⊹ ACE ENTRY TRACK ⊹ — utils/ids.js
// Composite entry identity: ST uids are only unique within a single
// lorebook (each book numbers 0,1,2,…), so multiple attached books
// produce uid collisions. Every identity site MUST use `world::uid`.

/**
 * Stable per-entry identifier safe across multiple lorebooks.
 *
 * Note: null / undefined / malformed entries collapse to "Unknown::0" by
 * design — callers expect a string back. Multiple null entries WILL share
 * the same key in any Map<entryKey, ...>; production paths shouldn't
 * pass null, but if you build a new identity-keyed structure, validate
 * non-null before keying.
 */
export function entryKey(entry) {
    if (!entry) return 'Unknown::0';
    const world = typeof entry.world === 'string' && entry.world ? entry.world : 'Unknown';
    const uid = Number.isFinite(entry.uid) ? entry.uid : 0;
    return `${world}::${uid}`;
}

/** Build an entryKey from separate world+uid (e.g. from dataset attrs). */
export function buildEntryKey(world, uid) {
    const w = typeof world === 'string' && world ? world : 'Unknown';
    const u = Number.isFinite(Number(uid)) ? Number(uid) : 0;
    return `${w}::${u}`;
}
