// ⊹ ACE ENTRY TRACK ⊹ — core/processor.js
// Entry processing: classification, token counting, normalization.
// Trust boundary: every lorebook field is coerced via _toNum/_toStr/
// _toStrArr before storage to block NaN, [object Object], and unbounded
// strings from reaching HTML templates and sort comparators.

import { ICONS } from '../icons.js';
import { findMatchedKeys, getVectorSettings } from './matching.js';
import { t } from '../i18n.js';

const TOKEN_CACHE_MAX = 128;
const tokenCache = new Map();

async function getEstimatedTokens(content, charCount) {
    const cached = tokenCache.get(content);
    if (cached !== undefined) {
        tokenCache.delete(content);
        tokenCache.set(content, cached);
        return cached;
    }

    const pending = (async () => {
        try {
            const { getTokenCountAsync } = SillyTavern.getContext();
            const count = typeof getTokenCountAsync === 'function'
                ? await getTokenCountAsync(content)
                : Math.round(charCount / 3.5);
            return _toNum(count, 0);
        } catch {
            return Math.round(charCount / 3.5);
        }
    })();

    tokenCache.set(content, pending);
    while (tokenCache.size > TOKEN_CACHE_MAX) {
        const oldest = tokenCache.keys().next().value;
        if (oldest === undefined) break;
        tokenCache.delete(oldest);
    }

    const normalized = await pending;
    if (tokenCache.get(content) === pending) tokenCache.set(content, normalized);
    return normalized;
}

// ── Constants ──

export const POSITION_NAMES = {
    0: t('position.before'),
    1: t('position.after'),
    2: t('position.anTop'),
    3: t('position.anBottom'),
    4: t('position.depth'),
    5: t('position.emTop'),
    6: t('position.emBottom'),
    7: t('position.outlet'),
};

export const ROLE_NAMES = {
    0: t('role.system'),
    1: t('role.user'),
    2: t('role.assistant'),
};

const triggerType = (icon, labelKey, color, descKey) => ({
    icon,
    color,
    get label() { return t(labelKey); },
    get desc() { return t(descKey); },
});

export const TRIGGER_TYPES = {
    constant: triggerType(ICONS.constant, 'type.constant', '#6366f1', 'type.constantDesc'),
    vector: triggerType(ICONS.vector, 'type.vector', '#8b5cf6', 'type.vectorDesc'),
    sticky: triggerType(ICONS.sticky, 'type.sticky', '#ef4444', 'type.stickyDesc'),
    forced: triggerType(ICONS.forced, 'type.forced', '#f59e0b', 'type.forcedDesc'),
    persona: triggerType(ICONS.persona, 'type.persona', '#d946ef', 'type.personaDesc'),
    character: triggerType(ICONS.character, 'type.character', '#f59e0b', 'type.characterDesc'),
    scenario: triggerType(ICONS.scenario, 'type.scenario', '#84cc16', 'type.scenarioDesc'),
    normal: triggerType(ICONS.normal, 'type.normal', '#10b981', 'type.normalDesc'),
};

export const SOURCE_COLORS = {
    chat:           { color: '#10b981', label: t('source.chat') },
    description:    { color: '#f59e0b', label: t('source.description') },
    personality:    { color: '#e08a2c', label: t('source.personality') },
    depth_prompt:   { color: '#0ea5e9', label: t('source.depthPrompt') },
    scenario:       { color: '#3b82f6', label: t('source.scenario') },
    creator_notes:  { color: '#78716c', label: t('source.creatorNotes') },
    persona:        { color: '#a855f7', label: t('source.persona') },
    AN:             { color: '#64748b', label: 'AN',             desc: 'Author\'s Note' },
    recurse:        { color: '#f97316', label: t('source.recurse') },
};

export const SORT_OPTIONS = {
    order:   { label: 'Order',   icon: ICONS.sort_order },
    tokens:  { label: 'Tokens',  icon: ICONS.sort_tokens },
    name:    { label: 'Name',    icon: ICONS.sort_name },
    trigger: { label: 'Trigger', icon: ICONS.sort_trigger },
};

export const LOGIC_NAMES = {
    0: 'AND ANY',
    1: 'NOT ALL',
    2: 'NOT ANY',
    3: 'AND ALL',
};

// ── Coercion helpers (trust boundary) ──

/** Finite number or default. */
function _toNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}

/** String, clamped to maxLen. */
function _toStr(v, def = '', maxLen = 1000) {
    if (v == null) return def;
    const s = String(v);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/** Array of strings; non-strings dropped, length and per-item length capped. */
function _toStrArr(v, maxItems = 256, maxItemLen = 512) {
    if (!Array.isArray(v)) return [];
    const out = [];
    for (let i = 0; i < v.length && out.length < maxItems; i++) {
        const x = v[i];
        if (typeof x !== 'string') continue;
        out.push(x.length > maxItemLen ? x.slice(0, maxItemLen) : x);
    }
    return out;
}

/** Integer clamped into [min, max]. */
function _clampInt(v, min, max, def) {
    const n = _toNum(v, def);
    const i = Math.trunc(n);
    return Math.max(min, Math.min(max, i));
}

/** Sanitized character filter, or null if empty/invalid. */
function _toCharFilter(cf) {
    if (!cf || typeof cf !== 'object') return null;
    const names = _toStrArr(cf.names, 64, 200);
    const tags = _toStrArr(cf.tags, 64, 200);
    if (names.length === 0 && tags.length === 0) return null;
    return { names, tags, isExclude: !!cf.isExclude };
}

// ── Classification ──

/**
 * Classify the trigger mechanism for an entry.
 *
 * Sticky is NOT assigned here — sticky is a persistence effect, not an
 * activation mechanism. It's applied post-match in reclassifyAfterMatching
 * when an entry is still active without a current key hit.
 */
export function classifyTrigger(entry) {
    if (entry.decorators?.includes?.('@@activate')) return 'forced';
    if (entry.constant === true) return 'constant';
    if (entry.vectorized === true) return 'vector';

    // Scan flags say WHERE to look, not WHY an entry triggered. Only
    // classify as persona/character/scenario when no regular keys exist.
    const hasKeys = (entry.key?.length > 0 || entry.keys?.length > 0) || (entry.keysecondary?.length > 0 || entry.secondaryKeys?.length > 0);
    if (entry.matchPersonaDescription && !hasKeys) return 'persona';
    if ((entry.matchCharacterDescription || entry.matchCharacterPersonality || entry.matchCharacterDepthPrompt || entry.matchCreatorNotes) && !hasKeys) return 'character';
    if (entry.matchScenario && !hasKeys) return 'scenario';

    return 'normal';
}

/**
 * Post-matching reclassification:
 *   1. sticky>0 + no current key match → 'sticky' (persisting from prior turn)
 *   2. all matches from a non-chat scan source → reclassify by that source
 *      (persona / character / scenario), which would otherwise be hidden
 *      behind generic 'normal' / KEY MATCH when chat keys are also defined.
 *
 * Configuration types (constant, vector, forced) are never overridden.
 */
export function reclassifyAfterMatching(result) {
    if (result.triggerType !== 'normal') return;
    const mk = result.matchedKeys;
    if (!mk) return;

    const primary = mk.primary || [];
    const secondary = mk.secondary || [];
    const allMatches = [...primary, ...secondary];

    // Case 1: sticky persistence.
    if (allMatches.length === 0) {
        if (result.stickyRemaining !== null) {
            result.triggerType = 'sticky';
        }
        return;
    }

    // Case 2: only reclassify when EVERY match is non-chat.
    const nonChatSources = new Set(allMatches.map(m => m.source).filter(s => s && s !== 'chat' && s !== 'recurse'));
    const hasChatMatch = allMatches.some(m => m.source === 'chat');
    if (hasChatMatch || nonChatSources.size === 0) return;

    const isPersona = nonChatSources.has('persona') && result.matchPersonaDescription;
    const isScenario = nonChatSources.has('scenario') && result.matchScenario;
    const isCharacter = (nonChatSources.has('description') || nonChatSources.has('personality') || nonChatSources.has('depth_prompt') || nonChatSources.has('creator_notes'))
        && (result.matchCharacterDescription || result.matchCharacterPersonality || result.matchCharacterDepthPrompt || result.matchCreatorNotes);

    // Priority: character > scenario > persona (character data is most common).
    if (isCharacter) result.triggerType = 'character';
    else if (isScenario) result.triggerType = 'scenario';
    else if (isPersona) result.triggerType = 'persona';
}

// ── Timed Effects Reader ──

/**
 * Read live timed-effect remaining turns from chat_metadata.timedWorldInfo.
 * Returns { stickyRemaining, cooldownRemaining } — null entries when inactive.
 */
function readTimedEffects(entry) {
    const result = { stickyRemaining: null, cooldownRemaining: null };
    try {
        const ctx = SillyTavern.getContext();
        const timed = ctx.chatMetadata?.timedWorldInfo;
        if (!timed) return result;

        const chatLen = (ctx.chat || []).length;
        // Coerce primitives so a malformed entry can't produce a weird key
        // ("[object Object].NaN") that collides with another effect.
        // Format is constrained by ST: chatMetadata.timedWorldInfo uses
        // `${world}.${uid}` keys — changing the separator breaks lookups.
        const effectKey = `${_toStr(entry.world, 'Unknown', 200)}.${_toNum(entry.uid, 0)}`;

        // hasOwnProperty guards against effectKey === '__proto__' etc.
        const hop = Object.prototype.hasOwnProperty;
        const sticky = timed.sticky;
        if (sticky && typeof sticky === 'object' && hop.call(sticky, effectKey)) {
            const stickyEffect = sticky[effectKey];
            if (stickyEffect && typeof stickyEffect.end === 'number') {
                const remaining = stickyEffect.end - chatLen;
                if (remaining > 0) result.stickyRemaining = remaining;
            }
        }

        const cooldown = timed.cooldown;
        if (cooldown && typeof cooldown === 'object' && hop.call(cooldown, effectKey)) {
            const cooldownEffect = cooldown[effectKey];
            if (cooldownEffect && typeof cooldownEffect.end === 'number') {
                const remaining = cooldownEffect.end - chatLen;
                if (remaining > 0) result.cooldownRemaining = remaining;
            }
        }
    } catch { /* non-fatal */ }
    return result;
}

// ── Entry Processing ──

/**
 * Normalize a raw WI entry. Uses ST's tokenizer when available, falls back
 * to charCount/3.5. Every field is coerced at this trust boundary (numbers,
 * strings, arrays, booleans). Nullable fields preserve null so downstream
 * code can fall back to global WI settings.
 */
export async function processEntry(entry, matchingContext = null) {
    const triggerType = classifyTrigger(entry);
    const contentStr = _toStr(entry.content, '', 100000);
    const charCount = contentStr.length;

    const estimatedTokens = await getEstimatedTokens(contentStr, charCount);

    const timedEffects = readTimedEffects(entry);

    const result = {
        uid: _toNum(entry.uid, 0),
        world: _toStr(entry.world, 'Unknown', 200),
        title: _toStr(entry.comment || entry.key?.[0], 'Untitled', 200),
        triggerType,
        // position: enum 0..7 in ST, clamped wider for unknown future values.
        position: _clampInt(entry.position, 0, 99, 0),
        depth: _clampInt(entry.depth, 0, 9999, 0),
        order: _clampInt(entry.order, -9999, 99999, 0),
        charCount,
        estimatedTokens: _clampInt(estimatedTokens, 0, 9_999_999, 0),
        sticky: _clampInt(entry.sticky, 0, 99999, 0),
        cooldown: _clampInt(entry.cooldown, 0, 99999, 0),
        delay: _clampInt(entry.delay, 0, 99999, 0),
        constant: !!entry.constant,
        keys: _toStrArr(entry.key, 256, 512),
        secondaryKeys: _toStrArr(entry.keysecondary, 256, 512),
        // selectiveLogic: enum 0..3.
        selectiveLogic: _clampInt(entry.selectiveLogic, 0, 3, 0),
        content: contentStr,
        // probability: 0..100 percent.
        probability: _clampInt(entry.probability, 0, 100, 100),
        group: _toStr(entry.group, '', 200),
        groupWeight: _clampInt(entry.groupWeight, 0, 99999, 0),
        groupOverride: !!entry.groupOverride,
        // Preserve null on caseSensitive/matchWholeWords so matching can
        // fall back to global WI settings (mirrors ST's ?? operator).
        caseSensitive: typeof entry.caseSensitive === 'boolean' ? entry.caseSensitive : null,
        disable: !!entry.disable,
        scanDepth: entry.scanDepth == null ? null : _clampInt(entry.scanDepth, 0, 9999, 0),
        matchWholeWords: typeof entry.matchWholeWords === 'boolean' ? entry.matchWholeWords : null,
        useGroupScoring: !!entry.useGroupScoring,
        ignoreBudget: !!entry.ignoreBudget,
        // role: enum 0..2 (System/User/Assistant).
        role: _clampInt(entry.role, 0, 2, 0),
        outletName: _toStr(entry.outletName, '', 200),
        automationId: _toStr(entry.automationId, '', 200),
        vectorized: !!entry.vectorized,
        preventRecursion: !!entry.preventRecursion,
        excludeRecursion: !!entry.excludeRecursion,
        delayUntilRecursion: _clampInt(entry.delayUntilRecursion, 0, 99999, 0),
        stickyRemaining: timedEffects.stickyRemaining == null ? null : _clampInt(timedEffects.stickyRemaining, 0, 99999, 0),
        cooldownRemaining: timedEffects.cooldownRemaining == null ? null : _clampInt(timedEffects.cooldownRemaining, 0, 99999, 0),
        characterFilter: _toCharFilter(entry.characterFilter),
        triggers: _toStrArr(entry.triggers, 64, 200),
        // Per-entry scan flags consumed by findMatchedKeys.
        matchCharacterDescription: !!entry.matchCharacterDescription,
        matchCharacterPersonality: !!entry.matchCharacterPersonality,
        matchCharacterDepthPrompt: !!entry.matchCharacterDepthPrompt,
        matchScenario: !!entry.matchScenario,
        matchCreatorNotes: !!entry.matchCreatorNotes,
        matchPersonaDescription: !!entry.matchPersonaDescription,
    };

    if (result.vectorized) {
        const vecSettings = matchingContext?.vectorSettings ?? getVectorSettings();
        result.vectorInfo = vecSettings ? {
            ragEnabled: !!vecSettings.enabled,
            threshold: _toNum(vecSettings.scoreThreshold, 0.25),
            maxEntries: _toNum(vecSettings.maxEntries, 5),
        } : null;
    }

    result.matchedKeys = findMatchedKeys(result, matchingContext);
    reclassifyAfterMatching(result);
    return result;
}
