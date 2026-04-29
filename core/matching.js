// ⊹ ACE ENTRY TRACK ⊹ — core/matching.js
// Key matching engine: macro resolution, regex parsing, multi-source scan,
// global WI settings + per-entry scan flag merging, match-strength scoring,
// selective-logic evaluation, recursive resolution, potential-match detection.

import { log } from '../utils/log.js';

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

// ── Key Macro Resolution ──

export function resolveKeyMacros(key) {
    if (typeof key !== 'string') return '';
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.substituteParams === 'function') {
            const out = ctx.substituteParams(key);
            return typeof out === 'string' ? out : key;
        }
        if (typeof window.substituteParams === 'function') {
            const out = window.substituteParams(key);
            return typeof out === 'string' ? out : key;
        }
    } catch { /* non-fatal */ }
    return key;
}

// Reject regex patterns containing a quantified group followed by another
// quantifier — the classic ReDoS shape (a+)+ / (a*)* / (a{1,5}+)*. Heuristic;
// rejected patterns silently fall through to literal-key matching at the
// call site, mirroring parseRegexKey's other failure semantics.
function _hasNestedQuantifier(pattern) {
    return /\([^)]*[+*][^)]*\)\s*[+*?{]/.test(pattern)
        || /\([^)]*\{\d+,?\d*\}[^)]*\)\s*[+*?{]/.test(pattern);
}

/** Parse a regex key /pattern/flags. Returns null if invalid or ReDoS-shaped. */
export function parseRegexKey(input) {
    // Modern JS flags incl. d (hasIndices) and v (unicodeSets).
    const match = input.match(/^\/([\s\S]+?)\/([dgimsuvy]*)$/);
    if (!match) return null;

    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) return null;
    pattern = pattern.replaceAll('\\/', '/');
    if (_hasNestedQuantifier(pattern)) return null;

    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

// Hard cap on regex input length. Catastrophic-backtracking patterns run
// O(2^n) over text length; 200KB bounds worst-case hang to milliseconds.
// The same cap also applies to the literal-key path so a multi-MB
// recurseText buffer can't freeze the main thread on String.includes().
const REGEX_TEXT_CAP = 200_000;

/** Test a single key (regex or literal) against text. */
export function matchKeyInText(key, text, caseSensitive, matchWholeWords) {
    const resolvedKey = resolveKeyMacros(key);
    if (!resolvedKey || typeof resolvedKey !== 'string' || !resolvedKey.trim()) return false;
    const trimmedKey = resolvedKey.trim();

    // Cap text up-front: same bound for regex AND literal paths.
    const boundedText = text.length > REGEX_TEXT_CAP ? text.slice(0, REGEX_TEXT_CAP) : text;

    const keyRegex = parseRegexKey(trimmedKey);
    if (keyRegex) {
        try { return keyRegex.test(boundedText); } catch { return false; }
    }

    const haystack = caseSensitive ? boundedText : boundedText.toLowerCase();
    const needle = caseSensitive ? trimmedKey : trimmedKey.toLowerCase();

    if (matchWholeWords) {
        const words = needle.split(/\s+/);
        if (words.length > 1) return haystack.includes(needle);

        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|\\W)(${escaped})(?:$|\\W)`);
        return regex.test(haystack);
    }

    return haystack.includes(needle);
}

// ── Recursive Match Resolution ──

/**
 * Resolve "not reproduced" entries by checking their keys against the
 * combined content of other activated entries (simulates ST's recursion).
 */
export function resolveRecursiveMatches(entries) {
    // ST excludes preventRecursion entries from the recurse buffer.
    // Cap the joined buffer at the same 200KB ceiling as every other
    // source — otherwise the literal-key matcher gets fed multi-MB input.
    const rawRecurseText = entries
        .filter(e => e.content && !e.preventRecursion)
        .map(e => e.content)
        .join('\n');
    const recurseText = _asSourceText(rawRecurseText);

    if (!recurseText) return;

    const wiSettings = getWIGlobalSettings();

    for (const entry of entries) {
        const mk = entry.matchedKeys;
        if (!mk) continue;

        const isUnresolved = mk.reason && mk.reason.includes('not reproduced');
        if (!isUnresolved) continue;

        const effectiveCaseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
        const effectiveMatchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;

        const primary = testKeysAllSources(
            entry.keys || [], [{ label: 'recurse', text: recurseText }],
            effectiveCaseSensitive, effectiveMatchWholeWords,
        );
        const secondary = testKeysAllSources(
            entry.secondaryKeys || [], [{ label: 'recurse', text: recurseText }],
            effectiveCaseSensitive, effectiveMatchWholeWords,
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
            mk.reason = 'Activated via recursive scan (key found in other entries\' content)';
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
function _pushSource(list, label, raw) {
    const text = _asSourceText(raw);
    if (text) list.push({ label, text });
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
export function buildSourcesForEntry(entry) {
    const ctx = SillyTavern.getContext();
    const charId = ctx.characterId;
    const charData = charId !== undefined ? ctx.characters?.[charId]?.data : null;
    const wiSettings = getWIGlobalSettings();

    const sources = [];

    // When min_activations is active, ST scans deeper to find enough
    // entries — mirror that wider range so we can reproduce matches.
    const chat = ctx.chat || [];
    let depth = entry.scanDepth;
    if (depth === null || depth === undefined) depth = wiSettings.scanDepth || 2;
    if (wiSettings.minActivations > 0 && wiSettings.minActivationsDepthMax > 0) {
        depth = Math.max(depth, wiSettings.minActivationsDepthMax);
    }

    const recent = depth > 0 ? chat.filter(m => !m.is_system).slice(-depth) : [];
    const chatText = formatChatBuffer(recent, wiSettings.includeNames);

    if (chatText) _pushSource(sources, 'chat', chatText);
    if (entry.matchCharacterDescription)      _pushSource(sources, 'description',   charData?.description);
    if (entry.matchCharacterPersonality)      _pushSource(sources, 'personality',   charData?.personality);
    if (entry.matchCharacterDepthPrompt)      _pushSource(sources, 'depth_prompt',  charData?.extensions?.depth_prompt?.prompt);
    if (entry.matchScenario)                  _pushSource(sources, 'scenario',      charData?.scenario);
    if (entry.matchCreatorNotes)              _pushSource(sources, 'creator_notes', charData?.creator_notes);
    if (entry.matchPersonaDescription)        _pushSource(sources, 'persona',       ctx.powerUserSettings?.persona_description);

    // Extension prompts with scan enabled (Author's Note and others).
    // Labels are escaped when rendered, so an injected key can't break HTML.
    const extPrompts = ctx.extensionPrompts || {};
    for (const [key, prompt] of Object.entries(extPrompts)) {
        if (!prompt || typeof prompt !== 'object') continue;
        if (prompt.scan && prompt.value) {
            const label = key === '2_floating_prompt' ? 'AN' : String(key).slice(0, 100);
            _pushSource(sources, label, prompt.value);
        }
    }

    return sources;
}

/**
 * Build EVERY available source ignoring per-entry flags. Used for
 * mechanism-driven entries to surface what *could* have matched.
 */
export function buildAllSources() {
    const ctx = SillyTavern.getContext();
    const charId = ctx.characterId;
    const charData = charId !== undefined ? ctx.characters?.[charId]?.data : null;
    const wiSettings = getWIGlobalSettings();

    const sources = [];

    const chat = ctx.chat || [];
    const depth = wiSettings.scanDepth;
    if (depth > 0) {
        const recent = chat.filter(m => !m.is_system).slice(-depth);
        const chatText = formatChatBuffer(recent, wiSettings.includeNames);
        if (chatText) _pushSource(sources, 'chat', chatText);
    }

    _pushSource(sources, 'description',   charData?.description);
    _pushSource(sources, 'personality',   charData?.personality);
    _pushSource(sources, 'depth_prompt',  charData?.extensions?.depth_prompt?.prompt);
    _pushSource(sources, 'scenario',      charData?.scenario);
    _pushSource(sources, 'creator_notes', charData?.creator_notes);
    _pushSource(sources, 'persona',       ctx.powerUserSettings?.persona_description);

    const extPrompts = ctx.extensionPrompts || {};
    for (const [key, prompt] of Object.entries(extPrompts)) {
        if (!prompt || typeof prompt !== 'object') continue;
        if (prompt.scan && prompt.value) {
            const label = key === '2_floating_prompt' ? 'AN' : String(key).slice(0, 100);
            _pushSource(sources, label, prompt.value);
        }
    }

    return sources;
}

// ── Multi-Source Key Testing ──

export function testKeysAllSources(keys, sources, caseSensitive, matchWholeWords) {
    const results = [];
    for (const key of keys) {
        if (!key) continue;
        for (const src of sources) {
            if (matchKeyInText(key, src.text, caseSensitive, matchWholeWords)) {
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
        return { satisfied: primaryHits > 0, explanation: primaryHits > 0 ? 'No secondary keys — primary match sufficient' : 'No primary keys matched' };
    }

    const p = primaryHits > 0;
    switch (logicType) {
        case 0: // AND_ANY
            return {
                satisfied: p && secondaryHits > 0,
                explanation: `AND_ANY: ${primaryHits} primary + ${secondaryHits}/${secondaryTotal} secondary ${p && secondaryHits > 0 ? '= satisfied' : '= not satisfied'}`,
            };
        case 1: // NOT_ALL
            return {
                satisfied: p && secondaryHits < secondaryTotal,
                explanation: `NOT_ALL: ${secondaryHits}/${secondaryTotal} secondary matched ${p && secondaryHits < secondaryTotal ? `(need < ${secondaryTotal}) = satisfied` : `= not satisfied`}`,
            };
        case 2: // NOT_ANY
            return {
                satisfied: p && secondaryHits === 0,
                explanation: `NOT_ANY: ${secondaryHits}/${secondaryTotal} secondary matched ${p && secondaryHits === 0 ? '(need 0) = satisfied' : '= not satisfied'}`,
            };
        case 3: // AND_ALL
            return {
                satisfied: p && secondaryHits === secondaryTotal,
                explanation: `AND_ALL: ${secondaryHits}/${secondaryTotal} secondary matched ${p && secondaryHits === secondaryTotal ? `(need all ${secondaryTotal}) = satisfied` : '= not satisfied'}`,
            };
        default:
            return { satisfied: p, explanation: `Unknown logic ${logicType}: ${primaryHits} primary matched` };
    }
}

// ── Potential Match Detection ──

/**
 * Find keys present in sources the entry does NOT scan. Surfaces likely
 * scan-flag misconfigurations.
 */
function computePotentialMatches(entry, actualPrimary, actualSecondary, caseSensitive, matchWholeWords, isMechanismDriven) {
    if (isMechanismDriven) return [];

    const allSources = buildAllSources();
    const entrySources = buildSourcesForEntry(entry);
    const entrySourceLabels = new Set(entrySources.map(s => s.label));

    const unseenSources = allSources.filter(s => !entrySourceLabels.has(s.label));
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
            if (matchKeyInText(key, src.text, caseSensitive, matchWholeWords)) {
                const id = `${key}::${src.label}`;
                if (!actualSet.has(id)) potential.push({ key, source: src.label });
            }
        }
    }
    return potential;
}

// ── Match Orchestration ──

/**
 * Find matched keys grouped by source. Mechanism-driven entries
 * (constant / vector / forced / suppressed) also receive key analysis
 * for context — `reason` explains the primary activation, matched keys
 * provide additional context.
 *
 * Returns { primary, secondary, potential, sources, reason, matchStrength, logicResult }.
 */
export function findMatchedKeys(entry) {
    const hasKeys = (entry.keys?.length > 0);
    const hasSecondary = (entry.secondaryKeys?.length > 0);

    const mechanismLabels = {
        constant: 'Always active — no key match required',
        vector: 'Activated via vector/RAG similarity',
        forced: 'Force-activated by @@activate decorator',
        suppressed: 'Blocked by @@dont_activate decorator',
    };

    const mechanismType = entry.triggerType;
    const isMechanismDriven = ['constant', 'vector', 'forced', 'suppressed'].includes(mechanismType);

    if (isMechanismDriven && !hasKeys && !hasSecondary) {
        return {
            primary: [], secondary: [], potential: [], sources: [],
            reason: mechanismLabels[mechanismType],
            matchStrength: null,
        };
    }

    // Mechanism-driven entries scan ALL sources for informational overlap;
    // regular entries use only per-entry scan flags.
    const sources = isMechanismDriven ? buildAllSources() : buildSourcesForEntry(entry);

    if (sources.length === 0) {
        const hasSticky = entry.sticky && entry.sticky > 0;
        return {
            primary: [], secondary: [], potential: [], sources: [],
            reason: hasSticky
                ? `Persisting from earlier trigger (sticky ${entry.sticky} turns)`
                : (isMechanismDriven ? mechanismLabels[mechanismType] : 'No scannable text found'),
            matchStrength: null,
        };
    }

    const wiSettings = getWIGlobalSettings();
    const effectiveCaseSensitive = entry.caseSensitive ?? wiSettings.caseSensitive;
    const effectiveMatchWholeWords = entry.matchWholeWords ?? wiSettings.matchWholeWords;

    const primary = testKeysAllSources(entry.keys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords);
    const secondary = testKeysAllSources(entry.secondaryKeys || [], sources, effectiveCaseSensitive, effectiveMatchWholeWords);

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
        if (primary.length > 0 || secondary.length > 0) reason += ' (keys also present in context)';
        return { primary, secondary, potential: [], sources: [...allMatchedSources], reason, matchStrength, logicResult };
    }

    // ST activated but we couldn't reproduce — best-guess reason.
    if (primary.length === 0 && secondary.length === 0) {
        let reason;
        const hasAnyKeys = hasKeys || hasSecondary;
        const hasSticky = entry.sticky && entry.sticky > 0;
        if (hasSticky) reason = `Persisting from earlier trigger (sticky ${entry.sticky} turns)`;
        else if (!hasAnyKeys) reason = 'Activated by ST — no keys defined (possible external activation via WORLDINFO_FORCE_ACTIVATE)';
        else reason = 'Activated by ST — key match not reproduced (possible causes: scan depth difference, min_activations deep scan, external activation, or timing)';

        return { primary: [], secondary: [], potential: [], sources: [], reason, matchStrength, logicResult };
    }

    const potential = computePotentialMatches(entry, primary, secondary, effectiveCaseSensitive, effectiveMatchWholeWords, isMechanismDriven);
    return { primary, secondary, potential, sources: [...allMatchedSources], reason: null, matchStrength, logicResult };
}
