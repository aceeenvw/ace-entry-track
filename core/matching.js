// ⊹ ACE ENTRY TRACK ⊹ — core/matching.js
// Key matching engine: macro resolution, regex parsing, multi-source scan,
// global WI settings + per-entry scan flag merging, match-strength scoring,
// selective-logic evaluation, recursive resolution, potential-match detection.

import { log } from '../utils/log.js';
import { t } from '../i18n.js';
import { diagnoseRegexKey, REGEX_TOOL_LIMITS } from './regex-tools.js';

function setBoundedCache(cache, key, value, maxEntries) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
    }
}

// ── Global WI Settings Reader ──

export function getWIGlobalSettings() {
    const settings = {
        scanDepth: 2,
        includeNames: true,
        caseSensitive: false,
        matchWholeWords: false,
        minActivations: 0,
        minActivationsDepthMax: 0,
    };

    try {
        const readNum = (id) => {
            const el = document.getElementById(id);
            return el ? Number(el.value) || 0 : 0;
        };
        const readCheck = (id) => {
            const el = document.getElementById(id);
            return el ? !!el.checked : undefined;
        };

        const depth = readNum('world_info_depth');
        if (depth > 0) settings.scanDepth = depth;

        const incNames = readCheck('world_info_include_names');
        if (incNames !== undefined) settings.includeNames = incNames;

        const cs = readCheck('world_info_case_sensitive');
        if (cs !== undefined) settings.caseSensitive = cs;

        const mww = readCheck('world_info_match_whole_words');
        if (mww !== undefined) settings.matchWholeWords = mww;

        settings.minActivations = readNum('world_info_min_activations');
        settings.minActivationsDepthMax = readNum('world_info_min_activations_depth_max');
    } catch (e) {
        log.warn('Could not read WI global settings from DOM:', e);
    }

    return settings;
}

// ── Vector Extension Settings Reader ──

/** Read RAG settings from the optional vectors extension; null if absent. */
export function getVectorSettings() {
    try {
        const ctx = SillyTavern.getContext();
        const extSettings = ctx.extensionSettings?.vectors;
        if (!extSettings) return null;

        return {
            enabled: !!extSettings.enabled_world_info,
            enabledForAll: !!extSettings.enabled_for_all,
            maxEntries: extSettings.max_entries ?? 5,
            scoreThreshold: extSettings.score_threshold ?? 0.25,
        };
    } catch { /* non-fatal */ }
    return null;
}

/** Build immutable shared inputs and bounded per-generation caches. */
export function createMatchingContext() {
    const ctx = SillyTavern.getContext();
    const charId = ctx.characterId;
    const char = charId !== undefined ? ctx.characters?.[charId] : null;
    const charData = char?.data ?? null;
    const wiSettings = getWIGlobalSettings();
    const staticSources = [];

    _pushSource(staticSources, 'description', charData?.description, 'description');
    _pushSource(staticSources, 'personality', charData?.personality, 'personality');
    _pushSource(staticSources, 'depth_prompt', charData?.extensions?.depth_prompt?.prompt, 'depth_prompt');
    _pushSource(staticSources, 'scenario', charData?.scenario, 'scenario');
    _pushSource(staticSources, 'creator_notes', charData?.creator_notes || char?.creatorcomment, 'creator_notes');
    _pushSource(staticSources, 'persona', ctx.powerUserSettings?.persona_description, 'persona');

    for (const [key, prompt] of Object.entries(ctx.extensionPrompts || {})) {
        if (!prompt || typeof prompt !== 'object' || !prompt.scan || !prompt.value) continue;
        const label = key === '2_floating_prompt' ? 'AN' : String(key).slice(0, 100);
        _pushSource(staticSources, label, prompt.value, 'extension');
    }

    return {
        wiSettings,
        vectorSettings: getVectorSettings(),
        substituteParams: typeof ctx.substituteParams === 'function' ? ctx.substituteParams : null,
        chat: (ctx.chat || []).filter(m => !m.is_system),
        staticSources,
        chatSourceCache: new Map(),
        macroCache: new Map(),
        regexCache: new Map(),
        wordRegexCache: new Map(),
        lowercaseCache: new Map(),
        allSources: null,
    };
}

// ── Key Macro Resolution ──

export function resolveKeyMacros(key, matchingContext = null) {
    if (typeof key !== 'string') return '';
    if (matchingContext?.macroCache?.has(key)) return matchingContext.macroCache.get(key);

    let resolved = key;
    try {
        if (typeof matchingContext?.substituteParams === 'function') {
            const out = matchingContext.substituteParams(key);
            resolved = typeof out === 'string' ? out : key;
        } else {
            const ctx = SillyTavern.getContext();
            if (typeof ctx.substituteParams === 'function') {
                const out = ctx.substituteParams(key);
                resolved = typeof out === 'string' ? out : key;
            } else if (typeof window.substituteParams === 'function') {
                const out = window.substituteParams(key);
                resolved = typeof out === 'string' ? out : key;
            }
        }
    } catch { /* non-fatal */ }
    if (matchingContext?.macroCache && resolved.length <= 4096) {
        setBoundedCache(matchingContext.macroCache, key, resolved, 4096);
    }
    return resolved;
}

/** Parse a regex key /pattern/flags. Returns null if invalid or ReDoS-shaped. */
export function parseRegexKey(input, matchingContext = null) {
    const cacheable = typeof input === 'string' && input.length <= REGEX_TOOL_LIMITS.maxItemLength;
    if (cacheable && matchingContext?.regexCache?.has(input)) return matchingContext.regexCache.get(input);
    const diagnostic = diagnoseRegexKey(input);
    const regex = diagnostic.status === 'valid' ? diagnostic.regex : null;
    if (cacheable && matchingContext?.regexCache) setBoundedCache(matchingContext.regexCache, input, regex, 4096);
    return regex;
}

// The text cap limits ordinary matching work; risky regex shapes are rejected
// separately before execution.
const REGEX_TEXT_CAP = 200_000;

/** Test a single key (regex or literal) against text. */
export function matchKeyInText(key, text, caseSensitive, matchWholeWords, matchingContext = null) {
    const resolvedKey = resolveKeyMacros(key, matchingContext);
    if (!resolvedKey || typeof resolvedKey !== 'string' || !resolvedKey.trim()) return false;
    const trimmedKey = resolvedKey.trim();

    // Cap text up-front: same bound for regex AND literal paths.
    const boundedText = text.length > REGEX_TEXT_CAP ? text.slice(0, REGEX_TEXT_CAP) : text;

    const keyRegex = parseRegexKey(trimmedKey, matchingContext);
    if (keyRegex) {
        try {
            keyRegex.lastIndex = 0;
            return keyRegex.test(boundedText);
        } catch { return false; }
    }

    let haystack = boundedText;
    if (!caseSensitive) {
        const cached = matchingContext?.lowercaseCache?.get(boundedText);
        haystack = cached ?? boundedText.toLowerCase();
        if (cached === undefined && matchingContext?.lowercaseCache) {
            setBoundedCache(matchingContext.lowercaseCache, boundedText, haystack, 32);
        }
    }
    const needle = caseSensitive ? trimmedKey : trimmedKey.toLowerCase();

    if (matchWholeWords) {
        const words = needle.split(/\s+/);
        if (words.length > 1) return haystack.includes(needle);

        if (needle.length > REGEX_TOOL_LIMITS.maxItemLength) {
            let index = haystack.indexOf(needle);
            while (index !== -1) {
                const end = index + needle.length;
                const startsAtBoundary = index === 0 || /\W/.test(haystack[index - 1]);
                const endsAtBoundary = end === haystack.length || /\W/.test(haystack[end]);
                if (startsAtBoundary && endsAtBoundary) return true;
                index = haystack.indexOf(needle, index + 1);
            }
            return false;
        }

        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let regex = matchingContext?.wordRegexCache?.get(needle);
        if (!regex) {
            regex = new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`);
            if (matchingContext?.wordRegexCache) setBoundedCache(matchingContext.wordRegexCache, needle, regex, 4096);
        }
        regex.lastIndex = 0;
        return regex.test(haystack);
    }

    return haystack.includes(needle);
}

// ── Recursive Match Resolution ──

/**
 * Resolve "not reproduced" entries by checking their keys against the
 * combined content of final active entries as a possible recursive explanation.
 */
export function resolveRecursiveMatches(entries, matchingContext = null) {
    // ST excludes preventRecursion entries from the recurse buffer.
    // Cap the joined buffer at the same 200KB ceiling as every other
    // source — otherwise the literal-key matcher gets fed multi-MB input.
    const rawRecurseText = entries
        .filter(e => e.content && !e.preventRecursion)
        .map(e => e.content)
        .join('\n');
    const recurseText = _asSourceText(rawRecurseText);

    if (!recurseText) return;

    const wiSettings = matchingContext?.wiSettings || getWIGlobalSettings();

    for (const entry of entries) {
        const mk = entry.matchedKeys;
        if (!mk) continue;

        const isUnresolved = entry.triggerType === 'normal'
            && mk.primary.length === 0
            && mk.secondary.length === 0
            && (entry.keys?.length > 0 || entry.secondaryKeys?.length > 0);
        if (!isUnresolved) continue;

        const effectiveCaseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
        const effectiveMatchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;

        const primary = testKeysAllSources(
            entry.keys || [], [{ label: 'recurse', text: recurseText }],
            effectiveCaseSensitive, effectiveMatchWholeWords, matchingContext,
        );
        const secondary = testKeysAllSources(
            entry.secondaryKeys || [], [{ label: 'recurse', text: recurseText }],
            effectiveCaseSensitive, effectiveMatchWholeWords, matchingContext,
        );

        if (primary.length > 0 || secondary.length > 0) {
            // Dedup by key+source pair before appending.
            const existingPrimary = new Set(mk.primary.map(m => `${m.key}::${m.source}`));
            const existingSecondary = new Set(mk.secondary.map(m => `${m.key}::${m.source}`));
            for (const m of primary) {
                const id = `${m.key}::${m.source}`;
                if (!existingPrimary.has(id)) { mk.primary.push(m); existingPrimary.add(id); }
            }
            for (const m of secondary) {
                const id = `${m.key}::${m.source}`;
                if (!existingSecondary.has(id)) { mk.secondary.push(m); existingSecondary.add(id); }
            }
            mk.sources = [...new Set([...mk.sources, 'recurse'])];
            mk.reason = t('reason.recursive');
        }
    }
}

// ── Source Building ──

// ST uses \x01 as per-message boundary in the scan buffer; regex keys
// can anchor to it (e.g. /\x01{{user}}:[^\x01]*?hello/).
const MATCHER = '\x01';
const JOINER = '\n' + MATCHER;

/** Coerce an arbitrary source value to a bounded string. */
function _asSourceText(v, maxLen = 200_000) {
    if (typeof v !== 'string') return '';
    return v.length > maxLen ? v.slice(0, maxLen) : v;
}

/** Append a source iff its coerced text is non-empty. */
function _pushSource(list, label, raw, type = null) {
    const text = _asSourceText(raw);
    if (text) list.push({ label, text, type });
}

/**
 * Format chat into ST's WorldInfoBuffer shape: each message prefixed with
 * \x01 so regex keys can anchor to message boundaries. Stripping \x01 from
 * message bodies prevents a copy-pasted or malicious char from creating
 * spurious boundary matches.
 */
function formatChatBuffer(messages, includeNames) {
    if (messages.length === 0) return '';
    return MATCHER + messages.map(m => {
        const raw = typeof m.mes === 'string' ? m.mes : '';
        const msg = raw.indexOf(MATCHER) >= 0 ? raw.split(MATCHER).join('') : raw;
        const name = typeof m.name === 'string' ? m.name : '';
        if (includeNames && name) return `${name}: ${msg}`;
        return msg;
    }).join(JOINER);
}

/** Build the source list this entry would scan (per its own flags). */
export function buildSourcesForEntry(entry, matchingContext = null) {
    const shared = matchingContext || createMatchingContext();
    const wiSettings = shared.wiSettings;

    const sources = [];

    // When min_activations is active, ST scans deeper to find enough
    // entries — mirror that wider range so we can reproduce matches.
    let depth = entry.scanDepth;
    if (depth === null || depth === undefined) depth = wiSettings.scanDepth || 2;
    if (wiSettings.minActivations > 0 && wiSettings.minActivationsDepthMax > 0) {
        depth = Math.max(depth, wiSettings.minActivationsDepthMax);
    }

    const cacheKey = `${depth}:${wiSettings.includeNames ? 1 : 0}`;
    let chatText = shared.chatSourceCache.get(cacheKey);
    if (chatText === undefined) {
        const recent = depth > 0 ? shared.chat.slice(-depth) : [];
        chatText = formatChatBuffer(recent, wiSettings.includeNames);
        setBoundedCache(shared.chatSourceCache, cacheKey, chatText, 32);
    }

    if (chatText) _pushSource(sources, 'chat', chatText);
    for (const source of shared.staticSources) {
        const enabled = source.type === 'description' ? entry.matchCharacterDescription
            : source.type === 'personality' ? entry.matchCharacterPersonality
                : source.type === 'depth_prompt' ? entry.matchCharacterDepthPrompt
                    : source.type === 'scenario' ? entry.matchScenario
                        : source.type === 'creator_notes' ? entry.matchCreatorNotes
                            : source.type === 'persona' ? entry.matchPersonaDescription
                                : true;
        if (enabled) sources.push(source);
    }

    return sources;
}

/**
 * Build EVERY available source ignoring per-entry flags. Used for
 * mechanism-driven entries to surface what *could* have matched.
 */
export function buildAllSources(matchingContext = null) {
    const shared = matchingContext || createMatchingContext();
    if (shared.allSources) return shared.allSources;

    const sources = [];
    const depth = shared.wiSettings.scanDepth;
    const cacheKey = `${depth}:${shared.wiSettings.includeNames ? 1 : 0}`;
    let chatText = shared.chatSourceCache.get(cacheKey);
    if (chatText === undefined) {
        chatText = depth > 0 ? formatChatBuffer(shared.chat.slice(-depth), shared.wiSettings.includeNames) : '';
        setBoundedCache(shared.chatSourceCache, cacheKey, chatText, 32);
    }
    if (chatText) _pushSource(sources, 'chat', chatText);
    sources.push(...shared.staticSources);
    shared.allSources = sources;
    return sources;
}

// ── Multi-Source Key Testing ──

export function testKeysAllSources(keys, sources, caseSensitive, matchWholeWords, matchingContext = null) {
    const results = [];
    for (const key of keys) {
        if (!key) continue;
        for (const src of sources) {
            if (matchKeyInText(key, src.text, caseSensitive, matchWholeWords, matchingContext)) {
                results.push({ key, source: src.label });
            }
        }
    }
    return results;
}

// ── Selective Logic Evaluation ──

/**
 * Mirror ST's secondary-key logic. logicType: 0=AND_ANY, 1=NOT_ALL,
 * 2=NOT_ANY, 3=AND_ALL.
 * @returns {{ satisfied: boolean, explanation: string }}
 */
export function evaluateSelectiveLogic(primaryHits, secondaryHits, secondaryTotal, logicType) {
    if (secondaryTotal === 0) {
        return { satisfied: primaryHits > 0, explanation: t(primaryHits > 0 ? 'logic.noSecondaryPass' : 'logic.noPrimary') };
    }

    const p = primaryHits > 0;
    switch (logicType) {
        case 0: // AND_ANY
            return {
                satisfied: p && secondaryHits > 0,
                explanation: t('logic.result', { logic: 'AND_ANY', primary: primaryHits, secondary: secondaryHits, total: secondaryTotal, status: t(p && secondaryHits > 0 ? 'logic.satisfied' : 'logic.unsatisfied') }),
            };
        case 1: // NOT_ALL
            return {
                satisfied: p && secondaryHits < secondaryTotal,
                explanation: t('logic.secondaryResult', { logic: 'NOT_ALL', secondary: secondaryHits, total: secondaryTotal, status: t(p && secondaryHits < secondaryTotal ? 'logic.satisfied' : 'logic.unsatisfied') }),
            };
        case 2: // NOT_ANY
            return {
                satisfied: p && secondaryHits === 0,
                explanation: t('logic.secondaryResult', { logic: 'NOT_ANY', secondary: secondaryHits, total: secondaryTotal, status: t(p && secondaryHits === 0 ? 'logic.satisfied' : 'logic.unsatisfied') }),
            };
        case 3: // AND_ALL
            return {
                satisfied: p && secondaryHits === secondaryTotal,
                explanation: t('logic.secondaryResult', { logic: 'AND_ALL', secondary: secondaryHits, total: secondaryTotal, status: t(p && secondaryHits === secondaryTotal ? 'logic.satisfied' : 'logic.unsatisfied') }),
            };
        default:
            return { satisfied: p, explanation: t('logic.unknown', { logic: logicType, primary: primaryHits }) };
    }
}

// ── Potential Match Detection ──

/**
 * Find keys present in sources the entry does NOT scan. Surfaces likely
 * scan-flag misconfigurations.
 */
function computePotentialMatches(entry, actualPrimary, actualSecondary, caseSensitive, matchWholeWords, isMechanismDriven, matchingContext) {
    if (isMechanismDriven) return [];

    const allSources = buildAllSources(matchingContext);
    const entrySources = buildSourcesForEntry(entry, matchingContext);
    const sourceId = source => `${source.type || source.label}\u0000${source.label}`;
    const entrySourceIds = new Set(entrySources.map(sourceId));

    const unseenSources = allSources.filter(source => !entrySourceIds.has(sourceId(source)));
    if (unseenSources.length === 0) return [];

    const allKeys = [...(entry.keys || []), ...(entry.secondaryKeys || [])];
    if (allKeys.length === 0) return [];

    const actualSet = new Set([
        ...actualPrimary.map(m => `${m.key}::${m.source}`),
        ...actualSecondary.map(m => `${m.key}::${m.source}`),
    ]);

    const potential = [];
    for (const key of allKeys) {
        if (!key) continue;
        for (const src of unseenSources) {
            if (matchKeyInText(key, src.text, caseSensitive, matchWholeWords, matchingContext)) {
                const id = `${key}::${src.label}`;
                if (!actualSet.has(id)) potential.push({ key, source: src.label });
            }
        }
    }
    return potential;
}

// ── Match Orchestration ──

/**
 * Find matched keys grouped by reconstructed source. Configuration-driven
 * entries also receive key analysis for context, without claiming native
 * an activation source that ST does not expose.
 *
 * Returns { primary, secondary, potential, sources, reason, matchStrength, logicResult }.
 */
export function findMatchedKeys(entry, matchingContext = null) {
    const shared = matchingContext || createMatchingContext();
    const hasKeys = (entry.keys?.length > 0);
    const hasSecondary = (entry.secondaryKeys?.length > 0);

    const mechanismLabels = {
        constant: t('reason.constant'),
        vector: t('reason.vector'),
        forced: t('reason.forced'),
    };

    const mechanismType = entry.triggerType;
    const isMechanismDriven = ['constant', 'vector', 'forced'].includes(mechanismType);

    if (isMechanismDriven && !hasKeys && !hasSecondary) {
        return {
            primary: [], secondary: [], potential: [], sources: [],
            reason: mechanismLabels[mechanismType],
            matchStrength: null,
        };
    }

    // Mechanism-driven entries scan ALL sources for informational overlap;
    // regular entries use only per-entry scan flags.
    const sources = isMechanismDriven ? buildAllSources(shared) : buildSourcesForEntry(entry, shared);

    if (sources.length === 0) {
        const hasSticky = entry.stickyRemaining !== null;
        return {
            primary: [], secondary: [], potential: isMechanismDriven ? [] : null, sources: [],
            reason: hasSticky
                ? t('reason.sticky', { count: entry.stickyRemaining, suffix: entry.stickyRemaining === 1 ? '' : 's' })
                : (isMechanismDriven ? mechanismLabels[mechanismType] : t('reason.noText')),
            matchStrength: null,
        };
    }

    const wiSettings = shared.wiSettings;
    const effectiveCaseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
    const effectiveMatchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;

    const primary = testKeysAllSources(entry.keys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords, shared);
    const secondary = testKeysAllSources(entry.secondaryKeys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords, shared);

    const primaryTotal = (entry.keys || []).filter(k => k).length;
    const secondaryTotal = (entry.secondaryKeys || []).filter(k => k).length;
    const primaryUniqueHits = new Set(primary.map(m => m.key)).size;
    const secondaryUniqueHits = new Set(secondary.map(m => m.key)).size;
    const allMatchedSources = new Set([...primary, ...secondary].map(m => m.source));

    const matchStrength = {
        primaryHit: primaryUniqueHits,
        primaryTotal,
        secondaryHit: secondaryUniqueHits,
        secondaryTotal,
        sourceCount: allMatchedSources.size,
    };

    let logicResult = null;
    if (entry.selectiveLogic !== undefined && entry.selectiveLogic !== null && secondaryTotal > 0) {
        logicResult = evaluateSelectiveLogic(primaryUniqueHits, secondaryUniqueHits, secondaryTotal, entry.selectiveLogic);
    }

    if (isMechanismDriven) {
        let reason = mechanismLabels[mechanismType];
        if (primary.length > 0 || secondary.length > 0) reason += t('reason.keysAlso');
        return { primary, secondary, potential: [], sources: [...allMatchedSources], reason, matchStrength, logicResult };
    }

    // ST activated but we couldn't reproduce — best-guess reason.
    if (primary.length === 0 && secondary.length === 0) {
        let reason;
        const hasAnyKeys = hasKeys || hasSecondary;
        const hasSticky = entry.stickyRemaining !== null;
        if (hasSticky) reason = t('reason.sticky', { count: entry.stickyRemaining, suffix: entry.stickyRemaining === 1 ? '' : 's' });
        else if (!hasAnyKeys) reason = t('reason.noKeys');
        else reason = t('reason.notReconstructed');

        return { primary: [], secondary: [], potential: null, sources: [], reason, matchStrength, logicResult };
    }

    return {
        primary,
        secondary,
        potential: null,
        sources: [...allMatchedSources],
        reason: t('reason.keyFound'),
        matchStrength,
        logicResult,
    };
}

/** Compute expensive unscanned-source matches only when the UI requests them. */
export function ensurePotentialMatches(entry, matchingContext = null) {
    const mk = entry?.matchedKeys;
    if (!mk) return [];
    if (Array.isArray(mk.potential)) return mk.potential;

    const shared = matchingContext || createMatchingContext();
    const wiSettings = shared.wiSettings;
    const caseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
    const matchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;
    const mechanismDriven = ['constant', 'vector', 'forced'].includes(entry.triggerType);
    mk.potential = computePotentialMatches(
        entry,
        mk.primary || [],
        mk.secondary || [],
        caseSensitive,
        matchWholeWords,
        mechanismDriven,
        shared,
    );
    return mk.potential;
}
