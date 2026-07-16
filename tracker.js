// ACE ENTRY TRACK - tracker.js
// Orchestrator: event wiring, lifecycle. All logic in core/* and ui/*.

import { addDiscoveredLorebook, getScannerState } from './scanner.js';
import { log } from './utils/log.js';
import { state, computeDiff, computeGroupMetadata, resetState } from './core/state.js';
import { processEntry } from './core/processor.js';
import { createMatchingContext, findMatchedKeys, resolveRecursiveMatches } from './core/matching.js';
import { evaluateExplanationCoverage } from './core/self-test.js';
import { initTriggerButton, updateBadge, setButtonVisible, closePanel, clearWIHighlights } from './ui/trigger-button.js';
import { initPanel, renderPanel, attachPanelGlobals, detachPanelGlobals } from './ui/panel.js';

let _getSettings;

// Generation counter: stale async results from a prior turn are discarded.
let _activationGeneration = 0;

// ST awaits event listeners sequentially. Keep WORLD_INFO_ACTIVATED synchronous
// and move all expensive analysis into a later task so generation can continue.
let _pendingActivation = null;
let _activationTimer = null;
let _analysisRunning = false;
let _scanCaptureActive = false;
let _sawFinalActivation = false;
let _scanAccumulator = null;
let _latestScanSummary = null;
let _latestFinalScanArgs = null;
const PROCESS_CONCURRENCY = 4;
const MAX_PROCESSED_ENTRIES = 5000;

function isEnabled() {
    const s = _getSettings?.();
    return !s || s.enabled !== false;
}

export function initTracker(getSettingsFn, _saveFn) {
    _getSettings = getSettingsFn;

    const { eventSource, event_types } = SillyTavern.getContext();
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, onWorldInfoScanDone);
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    initTriggerButton(getSettingsFn, _saveFn, renderPanel);
    initPanel(getSettingsFn, _saveFn, reEvaluate);

}

/** Schedule one deferred drain; newer activations replace queued stale work. */
function scheduleActivationAnalysis() {
    if (_activationTimer !== null || _analysisRunning || !_pendingActivation) return;

    _activationTimer = setTimeout(() => {
        _activationTimer = null;
        void drainActivationQueue();
    }, 0);
}

/** Process queued work outside ST's awaited event chain. */
async function drainActivationQueue() {
    if (_analysisRunning) return;
    const job = _pendingActivation;
    if (!job) return;

    _pendingActivation = null;
    _analysisRunning = true;

    try {
        await processActivation(job.entryList, job.generation, job.scanSummary);
    } catch (error) {
        log.error('Activation analysis failed:', error);
    } finally {
        _analysisRunning = false;
        scheduleActivationAnalysis();
    }
}

function cancelQueuedActivation() {
    _pendingActivation = null;
    if (_activationTimer !== null) {
        clearTimeout(_activationTimer);
        _activationTimer = null;
    }
}

function queueActivation(entryList, scanSummary = null) {
    const gen = ++_activationGeneration;
    const safeList = Array.isArray(entryList) ? entryList.slice() : [];
    _pendingActivation = { entryList: safeList, generation: gen, scanSummary };
    scheduleActivationAnalysis();
}

function getFinalScanSummary(activeCount) {
    if (!_latestScanSummary) return null;
    const args = _latestFinalScanArgs;
    return {
        ..._latestScanSummary,
        loopCount: Number.isFinite(args?.state?.loopCount)
            ? Math.max(0, Math.trunc(args.state.loopCount))
            : _latestScanSummary.loopCount,
        activeCount,
        budget: Number.isFinite(args?.budget?.current)
            ? Math.max(0, Math.trunc(args.budget.current))
            : _latestScanSummary.budget,
        overflowed: args?.budget ? !!args.budget.overflowed : _latestScanSummary.overflowed,
        final: true,
    };
}

async function processEntryPool(entries, matchingContext) {
    const results = new Array(entries.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(PROCESS_CONCURRENCY, entries.length) }, async () => {
        while (nextIndex < entries.length) {
            const index = nextIndex++;
            try {
                results[index] = { status: 'fulfilled', value: await processEntry(entries[index], matchingContext) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    });
    await Promise.all(workers);
    return results;
}

// Event handlers remain synchronous because ST awaits every listener.
function onWorldInfoActivated(entryList) {
    if (!isEnabled()) return;

    _sawFinalActivation = true;
    const activeCount = Array.isArray(entryList) ? entryList.length : 0;
    queueActivation(entryList, getFinalScanSummary(activeCount));
}

function onGenerationStarted(_type, _options, isDryRun) {
    if (isDryRun) return;

    _activationGeneration++;
    cancelQueuedActivation();
    _scanCaptureActive = true;
    _sawFinalActivation = false;
    _scanAccumulator = null;
    _latestScanSummary = null;
    _latestFinalScanArgs = null;
}

function onGenerationEnded() {
    if (!_scanCaptureActive) return;
    _scanCaptureActive = false;

    // Empty final sets do not emit WORLD_INFO_ACTIVATED. Reading the final map
    // here also lets later WORLDINFO_SCAN_DONE listeners finish first.
    if (!_sawFinalActivation && isEnabled()) {
        const finalMap = _latestFinalScanArgs?.activated?.entries;
        const entries = finalMap instanceof Map ? [...finalMap.values()] : [];
        queueActivation(entries, getFinalScanSummary(entries.length));
    }
}

function onWorldInfoScanDone(args) {
    if (!isEnabled() || !_scanCaptureActive || !args || typeof args !== 'object') return;

    const loopCount = Number.isFinite(args.state?.loopCount) ? Math.max(0, Math.trunc(args.state.loopCount)) : 0;
    if (!_scanAccumulator || loopCount <= _scanAccumulator.loopCount) {
        _scanAccumulator = { loopCount: 0, candidateCount: 0, successfulCount: 0 };
    }

    _scanAccumulator.loopCount = loopCount;
    _scanAccumulator.candidateCount += Array.isArray(args.new?.all) ? args.new.all.length : 0;
    _scanAccumulator.successfulCount += Array.isArray(args.new?.successful) ? args.new.successful.length : 0;

    const activeEntries = args.activated?.entries instanceof Map ? args.activated.entries : new Map();
    _latestScanSummary = {
        loopCount: _scanAccumulator.loopCount,
        candidateCount: _scanAccumulator.candidateCount,
        successfulCount: _scanAccumulator.successfulCount,
        activeCount: activeEntries.size,
        budget: Number.isFinite(args.budget?.current) ? Math.max(0, Math.trunc(args.budget.current)) : null,
        overflowed: !!args.budget?.overflowed,
        final: args.state?.next === 0,
    };

    if (_latestScanSummary.final) {
        _latestFinalScanArgs = args;
    }
}

async function processActivation(entryList, gen, scanSummary) {
    if (!isEnabled() || gen !== _activationGeneration) return;
    const t0 = performance.now();

    const boundedEntries = entryList.slice(0, MAX_PROCESSED_ENTRIES);
    if (entryList.length > MAX_PROCESSED_ENTRIES) {
        log.warn(`Activation list exceeded ${MAX_PROCESSED_ENTRIES} entries; remaining entries were not analyzed`);
    }

    const knownBookNames = new Set(getScannerState().availableLorebooks.map(b => b.name));
    for (const entry of boundedEntries) {
        if (entry.world && typeof entry.world === 'string' && !knownBookNames.has(entry.world)) {
            addDiscoveredLorebook(entry.world);
        }
    }

    const monitored = _getSettings?.().monitoredLorebooks;
    const monitoredSet = Array.isArray(monitored) && monitored.length > 0 ? new Set(monitored) : null;
    const selectedEntries = Array.isArray(monitored) && monitored.length > 0
        ? boundedEntries.filter(entry => monitoredSet.has(entry?.world))
        : boundedEntries;
    const matchingContext = createMatchingContext();
    const results = await processEntryPool(selectedEntries, matchingContext);
    if (gen !== _activationGeneration) return;

    const processed = [];
    for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') processed.push(results[i].value);
        else log.warn('Failed to process entry', selectedEntries[i]?.uid, ':', results[i].reason);
    }

    const elapsed = Math.round(performance.now() - t0);
    resolveRecursiveMatches(processed, matchingContext);
    state.explanationCoverage = evaluateExplanationCoverage(processed);
    computeDiff(processed);
    state.currentEntries = processed;
    computeGroupMetadata(processed);
    state.scanSummary = scanSummary;
    state.lastUpdate = Date.now();
    state.lastProcessingMs = elapsed;

    if (gen !== _activationGeneration) return;
    updateBadge();
    if (state.panelOpen) renderPanel();
}

function onChatChanged() {
    _activationGeneration++;
    cancelQueuedActivation();
    _scanCaptureActive = false;
    _sawFinalActivation = false;
    _scanAccumulator = null;
    _latestScanSummary = null;
    _latestFinalScanArgs = null;

    if (!isEnabled()) return;
    resetState();
    updateBadge();
    if (state.panelOpen) renderPanel();
}

// ── Re-evaluate ──
// Re-runs findMatchedKeys against the current context for all entries.
// Does NOT re-fetch from ST — only re-matches. Useful when persona,
// character card, or AN changed between generations.

async function reEvaluate() {
    if (!isEnabled() || state.currentEntries.length === 0) return;
    const t0 = performance.now();
    const matchingContext = createMatchingContext();
    for (const entry of state.currentEntries) {
        entry.matchedKeys = findMatchedKeys(entry, matchingContext);
    }
    resolveRecursiveMatches(state.currentEntries, matchingContext);
    state.explanationCoverage = evaluateExplanationCoverage(state.currentEntries);
    state.lastProcessingMs = Math.round(performance.now() - t0);
    renderPanel();
}

// ── Public API ──

export function setEnabled(enabled) {
    setButtonVisible(enabled);

    if (enabled) {
        attachPanelGlobals();
        updateBadge();
        return;
    }

    if (!enabled) {
        // Cancel in-flight work: bump generation so any pending async
        // gen-check short-circuits before writing state.
        _activationGeneration++;
        cancelQueuedActivation();
        _scanCaptureActive = false;
        _sawFinalActivation = false;
        _scanAccumulator = null;
        _latestScanSummary = null;
        _latestFinalScanArgs = null;
        if (state.panelOpen) closePanel(false);
        clearWIHighlights();
        detachPanelGlobals();
        resetState();
        updateBadge();
    }
}

export function getTrackerState() {
    return state;
}

export function refreshTrackerUI() {
    updateBadge();
    if (state.panelOpen) renderPanel();
}
