# ⊹ ACE ENTRY TRACK ⊹

> A World Info / Lorebook tracker for [SillyTavern](https://github.com/SillyTavern/SillyTavern).
> See which entries SillyTavern confirmed active, alongside clearly labeled reconstructed explanations and native scan facts.

![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-9333ea)
![Version](https://img.shields.io/badge/version-2.3.0-3b82f6)
![Author](https://img.shields.io/badge/author-aceenvw-1f2937)
![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-10b981)

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
| **cyan**      | Confirmed configuration or live state provides an explanation              |
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

### Regex checker

- **Keyword-list inspection** — paste plaintext keys and `/pattern/flags` expressions separated by commas or new lines.
- **Bounded variant previews** — expands supported alternatives, optional fragments, finite repeats, and small character classes. Lookarounds are noted but omitted from previews, and case variants are not generated.
- **Clear diagnostics** — malformed expressions, unsupported flags, and nested-quantifier safety blocks are separated from valid expressions that cannot be fully enumerated.
- **Zero-length warnings** — statically flags valid expressions that may match without consuming text and activate unexpectedly.
- **Copyable output** — copy displayed variants as a comma-separated list, subject to clipboard limits.
- **Tracker-aligned behavior** — macros resolve before validation, and rejected regex-like keys are identified as plaintext fallbacks used by tracking.
- **Transient by design** — checker input and results are never added to extension settings or stored between popup sessions.

### Regex constructor

- **Explicit boundaries** — choose Latin `\b` boundaries or Cyrillic `[А-Яа-яЁё]` lookarounds instead of relying on script detection.
- **Literal-safe conversion** — escapes comma- or newline-separated words and phrases, converts internal whitespace to `\s+`, and emits case-insensitive JavaScript regex literals.
- **Conservative grouping** — explicit prefix and substantial shared-stem families are compacted without adding forms. Supplied consonant-`y` pairs such as `entry, entries` become `/\bentr(?:y|ies)\b/i`.
- **Optional English suggestions** — heuristic plural and verb forms plus a small curated irregular list appear unchecked. Only selected forms enter the output.
- **No silent language guessing** — suggestions never alter the source list, mixed alphabets are rejected, and Russian morphology is not inferred.
- **Non-destructive output** — the original list stays unchanged and generated expressions can be copied together.

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
| **Check Regex**           | —       | Open the transient keyword and finite-variant inspector                    |
| **Construct Regex**       | —       | Convert Latin or Cyrillic words and phrases into regex literals             |
| **Monitored lorebooks**   | empty   | Check specific lorebooks to track. Empty = track every active lorebook     |

Both tools accept up to 256 items of 512 characters each. CHECK REGEX previews up to 256 variants per expression, 1,024 overall, and eight unique regex expansions per check. Each variant is capped at 4,096 characters and expansion work at 262,144 generated characters. Valid expressions that cannot be finitely previewed are reported as limited. CONSTRUCT REGEX offers up to 64 optional suggestions. The extension does not persist tool input, mode, selections, or output; copied text remains in the system clipboard.

### Console output

Normal operation produces no console output. Only real warnings and errors use the centralized logger.

---

## Security model

ACE ENTRY TRACK treats every lorebook entry as **untrusted input**. World Info content is frequently sourced from public character cards or community lorebook packs.

**Trust-boundary coercion** — every field from a lorebook entry is normalized at ingest:
- numbers via `Number.isFinite` fallback (no `NaN` reaching sort comparators or arithmetic)
- strings capped: content at **100k chars**, titles / world names / groups at **200 chars**
- arrays filtered to strings only, capped at **256 items × 512 chars each**

**HTML escaping** — every attacker-reachable field interpolated into the panel HTML is escaped: primary keys, secondary keys, content, titles, world names, groups, matched / potential keys, character filter names / tags, triggers, source labels, `outletName`, `automationId`, `characterFilter`, `vectorInfo`, timed-effect counters.

**Prototype-pollution protection** — persisted `extension_settings` are loaded through an **allowlist loop** rather than `lodash.merge`, closing the `__proto__` / `constructor` / `prototype` injection vector via stored JSON.

**Bounded CPU/memory** — array, input, output, expansion, and render limits bound work. Recurse-buffer text and per-source scan buffers share the same 200KB ceiling. Risky nested, overlapping, or bounded ambiguous repetition is rejected before production matching.

**Regex-tool isolation** — CHECK REGEX validates with the browser's native JavaScript compiler, then walks bounded parser trees to preview finite variants and detect possible zero-length matches. It never executes pasted expressions against text. The constructor treats every entry as literal text, validates the selected alphabet, escapes regex syntax, and revalidates every generated expression. User-controlled values are inserted through DOM text nodes rather than HTML parsing.

---

## Limitations

- **`auto_update: true`** — the manifest enables auto-updates from the install URL. If you've forked or vendored the extension, change this to `false` in `manifest.json`.

---

## License

ACE Entry Track is licensed under the **GNU Affero General Public License v3.0
(AGPL-3.0-or-later)**. See the [`LICENSE`](./LICENSE) file for the full text.

If you modify the program and let users interact with that modified version remotely over a network, AGPL section 13 requires offering those users the corresponding source.

Copyright (C) 2026 aceenvw

---

<sub>Author: **aceenvw** · Built for SillyTavern · Licensed under AGPL-3.0-or-later</sub>
