# ⊹ ACE ENTRY TRACK ⊹

A lightweight World Info tracker for [SillyTavern](https://github.com/SillyTavern/SillyTavern). See which lorebook entries are active, why they triggered, and how your token budget is being spent — all in a compact floating panel.

![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-purple)

---

## Features

- **Live entry tracking** — shows all active World Info entries after each generation, grouped by lorebook
- **Trigger classification** — entries are color-coded by type: Constant, Vector, Sticky, Forced, Suppressed, Persona, Character, Scenario, Key Match
- **Keyword match display** — reveals which keys matched and where (chat, character, scenario, persona, Author's Note), grouped by source with color-coded labels
- **Token budget bar** — visual indicator of token usage vs. budget, with overflow warnings
- **Diff tracking** — highlights newly activated and removed entries between generations
- **Filter chips** — filter entries by trigger type with one click
- **Search** — text filter across entry names, keys, and lorebook names
- **Sorting** — cycle through order, tokens, name, or trigger type; toggle ascending/descending
- **Lorebook discovery** — auto-detects Primary and Additional character lorebooks, with optional monitoring filter
- **Mobile-friendly** — draggable trigger button, responsive panel, touch-optimized controls

## Install

1. Open SillyTavern
2. Go to **Extensions** → **Install Extension**
3. Paste the repository URL and click install

## Usage

A small book icon appears in the bottom-left corner (mobile: top-right). Click it to open the tracker panel. Send a message to populate entries.

### Settings

Found under **Extensions** → **⊹ ACE ENTRY TRACK ⊹**:

- **Enable/Disable** — toggle the tracker on or off
- **Token budget override** — set a custom token budget (0 = use lorebook default)
- **Monitored lorebooks** — check specific lorebooks to track, or leave empty to track all
