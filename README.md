# ⊹ ACE ENTRY TRACK ⊹

> A World Info / Lorebook tracker for [SillyTavern](https://github.com/SillyTavern/SillyTavern).
> See which entries SillyTavern confirmed active, alongside clearly labeled reconstructed explanations and native scan facts.

![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-9333ea)
![Version](https://img.shields.io/badge/version-2.2.0-3b82f6)
![Author](https://img.shields.io/badge/author-aceenvw-1f2937)
![License](https://img.shields.io/badge/license-AGPL--3.0-10b981)

---

## Table of Contents

- [What it does](#what-it-does)
- [Trigger reference](#trigger-reference)
- [Features](#features)
  - [Core tracking](#core-tracking)
  - [Timed effects & native scan facts](#timed-effects--native-scan-facts)
  - [Context preview](#context-preview)
  - [UI & performance](#ui--performance)
  - [Lorebook discovery](#lorebook-discovery)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Changelog](#changelog)

---

## What it does

After every generation, ACE ENTRY TRACK uses SillyTavern's final native World Info activation list, reconstructs explanatory matching details for each confirmed entry, then renders the result as a compact, filterable side panel:

```
┌─────────────────────────────────────────────────────────────┐
│  ⊹ ACE ENTRY TRACK ⊹               [refresh] [×]            │
├─────────────────────────────────────────────────────────────┤
│  filter:  [CONST 4] [STICKY 2] [KEY 11] [VEC 3] [...]       │
│  search:  ____________________________   sort: order ▾      │
├─────────────────────────────────────────────────────────────┤
│  Lorebook A · 14 entries · 2,134t                           │
│   ● ▣ Constant lore — always on            120t      [▾]    │
│   ● ▣ Sticky scene — 3 turns left          340t      [▾]    │
│   ● ▣ Key match: "tavern", "ale"           215t      [▾]    │
│   ◌ ▣ Vector-enabled entry                 180t      [▾]    │
├─────────────────────────────────────────────────────────────┤
│  Native scan · 14 active · budget 4,096 · limit not reached │
└─────────────────────────────────────────────────────────────┘
```

The panel shows you, per entry:
- The confirmed native activation status and a separate explanation category.
- A reconstructed key-coverage bar (primary + secondary keys found vs. total).
- The configured scan sources and reconstructed key findings.
- **Live timed-effect counters** (sticky / cooldown / delay turns remaining).
- A 12-generation **sparkline** of activation history.
- An **explanation coverage dot** showing whether a useful explanation was reconstructed.

---

## Trigger reference

Entries are color-coded by configuration or reconstructed explanation category.

| Type           | Color     | Meaning                                                       |
|----------------|-----------|---------------------------------------------------------------|
| `CONSTANT`     | `#6366f1` | Confirmed active constant; no keyword required                |
| `VECTOR-ENABLED` | `#8b5cf6` | Eligible for vector retrieval; source is not exposed        |
| `STICKY STATE` | `#ef4444` | Live sticky state may explain the confirmed activation        |
| `FORCED`       | `#f59e0b` | Confirmed active with an `@@activate` decorator               |
| `PERSONA KEY`  | `#d946ef` | Key found in reconstructed persona context                    |
| `CHARACTER KEY`| `#f59e0b` | Key found in reconstructed character context                  |
| `SCENARIO KEY` | `#84cc16` | Key found in reconstructed scenario context                   |
| `KEY FOUND`    | `#10b981` | Key found in reconstructed scan context                       |

Each row in the panel also shows an **explanation coverage dot**:

| Dot           | Meaning                                                                     |
|---------------|-----------------------------------------------------------------------------|
| **green**     | A key was found in reconstructed context                                    |
| **blue**      | Confirmed configuration or live state provides an explanation              |
| **orange**    | A possible recursive explanation was found                                 |
| **gray**      | Confirmed active, but no explanation was reconstructed                     |

---

## Features

### Core tracking

- **Live entry tracking** — all active World Info entries after each generation, grouped by lorebook.
- **Explanation classification** — entries color-coded by confirmed configuration or reconstructed explanation category.
- **Bounded explanatory matching** — per-entry scan flags, global WI settings, regex keys, macro resolution, and a clearly labeled possible-recursion fallback.
- **Explanation coverage** — reports how many confirmed active entries have a useful configuration, live-state, or reconstructed-key explanation.
- **Reconstructed key coverage** — visual ratio of primary + secondary keys found vs. total, across how many sources.
- **Reconstructed selective logic** — evaluates `AND_ANY` / `NOT_ALL` / `NOT_ANY` / `AND_ALL` against the captured context.

### Timed effects & native scan facts

- **Live timed-effect state** — reads `chat_metadata.timedWorldInfo`, shows remaining turns for sticky / cooldown / delay.
- **Native scan summary** — shows SillyTavern's active count, loop count, effective budget, and whether the native scan reached its budget limit.
- **No simulated overflow ordering** — display sorting and search never alter native budget status.

### Context preview

- **Inline highlighted context** — collapsible per-source sections (chat + character fields + persona + AN) showing the scan buffer with matched keys highlighted.
- **Bidirectional cross-highlighting** — hover an entry → its keys light up in the preview; hover a highlight → affected entries get accented in both the panel and ST's WI editor.
- **Click-to-filter** — click a highlighted key in the preview to filter the entry list to entries matching that key.
- **Potential matches** — keys present in a source the entry does **NOT** scan get a warning highlight, surfacing scan-flag misconfigurations.
- **Bounded preview output** — entry, key-reference, per-source, and aggregate highlight limits prevent Context Preview from creating unbounded DOM output.

### UI & performance

- **Two layout modes** — `solid` full-height side panel (default) or a denser `compact` view that trims itself to just the toolbar, filter chips, and entry list. Switch live in settings.
- **Draggable floating trigger button** — remembers separate desktop and mobile positions, snaps on mobile, and stays reachable after resize or rotation.
- **Filter chips + search** — filter by trigger type with one click; search across titles / keys / world names.
- **Collapsible key dropdowns** — Primary / Secondary keys fold away by default in the entry detail; click to reveal.
- **Lazy panel rendering** — closed-panel generations update state and the badge without rebuilding panel HTML.
- **Expand / collapse all** with bounded lazy detail injection.
- **Sparkline per entry** — last 12 generations' activation history dotted next to the title.
- **Warnings system** — probability without sticky, empty content, and invalid key-scan configuration.
- **Reduced-motion aware** — honors the OS "reduce motion" preference.
- **Accessible controls** — native buttons, keyboard-operable highlights, expanded states, live status, visible focus, and focus restoration.
- **English and Russian UI** — locale-aware settings, panel controls, diagnostics, and explanations.
- **Mobile-friendly** — dynamic viewport sizing, safe-area support, responsive panel, and touch-optimized drag.

### Lorebook discovery

- **Multi-source scanner** — discovers Global, Character (primary), Character (additional), Chat-bound, Persona-bound lorebooks; each tagged with a colored source badge in settings.
- **Auto-prune** — stale monitored selections get dropped when a book detaches.

---

## Installation

1. Open SillyTavern.
2. Go to **Extensions** → **Install Extension**.
3. Paste the repository URL and click **Install**.

No additional dependencies. The `vectors` extension is optional; ACE reports vector eligibility without claiming an activation source that SillyTavern does not expose.

---

## Usage

1. A **book icon** appears in the bottom-left corner of the screen (top-right on mobile). Drag it anywhere; it remembers position.
2. Click it to open the side panel.
3. Send a message — entries populate after generation completes.
4. Press `Esc` to close the panel.

Hover any entry to see its keys light up inline in the context preview. Click a highlighted key to filter the list. Click the refresh button to re-scan without sending a new message.

---

## Settings

Found under **Extensions** → **⊹ ACE ENTRY TRACK ⊹**:

| Setting                   | Default | Description                                                                |
|---------------------------|---------|----------------------------------------------------------------------------|
| **Enable / Disable**      | on      | Toggle the tracker on or off without uninstalling                          |
| **Panel layout**          | `solid` | `solid` = full-height side panel. `compact` = narrower, denser layout      |
| **Monitored lorebooks**   | empty   | Check specific lorebooks to track. Empty = track every active lorebook     |

### Console output

Normal operation produces no console output. Only real warnings and errors use the centralized logger.

---

## Architecture

The codebase is split into three concerns: **state/processing** (`core/`), **UI rendering** (`ui/`), and **utilities** (`utils/`). Top-level files wire them together.

```
ace-entry-track/
├── manifest.json         · ST extension manifest
├── index.js              · entry point, event wiring, settings load
├── tracker.js            · activation pipeline orchestrator
├── scanner.js            · multi-source lorebook discovery
├── i18n.js               · English and Russian interface strings
├── icons.js              · SVG icon registry
├── settings.html         · settings panel template
├── style.css             · panel, filters, native scan facts, and detail styling
│
├── core/
│   ├── state.js          · runtime state, diff, sort/filter, group metadata
│   ├── processor.js      · entry coercion, trigger classification, constants
│   ├── matching.js       · key matching, scan-flag logic, regex/macro resolution
│   └── self-test.js      · explanation coverage for native active entries
│
├── ui/
│   ├── panel.js          · main side panel render + interaction
│   ├── trigger-button.js · draggable floating launcher
│   └── lorebook-list.js  · settings-page lorebook browser
│
└── utils/
    ├── html.js           · HTML escape, DOM helpers
    ├── ids.js            · stable composite world::uid identity
    └── log.js            · centralized [ACE]-prefixed logger
```

### Data flow

```
   index.js    bootstraps  ──▶  scanner.js  (lorebook discovery)
                            └─▶  tracker.js  (event wiring)
                                     │
                                     ▼
                            ST generation event
                                     │
                                     ▼
                            core/processor.js  (coerce + classify entries)
                                     │
                                     ▼
                            core/matching.js   (resolve keys against scan sources)
                                     │
                                     ▼
                            core/self-test.js  (measure explanation coverage)
                                     │
                                     ▼
                            core/state.js      (commit to runtime state)
                                     │
                                     ▼
                            ui/panel.js        (render side panel)
```

`scanner.js` and `tracker.js` are independent peers initialized from `index.js`. Scanner listeners remain attached while disabled and gate their work internally, so re-enabling does not require a reload. Activation analysis is deferred outside SillyTavern's awaited event chain, filtered to monitored books before processing, and run through a bounded worker pool. One matching context is shared per generation, while token and key-processing caches avoid repeating unchanged work. Closed panels skip HTML rebuilding, and stale analysis cannot overwrite a newer generation.

---

## Security model

ACE ENTRY TRACK treats every lorebook entry as **untrusted input**. World Info content is frequently sourced from public character cards or community lorebook packs.

**Trust-boundary coercion** — every field from a lorebook entry is normalized at ingest:
- numbers via `Number.isFinite` fallback (no `NaN` reaching sort comparators or arithmetic)
- strings capped: content at **100k chars**, titles / world names / groups at **200 chars**
- arrays filtered to strings only, capped at **256 items × 512 chars each**

**HTML escaping** — every attacker-reachable field interpolated into the panel HTML is escaped: primary keys, secondary keys, content, titles, world names, groups, matched / potential keys, character filter names / tags, triggers, source labels, `outletName`, `automationId`, `characterFilter`, `vectorInfo`, timed-effect counters.

**Prototype-pollution protection** — persisted `extension_settings` are loaded through an **allowlist loop** rather than `lodash.merge`, closing the `__proto__` / `constructor` / `prototype` injection vector via stored JSON.

**Bounded CPU/memory** — array and string caps prevent a malicious lorebook with millions of keys or multi-MB key strings from freezing the UI thread. Recurse-buffer text and per-source scan buffers share the same 200KB ceiling for both regex and literal-key paths. Regex keys with nested-quantifier shapes (`(a+)+`, `(.*)+`, `(a{1,5})+`) are rejected at parse time and silently fall through to literal matching, mitigating ReDoS.

---

## Limitations

- **`auto_update: true`** — the manifest enables auto-updates from the install URL. If you've forked or vendored the extension, change this to `false` in `manifest.json`.

---

## Changelog

### 2.2.0 — Native accuracy, performance & interface polish
- **Accuracy**: SillyTavern's final native activation list is now authoritative. Reconstructed matching is clearly presented as explanation rather than activation proof.
- **Native facts**: added active count, scan loops, effective budget, and native limit status; removed the simulated budget bar, display-order overflow labels, and token-budget override.
- **Performance**: activation analysis no longer blocks SillyTavern's awaited generation events; bounded workers, shared matching context, token caching, lazy explanation work, and capped Context Preview output keep large lorebooks responsive.
- **Lifecycle**: stale work is invalidated on chat/generation changes, disable/re-enable works without reload, and lorebook discovery responds to persona changes.
- **Interface**: added English and Russian UI, accessible native controls, keyboard states, focus restoration, mobile safe areas, and improved reduced-motion behavior.
- **Launcher**: desktop now defaults to bottom-left, mobile defaults to top-right, each layout remembers its own dragged position, and panel open/close movement restores smoothly.
- **Fixes**: corrected filtered entry, token, new-entry, and removed-entry counts; normal operation now keeps the browser console quiet.

### 2.1.0 — Layout modes, collapsible keys & filter accuracy
- **Feature**: **Panel layout** setting — choose between `solid` (full-height side panel, default) and `compact`. Compact is narrower (~300px), denser, hides sparklines, and strips the **Context Preview** and **Budget bar** down to header → toolbar → filter chips → entry list. Applied live via a validated `data-env-layout` attribute on the panel root; desktop-only (mobile stays full-width).
- **Feature**: **Primary** and **Secondary keys** in the expanded entry detail are now collapsed-by-default dropdowns (click the header to expand) — keeps long key lists from dominating the detail view. Applies in both layout modes.
- **Fix**: constant-merge character filter now honors `characterFilter.tags` (resolved via `tagMap[character.avatar]`), not just `.names` — *fail-open* so a real constant is never hidden on uncertainty.
- **Fix**: creator-notes scan source falls back to the legacy top-level `creatorcomment` field (`data.creator_notes || creatorcomment`), matching ST, for older character cards.
- **Polish**: trigger button (FAB) centers its SVG via flexbox; the entry-count badge is now muted to the theme surface instead of bright red.
- **Polish**: timed-effect rows (sticky / cooldown / delay / probability) are grouped in an accent sub-block in the entry detail, separate from base metadata.
- **Polish**: panel header shortened to "ENTRY TRACK" with shrink-to-ellipsis so action buttons stay visible on narrow panels.
- **Polish**: console output is quiet by default — one summary line per generation; `globalThis.__aet.verbose = true` restores full diagnostics.
- **A11y**: `prefers-reduced-motion` disables the panel slide, badge pop, budget pulse, and new-entry flash.

### 2.0.1 — Audit hardening
- **Security**: null-prototype objects for entry grouping (blocks lorebooks named `__proto__` / `toString` / `constructor` from bricking the panel render)
- **Security**: literal-key scan path now shares the same 200KB cap as the regex path (CPU DoS via multi-MB recurse buffer)
- **Security**: `parseRegexKey` rejects nested-quantifier ReDoS shapes; modern regex flags (`d`, `v`) accepted
- **Bug**: group-peer filter uses composite `world::uid` (multi-book uid collisions resolved)
- **Bug**: `setEnabled(false)` now cancels in-flight async work (bumps generation, clears cache, detaches listeners) — toggling off mid-generation no longer leaves stale data on re-enable
- **Bug**: `mergeMissingConstants` clones raw lorebook entries before mutating `.world` (prevents corrupting ST's shared in-memory representation)
- **Perf**: `mergeMissingConstants` parallelizes book loads + bounded-concurrency entry processing (was fully sequential)
- **Perf**: chat-change storms debounce constant-surfacing (was stacking timers); `_lorebookCache` adds LRU + size cap; `activationHistory` adds absolute size ceiling
- **Polish**: budget bar separates bypass tokens from counted tokens (no more spurious OVER BUDGET); cached sort/budget result on render; tightened uid selector regex; `\x01` stripped from chat messages before scan-buffer joining; cache invalidates on `WORLDINFO_UPDATED`
- **Cleanup**: dead parameter `onToggleFn` removed from `initTriggerButton`; dead `entry.X !== undefined` guards stripped (always-defined post-`processEntry`); duplicate `CHAT_CHANGED` listener merged

### 2.0.0
- Modular code layout: `core/` (state, processor, matching, self-test), `ui/` (panel, trigger-button, lorebook-list), `utils/` (html, ids, log)
- Side panel replaces floating popup: persistent close button, refresh button, expand/collapse all, lazy detail injection
- Context preview with inline highlighting + bidirectional cross-highlighting
- Explanation-coverage framework and per-entry coverage dots
- Recursive-match resolution (keys found in other activated entries' content)
- Potential-match detection (keys present in unscanned sources)
- Selective-logic evaluation with pass/fail explanation
- Match strength bar
- Live sticky / cooldown / delay remaining turns
- Stacked budget bar with `ignoreBudget` bypass category
- Sparkline per entry (last 12 generations)
- Multi-source scanner: Global, Character primary/additional, Chat, Persona
- Race-condition protection on async activation + discovery
- Centralized `[ACE]`-prefixed logger
- Warnings system (probability-without-sticky, empty content, equal group weights)
- Vector / RAG awareness: reads `extensionSettings.vectors` and identifies vector-enabled entries
- Trust-boundary hardening extended to all new fields

### 1.0.0
- Initial public release with full security hardening

---

## License

ACE Entry Track is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)**. See the [`LICENSE`](./LICENSE) file for the full text.

Because this is an AGPL-licensed extension, if you run a modified version as
part of a network-accessible service, you must make the corresponding source
code of your modified version available to its users.

Copyright (C) 2026 aceenvw

---

<sub>Author: **aceenvw** · Built for SillyTavern · Licensed under AGPL-3.0</sub>
