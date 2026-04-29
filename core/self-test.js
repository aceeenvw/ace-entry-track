// ⊹ ACE ENTRY TRACK ⊹ — core/self-test.js
// Compares our matcher against ST's actual activation, reports accuracy.

import { entryKey } from '../utils/ids.js';

// ── Categories ──
//   MATCH      — key match reproduced
//   EXPLAINED  — mechanism (constant / vector / forced / sticky / suppressed)
//   RECURSIVE  — explained by recursive scan into other entries' content
//   UNRESOLVED — ST activated it, we couldn't reproduce
const Category = {
    MATCH: 'match',
    EXPLAINED: 'explained',
    RECURSIVE: 'recursive',
    UNRESOLVED: 'unresolved',
};

/**
 * Score processed entries (post processEntry + resolveRecursiveMatches).
 * @returns {{ total, match, explained, recursive, unresolved, accuracy, perEntry }}
 */
export function evaluateAccuracy(processedEntries) {
    const perEntry = [];
    let match = 0, explained = 0, recursive = 0, unresolved = 0;

    for (const entry of processedEntries) {
        const mk = entry.matchedKeys;
        if (!mk) {
            unresolved++;
            perEntry.push({ uid: entryKey(entry), category: Category.UNRESOLVED });
            continue;
        }

        const category = categorize(entry, mk);
        perEntry.push({ uid: entryKey(entry), category });

        switch (category) {
            case Category.MATCH:      match++;      break;
            case Category.EXPLAINED:  explained++;  break;
            case Category.RECURSIVE:  recursive++;  break;
            case Category.UNRESOLVED: unresolved++; break;
        }
    }

    const total = processedEntries.length;
    const reproduced = match + explained + recursive;
    const accuracy = total > 0 ? Math.round((reproduced / total) * 100) : 100;

    return { total, match, explained, recursive, unresolved, accuracy, perEntry };
}

function categorize(entry, mk) {
    const mechanismTypes = ['constant', 'vector', 'forced', 'suppressed'];
    if (mechanismTypes.includes(entry.triggerType)) return Category.EXPLAINED;

    if (mk.primary.length > 0 || mk.secondary.length > 0) {
        const fromRecurse = [...mk.primary, ...mk.secondary].every(m => m.source === 'recurse');
        return fromRecurse ? Category.RECURSIVE : Category.MATCH;
    }

    if (entry.triggerType === 'sticky') return Category.EXPLAINED;
    if (mk.reason && mk.reason.includes('recursive scan')) return Category.RECURSIVE;

    return Category.UNRESOLVED;
}

export { Category };
