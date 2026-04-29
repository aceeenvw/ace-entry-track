# ⊹ ACE ENTRY TRACK ⊹

> A World Info / Lorebook tracker for [SillyTavern](https://github.com/SillyTavern/SillyTavern).
> See **which** entries fire, **why** they fired, and **how** your token budget is spent — in a compact side panel with inline context preview.

![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-9333ea)
![Version](https://img.shields.io/badge/version-2.0.1-3b82f6)
![Author](https://img.shields.io/badge/author-aceenvw-1f2937)
![License](https://img.shields.io/badge/license-AGPL--3.0-10b981)

---

## Table of Contents

- [What it does](#what-it-does)
- [Trigger reference](#trigger-reference)
- [Features](#features)
  - [Core tracking](#core-tracking)
  - [Timed effects & budget](#timed-effects--budget)
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

After every generation, ACE ENTRY TRACK reads SillyTavern's World Info pipeline and reconstructs the activation reasoning for each entry, then renders the result as a compact, filterable side panel:

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
│   ◌ ▣ Vector hit (RAG)                     180t      [▾]    │
├─────────────────────────────────────────────────────────────┤
│  Budget: ████████░░░░░░░░ 1,847 / 4,096   [bypass: 320]     │
└─────────────────────────────────────────────────────────────┘
```

The panel shows you, per entry:
- The **trigger type** (color-coded) and **why** it activated.
- A **match strength bar** (primary + secondary keys hit vs. total).
- The **scan sources** the entry actually searched (chat / description / personality / persona / AN / etc.).
- **Live timed-effect counters** (sticky / cooldown / delay turns remaining).
- A 12-generation **sparkline** of activation history.
- An **accuracy dot** comparing our reconstruction to ST's actual activation.

---

## Trigger reference

Entries are color-coded by activation mechanism. The same colors are used in the panel, the filter chips, and the budget bar.

| Type           | Color     | Meaning                                                       |
|----------------|-----------|---------------------------------------------------------------|
| `CONSTANT`     | `#6366f1` | Always active — no keyword match required                     |
| `VECTOR`       | `#8b5cf6` | Activated via RAG / vector similarity search                  |
| `STICKY`       | `#ef4444` | Remains active for **N turns** after triggering               |
| `FORCED`       | `#f59e0b` | Force-activated by `@@activate` decorator                     |
| `SUPPRESSED`   | `#64748b` | Blocked by `@@dont_activate` decorator                        |
| `PERSONA`      | `#d946ef` | Matched keywords inside the user persona                      |
| `CHARACTER`    | `#f59e0b` | Matched keywords inside the character card                    |
| `SCENARIO`     | `#84cc16` | Matched keywords inside the scenario text                     |
| `KEY MATCH`    | `#10b981` | Activated by keyword match in recent chat                     |

Each row in the panel also shows an **accuracy dot**:

| Dot           | Meaning                                                                     |
|---------------|-----------------------------------------------------------------------------|
| **green**     | Reconstruction matches ST's actual activation exactly                       |
| **blue**      | Reconstruction explains the activation via a known mechanism                |
| **orange**    | Activation explained via *recursive* match (key found in another entry)     |
| **gray**      | Unresolved — ST activated this entry for a reason we couldn't reconstruct   |

---

## Features

### Core tracking

- **Live entry tracking** — all active World Info entries after each generation, grouped by lorebook.
- **Trigger classification** — entries color-coded by the 9 types above.
- **Accurate matching** — per-entry scan flags (chat / description / personality / depth prompt / scenario / creator notes / persona / AN), global WI settings respected, regex keys, macro resolution, recursive-scan fallback.
- **Self-test accuracy** — compares our match reconstruction against ST's actual activation; reports `%` accuracy per generation and per-entry.
- **Match strength bar** — visual ratio of primary + secondary keys hit vs. total, across how many sources.
- **Selective-logic evaluation** — explains `AND_ANY` / `NOT_ALL` / `NOT_ANY` / `AND_ALL` pass/fail with a satisfied/unsatisfied status line.

### Timed effects & budget

- **Live timed-effect state** — reads `chat_metadata.timedWorldInfo`, shows remaining turns for sticky / cooldown / delay.
- **Stacked budget bar** — every entry rendered as a colored segment; `ignoreBudget` entries shown separately; insertion order mirrors ST's priority (constants first, then the rest).
- **Overflow warnings** — entries pushed out by the budget cap are tagged `OVER`.

### Context preview

- **Inline highlighted context** — collapsible per-source sections (chat + character fields + persona + AN) showing the scan buffer with matched keys highlighted.
- **Bidirectional cross-highlighting** — hover an entry → its keys light up in the preview; hover a highlight → affected entries get accented in both the panel and ST's WI editor.
- **Click-to-filter** — click a highlighted key in the preview to filter the entry list to entries matching that key.
- **Potential matches** — keys present in a source the entry does **NOT** scan get a warning highlight, surfacing scan-flag misconfigurations.

### UI & performance

- **Draggable floating trigger button** — stays where you drop it on desktop; on mobile, snaps to the nearest left/right edge after each drag.
- **Filter chips + search** — filter by trigger type with one click; search across titles / keys / world names.
- **Expand / collapse all** with lazy detail injection — large lorebooks stay snappy.
- **Sparkline per entry** — last 12 generations' activation history dotted next to the title.
- **Warnings system** — probability without sticky (flicker risk), empty content, equal-weight group members, and more.
- **Mobile-friendly** — responsive panel, touch-optimized drag, pointer-capture events.

### Lorebook discovery

- **Multi-source scanner** — discovers Global, Character (primary), Character (additional), Chat-bound, Persona-bound lorebooks; each tagged with a colored source badge in settings.
- **Auto-prune** — stale monitored selections get dropped when a book detaches.

---

## Installation

1. Open SillyTavern.
2. Go to **Extensions** → **Install Extension**.
3. Paste the repository URL and click **Install**.

No additional dependencies. The `vectors` extension is *optional* — when present, ACE picks up RAG activations automatically.

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
| **Token budget override** | `0`     | Custom budget cap. `0` = use lorebook default                              |
| **Monitored lorebooks**   | empty   | Check specific lorebooks to track. Empty = track every active lorebook     |

---

## Architecture

The codebase is split into three concerns: **state/processing** (`core/`), **UI rendering** (`ui/`), and **utilities** (`utils/`). Top-level files wire them together.

```
ace-entry-track-public/
├── manifest.json         · ST extension manifest
├── index.js              · entry point, event wiring, settings load
├── tracker.js            · activation pipeline orchestrator
├── scanner.js            · multi-source lorebook discovery
├── icons.js              · SVG icon registry
├── settings.html         · settings panel template
├── style.css             · all styling (panel, chips, budget bar, etc.)
│
├── core/
│   ├── state.js          · runtime state, sort/filter, persistence
│   ├── processor.js      · entry coercion, trigger classification, constants
│   ├── matching.js       · key matching, scan-flag logic, regex/macro resolution
│   └── self-test.js      · accuracy reconstruction vs. ST's actual activation
│
├── ui/
│   ├── panel.js          · main side panel render + interaction
│   ├── trigger-button.js · draggable floating launcher
│   └── lorebook-list.js  · settings-page lorebook browser
│
└── utils/
    ├── html.js           · HTML escape, DOM helpers
    ├── ids.js            · stable ID derivation (signature lives here)
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
                            core/self-test.js  (compare reconstruction vs. ST activation)
                                     │
                                     ▼
                            core/state.js      (commit to runtime state)
                                     │
                                     ▼
                            ui/panel.js        (render side panel)
```

`scanner.js` and `tracker.js` are independent peers initialized from `index.js`; tracker reads scanner state through `getScannerState()` and triggers re-discovery via `refreshDiscovery()`. Async activation and discovery are race-protected — late-arriving generation events from a previous turn cannot overwrite the current turn's state.

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

- **Character-tag filters in constants** — `characterFilter.tags` is shown in the entry detail and respected by ST's own activation pipeline, but the standalone constant-merge pass in `tracker.js` (used when `WORLD_INFO_ACTIVATED` doesn't fire) only checks `characterFilter.names`. A constant restricted by tags may surface in this panel for every character even when ST itself filters it out for some.
- **`auto_update: true`** — the manifest enables auto-updates from the install URL. If you've forked or vendored the extension, change this to `false` in `manifest.json`.

---

## Changelog

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
- Self-test accuracy framework and per-entry accuracy dots
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
- Vector / RAG awareness: reads `extensionSettings.vectors`, badges likely RAG activations
- Trust-boundary hardening extended to all new fields

### 1.0.0
- Initial public release with full security hardening

---

## License

ACE Entry Track is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0)**. See the [`LICENSE`](./LICENSE) file for the full text and
[`COPYRIGHT`](./COPYRIGHT) for the project copyright notice.

Because this is an AGPL-licensed extension, if you run a modified version as
part of a network-accessible service, you must make the corresponding source
code of your modified version available to its users.

Copyright (C) 2026 aceenvw

---

<sub>Author: **aceenvw** · Built for SillyTavern · Licensed under AGPL-3.0</sub>
