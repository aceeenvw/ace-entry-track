import { evaluateSelectiveLogic, getWIGlobalSettings, matchKeyInText } from './matching.js';
import { t } from '../i18n.js';


export function testEntryText(entry, text, settings = getWIGlobalSettings()) {
    const primary = Array.isArray(entry.key) ? entry.key : [];
    const secondary = entry.selective && Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
    if (text.length > 4096 || primary.length + secondary.length > 256 ||
        [...primary, ...secondary].some(k => typeof k !== 'string' || k.length > 512)) return { issue: 'limit' };
    // Don't execute template macros (some mutate chat variables) during a hypothetical test.
    if ([...primary, ...secondary].some(k => k.includes('{{'))) return { issue: 'macro' };
    const context = { substituteParams: key => key, lowercaseCache: new Map() };
    const hits = keys => keys.filter(k => matchKeyInText(k, text, entry.caseSensitive ?? settings.caseSensitive,
        entry.matchWholeWords ?? settings.matchWholeWords, context));
    const a = hits(primary), b = hits(secondary);
    return { primary: a, secondary: b, ...evaluateSelectiveLogic(a.length, b.length, secondary.length, entry.selectiveLogic ?? 0) };
}
