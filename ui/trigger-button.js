// ⊹ ACE ENTRY TRACK ⊹ — ui/trigger-button.js
// Draggable floating launcher with activation badge.

import { ICONS } from '../icons.js';
import { state } from '../core/state.js';

let _getSettings;

// Original position before panel-open shift; restored on close.
let _savedLeft = null;

export function initTriggerButton(getSettingsFn) {
    _getSettings = getSettingsFn;
    createTriggerButton();
}

// ── Drag (Desktop + Mobile) ──

function enableDrag(btn) {
    const DRAG_THRESHOLD = 5;

    let offsetX, offsetY, startX, startY;
    let isDragging = false;

    function onPointerDown(e) {
        if (e.button !== 0) return;
        const rect = btn.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        startX = e.clientX;
        startY = e.clientY;
        isDragging = false;
        // Synthetic events from accessibility shims may throw InvalidStateError.
        try { btn.setPointerCapture(e.pointerId); } catch { /* non-fatal */ }
        btn.classList.add('env-trigger--dragging');
    }

    function onPointerMove(e) {
        if (!btn.hasPointerCapture(e.pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        isDragging = true;

        const bw = btn.offsetWidth;
        const bh = btn.offsetHeight;
        const newX = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - bw));
        const newY = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - bh));

        btn.style.left = newX + 'px';
        btn.style.top = newY + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
    }

    function onPointerUp(e) {
        btn.classList.remove('env-trigger--dragging');
        let hadCapture = false;
        try { hadCapture = btn.hasPointerCapture(e.pointerId); } catch { /* non-fatal */ }
        if (!hadCapture) return;
        try { btn.releasePointerCapture(e.pointerId); } catch { /* non-fatal */ }

        if (isDragging) {
            btn._justDragged = true;
            setTimeout(() => { btn._justDragged = false; }, 300);

            // User repositioned manually; drop saved position so we don't
            // snap back to the pre-open spot on panel close.
            _savedLeft = null;

            if (isMobile()) {
                const rect = btn.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                if (centerX > window.innerWidth / 2) {
                    btn.style.left = 'auto';
                    btn.style.right = '8px';
                } else {
                    btn.style.right = 'auto';
                    btn.style.left = '8px';
                }
            }
        }
    }

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);

    btn.style.touchAction = 'none';
}

// ── Button ↔ Panel overlap ──

const PANEL_GAP = 8;

function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

/** Slide the button out of the panel's way on open; restore on close. */
function adjustButtonForPanel(opening) {
    const btn = document.getElementById('env_trigger_btn');
    const panel = document.getElementById('env_tracker_panel');
    if (!btn || !panel || isMobile()) return;

    if (opening) {
        const panelWidth = panel.offsetWidth || 380;
        const btnRect = btn.getBoundingClientRect();
        if (btnRect.left < panelWidth) {
            _savedLeft = btn.style.left || '';
            btn.style.left = (panelWidth + PANEL_GAP) + 'px';
            btn.style.right = 'auto';
        }
    } else if (_savedLeft !== null) {
        btn.style.left = _savedLeft;
        _savedLeft = null;
    }
}

// ── Toggle ──

export function togglePanel() {
    if (state.panelOpen) { closePanel(); return; }
    state.panelOpen = true;
    const panel = document.getElementById('env_tracker_panel');
    if (panel) panel.classList.add('env-panel--open');
    const btn = document.getElementById('env_trigger_btn');
    if (btn) btn.classList.add('env-trigger--active');
    adjustButtonForPanel(true);
}

export function closePanel() {
    state.panelOpen = false;
    const panel = document.getElementById('env_tracker_panel');
    if (panel) panel.classList.remove('env-panel--open');
    const btn = document.getElementById('env_trigger_btn');
    if (btn) btn.classList.remove('env-trigger--active');
    adjustButtonForPanel(false);
    clearWIHighlights();
}

/** Strip every ACE-injected class from ST's WI editor (close / disable). */
export function clearWIHighlights() {
    document.querySelectorAll('.env-wi-active, .env-wi-accent').forEach(el => {
        el.classList.remove('env-wi-active', 'env-wi-accent');
    });
}

// ── Creation ──

function createTriggerButton() {
    if (document.getElementById('env_trigger_btn')) return;

    const btn = document.createElement('div');
    btn.id = 'env_trigger_btn';
    btn.className = 'env-trigger';
    btn.title = '⊹ ACE ENTRY TRACK ⊹';
    btn.innerHTML = ICONS.tracker;
    btn.setAttribute('data-env-badge', '0');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');

    btn.addEventListener('click', (e) => {
        if (btn._justDragged) { btn._justDragged = false; return; }
        e.stopPropagation();
        togglePanel();
    });

    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePanel();
        }
    });

    document.body.appendChild(btn);
    enableDrag(btn);
}

// ── Badge ──

export function updateBadge() {
    const btn = document.getElementById('env_trigger_btn');
    if (!btn || !_getSettings) return;

    const settings = _getSettings();
    const monitored = settings.monitoredLorebooks || [];
    const filtered = monitored.length > 0
        ? state.currentEntries.filter(e => monitored.includes(e.world))
        : state.currentEntries;

    btn.setAttribute('data-env-badge', String(filtered.length));

    let tip = `⊹ ACE ENTRY TRACK ⊹ — ${filtered.length} entries`;
    if (state.newUids.size > 0) tip += ` (+${state.newUids.size} new)`;
    if (state.removedEntries.length > 0) tip += ` (−${state.removedEntries.length} removed)`;
    btn.title = tip;
}

// ── Visibility ──

export function setButtonVisible(visible) {
    const btn = document.getElementById('env_trigger_btn');
    if (btn) btn.style.display = visible ? '' : 'none';
}
