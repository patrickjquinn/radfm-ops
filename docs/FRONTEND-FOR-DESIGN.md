# Rad.FM Ops - how the frontend is built

**For:** the design team, to align the design app and keep iterating
**From:** `radfm-ops` · live at **https://ops.rad-fm.com** (behind Cloudflare Access, owner-only)
**Source of truth for this document:** the repo, as of 6 Aug 2026

The build came from `Rad.FM Ops.dc.html`. It is live, in daily use, and has already caught real
production faults. This describes what shipped, where it drifted from the prototype and why, so the
next iteration starts from the real thing rather than from the mock.

**The short version:** the design translated almost verbatim. Tokens, spacing, type scale and layout
are lifted directly. The changes are in the *states* - the prototype drew the populated case, and most
of the engineering was drawing the other three.

---

## 1. Stack, and what that means for you

| | |
|---|---|
| Framework | React 19 + TypeScript, Vite |
| Data | TanStack Query, `retry: false` |
| Icons | **IBM Carbon** (`@carbon/icons-react`) |
| Styling | **Inline `style` objects. No CSS framework, no Tailwind, no CSS modules.** |
| Hosting | Cloudflare Worker, static assets + a BFF on the same origin |

**Nine views, one file each, in `src/views/`.** ~5,100 lines of frontend total.

The styling idiom matters to you: because everything is an inline object, **there is no stylesheet to
hand over and no class names to agree on.** A design change lands as a value change in
`src/theme.ts` or in the one component that owns the thing. `src/styles.css` is 90 lines and holds
only resets, one keyframe, focus rings, scrollbars and the responsive breakpoint.

That was the prototype's own idiom, kept deliberately. It means what you see in the design file maps
1:1 onto what a developer edits.

---

## 2. Design tokens - `src/theme.ts`, verbatim

Copy these into the design app; they are the literal shipped values.

```
COLOUR - semantic only
  ok        #3FB3A6    teal    · healthy, live, active nav
  okDim     #2E6B66
  warn      #E0A030    amber   · degraded
  warnText  #E8BC6A            · amber on dark, for text
  bad       #FF6259    red     · failing
  badDim    #8A3029

TEXT
  t1  #fff
  t2  rgba(255,255,255,0.62)
  t3  rgba(255,255,255,0.38)

BACKGROUND
  page  #0A0C0D
  side  #08090A          (sidebar is DARKER than the page)
  card  #0C0F10

LINES
  edge  1px solid rgba(255,255,255,0.08)     panel borders, dividers
  row   1px solid rgba(255,255,255,0.055)    list rows - deliberately fainter

TYPE
  text     -apple-system, 'SF Pro Text', system-ui, 'Helvetica Neue', sans-serif
  display  -apple-system, 'SF Pro Display', system-ui, sans-serif
  mono     ui-monospace, 'SF Mono', Menlo, monospace
```

### The colour rule, which constrains everything else

**Colour is semantic, never decorative.** Three signal colours plus white opacities. There is no
categorical palette - no "chart colour 1..6", no per-source hue.

The reason is the tool's entire purpose: an operator at 3am must answer *"which of these is bad?"*
in one glance. A category colour makes that question unanswerable, because you first have to
remember whether blue meant "Apple Music" or "problem".

**If a future iteration needs to distinguish categories, please distinguish them by position, label
or weight - not by hue.** This is the one rule I'd ask you to hold.

### Type scale, as actually used

Nothing here is arbitrary; these are the shipped numbers.

| Role | Font | Size / line | Weight | Tracking |
|---|---|---|---|---|
| Page title | display | 20 / 1.2 | 600 | −0.022em |
| Page subtitle | text | 12.5 / 1.5 | 400 | - |
| Section head | text | **10** / 1 | 600 | **0.16em**, uppercase |
| Stat value | mono | 24 / 1 | 500 | −0.01em |
| Stat label | text | 9.5 / 1 | 600 | 0.14em, uppercase |
| Stat context | text | 11 / 1.5 | 400 | - |
| Body / prose | text | 12 / 1.55 | 400 | max **76ch** |
| Table row | text or mono | 12.5-13 / 1.4 | 400 | - |
| Provenance meta | mono | 10.5 / 1 | 400 | - |
| Nav item | text | 13 / 1.3 | 400, 500 active | - |

**All numerals are tabular** (`font-variant-numeric: tabular-nums`) and set in mono, so columns align
and a changing digit doesn't shift the row. This applies to every number in the product.

---

## 3. Layout

```
┌──────────┬────────────────────────────────────────────┐
│ sidebar  │ header  (sticky, blurred, z 20)            │
│ 236px    ├────────────────────────────────────────────┤
│ sticky   │ main                                       │
│ 100vh    │   padding: clamp(16px, 2.4vw, 28px)        │
│          ├────────────────────────────────────────────┤
│          │ footer                                     │
└──────────┴────────────────────────────────────────────┘
```

- Shell is `grid-template-columns: 236px minmax(0,1fr)`.
- Header background `rgba(10,12,13,0.92)` + `backdrop-filter: blur(16px)`.
- Gutter is the same `clamp(16px,2.4vw,28px)` in header, main and footer - that clamp is the
  horizontal rhythm of the whole product.
- Section gap in views: `display: grid; gap: 20px`.

**Responsive: one breakpoint at 900px.** The sidebar unsticks, becomes a horizontal wrapped row of
nav buttons, and the group headings (`HEALTH` / `DOMAIN` / `OPERATE`) are hidden. That's it - there
is no tablet layout and no mobile-specific design. **If you want a real small-screen design, that is
genuinely open and worth doing.** It is currently a graceful degradation, not a designed state.

### Navigation - nine views in three groups

| Group | View | Icon (SF Symbols name) |
|---|---|---|
| **Health** | Overview | `square.grid.2x2` |
| | Traffic & 4xx | `waveform` |
| | Logs | `line.horizontal.3` |
| **Domain** | Rad | `mic.fill` |
| | Recommendations | `dot.radiowaves.left.and.right` |
| **Operate** | Users | `person.crop.circle` |
| | Stations | `playlist` |
| | Config | `slider.horizontal.3` |
| | Audit | `checkmark` |

Active nav item: `background rgba(63,179,166,0.14)`, `inset 2px 0 0 #3FB3A6`, border-radius
`0 6px 6px 0`, icon and label in teal/white.

**Nav items carry a live badge** - a count or percentage, coloured by severity. Overview shows the
number of open signals, Traffic the 4xx count, Recommendations the fallback rate. These are not
decorative; see §6.

---

## 4. Icons - Carbon, under SF Symbols names

The prototype referenced two PNG sets, `glyphs_3x` and `glyphs_teal`, because a bitmap can't be
tinted. Carbon components render `fill="currentColor"`, so **the active/inactive tint is now a colour
change on the parent** - same shapes at every DPI, and half the assets.

`src/icons.tsx` maps the SF Symbols names the design used onto Carbon components:

```
square.grid.2x2              → Dashboard
waveform                     → Activity
line.horizontal.3            → Catalog
mic.fill                     → Microphone
dot.radiowaves.left.and.right→ Radio
person.crop.circle           → UserAvatar
slider.horizontal.3          → SettingsAdjust
checkmark                    → Checkmark
chevron.right                → ChevronRight
magnifyingglass              → Search
exclamationmark.triangle     → WarningAlt
playlist / edit / save / close / renew   (added since - stations browser, config editor)
```

**Keep specifying icons in SF Symbols names.** The map is the translation layer, so views read against
your design rather than against Carbon's vocabulary, and swapping an icon is one line.

Sizes in use: 13px (inline with text), 15px (nav), 16px (default).

---

## 5. Component inventory - `src/components/primitives.tsx`

These are the shared pieces. Anything else is local to a view.

| Component | What it is | Notes for design |
|---|---|---|
| `SectionHead` | Uppercase label + **provenance** on the right | The meta string is mandatory in spirit - see §6 |
| `StatGrid` | The bordered stat strip | `auto-fit, minmax(190px, 1fr)`, 1px gaps showing through as hairlines |
| `KeyRow` | Ranked list row: label / value / note | Note column is 96px, right-aligned |
| `Prose` | Explanatory paragraph | Capped at 76ch |
| `Callout` | Bordered note, teal / amber / neutral | 5% tint fill, 24% border |
| `Bar` | 3px progress bar | Track `rgba(255,255,255,0.06)` |
| `Dot` | 7px status dot, optionally pulsing | Pulse = live only |
| `Unavailable` | **The "we could not ask" block** | See §6 - the most important one |
| `Loading` | "Reading {source}…" | Not a spinner, not a skeleton |
| `Source` | Wraps the three states so no view can forget one | |
| `ActionButton` | Disabled controls that state their reason | Never hidden, always explained |

---

## 6. The rules the design has to carry

This is the part that isn't visible in a static mock, and it's where most of the engineering went.
Each of these exists because of a specific real failure.

### 6.1 Every source has three states, and `unavailable` is a designed state

```
loading  →  "Reading 4xx by route…"
unavailable  →  a block naming the source, why it failed, and what to do
ok  →  the panel
```

**A failed source must never render as 0, as an empty chart, or as a spinner that never resolves.**
This is not a nicety. Cloudflare's own dashboard once displayed a total authentication outage as
"0 Errors" because 4xx is excluded from its error metric - every user locked out, dashboard green.
That incident is why this product exists.

So `Unavailable` is a first-class visual: amber warning triangle, uppercase `{SOURCE} UNAVAILABLE`,
then a sentence of plain English telling the operator what to actually do. **If you design a new
panel, please design its unavailable state too.** Empty ≠ broken ≠ zero, and the UI must never blur
those three.

### 6.2 Provenance on every panel

Every `SectionHead` carries a right-aligned mono string naming where the number came from:
`D1 · live`, `Analytics Engine`, `Workers Observability · 3d retention`, `rad_fm_events · poolSource`,
`premium_audit · append-only`.

These sources are **not equally trustworthy** - D1 is live truth, Analytics Engine lags and is
fire-and-forget, Observability retains 3 days - and the UI must not flatten that into "a number".

### 6.3 One derivation of "how is it going"

Nav badges and the Overview verdict come from a **single** module (`src/lib/health.ts`). During the
build there was a moment when the badge said 6, the verdict said 3 and the list showed 1 - three
counts of the same thing on one screen. That is the exact failure this tool exists to prevent, so the
derivation is now centralised and must stay that way.

Signals are **ranked by blast radius, not recency** - that's the Overview subtitle, and it's a design
commitment.

### 6.4 Motion means state

The dot pulses because something is **live**. Nothing pulses for visual interest - an animation that
implies liveness while showing stale data is a lie. `prefers-reduced-motion` kills all animation.

### 6.5 Disabled controls state their reason

`Force reconcile`, `Grant premium`, `Revoke premium` are visible and disabled, with
*"Mutations are Phase 4 - reads must earn trust first"* beside them. Hiding them would leave the
operator wondering whether the feature exists. This pattern generalises: **explain, don't hide.**

### 6.6 No false zeros

A live example: setlist fill rate rendered **0% in red** off a 0/0 sample. It now reads
**"No sample - no gigs in this window, not a 0% fill rate"**. Same class of lie as a false
"unavailable", and both have shipped once.

---

## 7. What the running app has that the prototype didn't

Worth pulling into the design file so the two stop diverging.

| Addition | Why |
|---|---|
| **Rad.FM JWT field** in the sidebar footer | There is no admin login by design; the operator supplies their own token. Only renders when the Worker can't reach the backend for them - normally invisible. |
| **Role chip** under the email (`OWNER` / `OPERATOR` / `NO ROLE`) + *"role resolved server-side per request"* | Role is never read from a token; tokens outlive grants. |
| **Nav badges** | Live counts per view. |
| **Retention warning bar** | Selecting `7d` shows an amber bar: Observability keeps 3 days, so log panels are capped regardless. Silent truncation was not acceptable. |
| **Demo banner** | Amber bar when `?demo=` is on. Fixtures are opt-in, self-announcing, and **never** a fallback. |
| **Freshness chip** | Pulsing dot + "Updated 24s ago", turns amber past 2 minutes. Click to refresh. |
| **Footer status line** | `radfm-ops · read-only · no D1 binding` and the auth mode. Says "Access NOT configured - dev bypass active" if it isn't. |
| **RevenueCat cross-check panel** (Users) | Local `premium_users` and RevenueCat side by side with an `IN AGREEMENT` / disagreement chip. A stale cache once silently stripped paid features from live subscribers. |
| **"Why the pool collapsed"** (Recommendations) | Cause breakdown; `error:deadline` (expected) separated from `error:validation` (a real bug). |
| **RevenueCat cron card** (Overview) | `lastRunAt: null` renders **"Never observed"** in red, not as healthy. |
| **Focus rings** | 2px teal, 2px offset, on every interactive element. |

The handoff flagged focus rings as the prototype's one accessibility gap - it relied on hover, which
is a real problem for a keyboard-driven tool used at 3am. That's fixed, and worth reflecting in the
design file so it isn't lost next iteration.

---

## 8. How to see the populated states

The live dashboard is usually **healthy**, so most panels show the boring case. Two fixture scenarios
render the design against realistic data, and they are the fastest way to review a change:

```
https://ops.rad-fm.com/?demo=healthy      everything nominal
https://ops.rad-fm.com/?demo=incident     signals open, badges lit, red states
```

Both need Cloudflare Access, so you'll need to be added to the `Rad.FM Ops` policy - it's currently
owner-only. **Say the word and that gets sorted; it's a two-minute change and worth it if you're
iterating.**

Fixtures live in `src/lib/fixtures.ts`. If you want a scenario that doesn't exist yet - a specific
failure shape you want to design against - ask and it can be added there in a few lines.

---

## 9. Iterating from here

**Things that are a one-line change:** any token value, any icon, any threshold, any copy string.
Send them however you like - a list is fine.

**Things worth designing properly, in rough priority:**

1. **The small-screen layout.** Currently degradation, not design. Genuinely open.
2. **Empty and unavailable states per panel.** Several are generic where a specific one would be
   better; the Users view in particular.
3. **Config view (Phase 4).** The first mutating surface - needs a confirm pattern, an optimistic /
   pending state, and a way to show that config writes take up to 30s to go global.
4. **Density.** Tables are comfortable; an operator scanning 40 log groups may want tighter. Untested
   either way.

**One request:** if a change affects how a *state* reads rather than how a panel looks - a colour that
implies severity, a zero that could be a real zero or a missing source, an animation that implies
liveness - flag it, and we'll check it against §6 together. Everything in that section is there
because it broke something first.

---

## 10. Repo map, if you want to look

```
src/
  App.tsx                   shell, nav, header, footer, routing
  theme.ts                  ← ALL design tokens
  icons.tsx                 ← SF Symbols name → Carbon component
  styles.css                resets, pulse keyframe, focus rings, 900px breakpoint
  components/primitives.tsx shared components (§5)
  views/                    one file per nav entry, nine files
  lib/health.ts             single derivation of verdict + badges
  lib/api.ts                three-state fetch layer
  lib/fixtures.ts           demo data
```

Everything is commented with *why*, not just what - the repo is its own handover document.
