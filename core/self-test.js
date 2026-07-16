// ⊹ ACE ENTRY TRACK ⊹ — core/self-test.js
// Measures how much of ST's native activation list has a useful explanation.

import { entryKey } from '../utils/ids.js';

// ── Categories ──
//   MATCH      — key found in reconstructed context
//   EXPLAINED  — confirmed configuration or live sticky state explains it
//   RECURSIVE  — possible recursive explanation from final active content
//   UNRESOLVED — confirmed active, explanation unavailable
const Category = {
    MATCH: 'match',
    EXPLAINED: 'explained',
    RECURSIVE: 'recursive',
    UNRESOLVED: 'unresolved',
};

/**
 * Score processed entries (post processEntry + resolveRecursiveMatches).
 * @returns {{ total, match, explained, recursive, unresolved, coverage, perEntry: Map<string, string> }}
 */
export function evaluateExplanationCoverage(processedEntries) {
    const perEntry = new Map();
    let match = 0, explained = 0, recursive = 0, unresolved = 0;

    for (const entry of processedEntries) {
        const mk = entry.matchedKeys;
        if (!mk) {
            unresolved++;
            perEntry.set(entryKey(entry), Category.UNRESOLVED);
            continue;
        }

        const category = categorize(entry, mk);
        perEntry.set(entryKey(entry), category);

        switch (category) {
            case Category.MATCH:      match++;      break;
            case Category.EXPLAINED:  explained++;  break;
            case Category.RECURSIVE:  recursive++;  break;
            case Category.UNRESOLVED: unresolved++; break;
        }
    }

    const total = processedEntries.length;
    const reproduced = match + explained + recursive;
    const coverage = total > 0 ? Math.round((reproduced / total) * 100) : 100;

    return { total, match, explained, recursive, unresolved, coverage, perEntry };
}

function categorize(entry, mk) {
    if (entry.triggerType === 'constant' || entry.triggerType === 'forced') return Category.EXPLAINED;
    if (entry.triggerType === 'vector') return Category.UNRESOLVED;

    if (mk.primary.length > 0 || mk.secondary.length > 0) {
        const fromRecurse = [...mk.primary, ...mk.secondary].every(m => m.source === 'recurse');
        return fromRecurse ? Category.RECURSIVE : Category.MATCH;
    }

    if (entry.triggerType === 'sticky' && entry.stickyRemaining !== null) return Category.EXPLAINED;

    return Category.UNRESOLVED;
}

export { Category };
