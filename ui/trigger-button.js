// ⊹ ACE ENTRY TRACK ⊹ — ui/trigger-button.js
// Draggable floating launcher with activation badge.

import { ICONS } from '../icons.js';
import { state } from '../core/state.js';
import { t } from '../i18n.js';

let _getSettings;
let _saveSettings;
let _renderPanel;
let _viewportHandlerAttached = false;
let _viewportFrame = null;
let _mobileMode = null;

// Original position before panel-open shift; restored on close.
let _savedX = null;

export function initTriggerButton(getSettingsFn, saveSettingsFn, renderPanelFn) {
    _getSettings = getSettingsFn;
    _saveSettings = saveSettingsFn;
    _renderPanel = renderPanelFn;
    _mobileMode = isMobile();
    createTriggerButton();
    if (!_viewportHandlerAttached) {
        window.addEventListener('resize', onViewportChanged);
        window.addEventListener('orientationchange', onViewportChanged);
        _viewportHandlerAttached = true;
    }
}

function clampPosition(btn, persist = false) {
    const rect = btn.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - btn.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - btn.offsetHeight);
    const x = Math.max(0, Math.min(rect.left, maxX));
    const y = Math.max(0, Math.min(rect.top, maxY));
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    if (persist) persistPosition(x, y);
}

function persistPosition(x, y) {
    const settings = _getSettings?.();
    if (!settings) return;
    const prefix = isMobile() ? 'triggerMobile' : 'triggerDesktop';
    settings[`${prefix}X`] = Math.round(x);
    settings[`${prefix}Y`] = Math.round(y);
    _saveSettings?.();
}

function applySavedPosition(btn) {
    btn.style.left = '';
    btn.style.top = '';
    btn.style.right = '';
    btn.style.bottom = '';

    const settings = _getSettings?.();
    const prefix = isMobile() ? 'triggerMobile' : 'triggerDesktop';
    const x = settings?.[`${prefix}X`];
    const y = settings?.[`${prefix}Y`];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    clampPosition(btn);
}

function onViewportChanged() {
    if (_viewportFrame !== null) cancelAnimationFrame(_viewportFrame);
    _viewportFrame = requestAnimationFrame(() => {
        _viewportFrame = null;
        const btn = document.getElementById('env_trigger_btn');
        if (!btn) return;
        const mobile = isMobile();
        if (_mobileMode !== mobile) {
            _mobileMode = mobile;
            _savedX = null;
            applySavedPosition(btn);
            return;
        }
        if (state.panelOpen) return;
        clampPosition(btn, true);
    });
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
            _savedX = null;

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
            const finalRect = btn.getBoundingClientRect();
            persistPosition(finalRect.left, finalRect.top);
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
            _savedX = btn.offsetLeft;
            btn.style.left = (panelWidth + PANEL_GAP) + 'px';
            btn.style.right = 'auto';
        }
    } else if (_savedX !== null) {
        const maxX = Math.max(0, window.innerWidth - btn.offsetWidth);
        const targetX = Math.max(0, Math.min(_savedX, maxX));
        btn.style.left = `${targetX}px`;
        btn.style.right = 'auto';
        _savedX = null;
    }
}

// ── Toggle ──

export function togglePanel() {
    if (state.panelOpen) { closePanel(); return; }
    state.panelOpen = true;
    const panel = document.getElementById('env_tracker_panel');
    if (panel) {
        panel.inert = false;
        panel.classList.add('env-panel--open');
        panel.setAttribute('aria-hidden', 'false');
    }
    const btn = document.getElementById('env_trigger_btn');
    if (btn) {
        btn.classList.add('env-trigger--active');
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', t('trigger.close'));
    }
    adjustButtonForPanel(true);
    _renderPanel?.();
    panel?.querySelector('.env-panel__close')?.focus();
}

export function closePanel(restoreFocus = true) {
    state.panelOpen = false;
    const panel = document.getElementById('env_tracker_panel');
    const btn = document.getElementById('env_trigger_btn');
    if (restoreFocus) btn?.focus();
    if (panel) {
        panel.classList.remove('env-panel--open');
        panel.setAttribute('aria-hidden', 'true');
        panel.inert = true;
    }
    if (btn) {
        btn.classList.remove('env-trigger--active');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', t('trigger.open'));
    }
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

    const btn = document.createElement('button');
    btn.id = 'env_trigger_btn';
    btn.className = 'env-trigger';
    btn.type = 'button';
    btn.title = t('trigger.open');
    btn.innerHTML = ICONS.tracker;
    btn.setAttribute('data-env-badge', '0');
    btn.setAttribute('aria-label', t('trigger.open'));
    btn.setAttribute('aria-controls', 'env_tracker_panel');
    btn.setAttribute('aria-expanded', 'false');

    btn.addEventListener('click', (e) => {
        if (btn._justDragged) { btn._justDragged = false; return; }
        e.stopPropagation();
        togglePanel();
    });

    document.body.appendChild(btn);
    applySavedPosition(btn);
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
    const filteredKeys = new Set(filtered.map(entry => `${entry.world}::${entry.uid}`));
    const newCount = [...state.newUids].filter(key => filteredKeys.has(key)).length;
    const removedCount = monitored.length > 0
        ? state.removedEntries.filter(entry => monitored.includes(entry.world)).length
        : state.removedEntries.length;

    btn.setAttribute('data-env-badge', String(filtered.length));

    let tip = t('trigger.summary', { count: filtered.length });
    if (newCount > 0) tip += t('trigger.new', { count: newCount });
    if (removedCount > 0) tip += t('trigger.removed', { count: removedCount });
    btn.title = tip;
    btn.setAttribute('aria-label', `${state.panelOpen ? t('trigger.close') : t('trigger.open')}. ${tip}`);
}

// ── Visibility ──

export function setButtonVisible(visible) {
    const btn = document.getElementById('env_trigger_btn');
    if (btn) btn.style.display = visible ? '' : 'none';
}
