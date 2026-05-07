# Phase 2 — UI Design Brief

> **Purpose.** Hand this to a design agent (e.g. the Pencil MCP) to generate UI mockups for the streaming chat interface. It is grounded in `specs/phase-1-agentic-streaming-backend.md` (event taxonomy, data model) and `ASSIGNMENT.md` Part 2 + Part 3 (UI + voice requirements).
> **Out of scope for the designer.** Backend behavior, exact copy beyond what's specified here, marketing pages, settings/admin screens.
> **Non-goals.** Multi-tenant UX, auth flows, branding/logo, illustrations.

---

## 1. Product framing

**Rx Assistant** is a single-user healthcare-information chat. The user asks questions in natural language; the assistant streams a reasoned answer, optionally calling tools (`drug_info`, `symptom_lookup`) mid-stream. The UI must make the agent's *thinking* and *tool activity* legible, while keeping the chat itself fast to read.

**Trust posture.** This is an information surface, not a clinical one. Visuals should signal "informational, not medical advice" without being alarmist. No red triangles, no scary modals — clear, calm, sourced.

**Design language.** Match Anthropic's visual feel — see `anthropic.com` and `claude.ai`. Warm paper-like surfaces, serif display + grotesque sans, coral accent, generous whitespace, hairline borders over shadows. Full token system in §6.

**Primary device.** Desktop web (Chromium — STT requirement). Mobile-web is a secondary target; design must reflow gracefully but mobile-first is not required.

---

## 2. Screens to design

| # | Screen | Purpose |
| --- | --- | --- |
| S-1 | **Empty state / first run** | No conversation yet. Composer focused. Prompt suggestions visible. |
| S-2 | **Active chat — streaming** | A turn is in flight. Shows live text-delta, reasoning pulse, tool-call states. |
| S-3 | **Active chat — settled** | All turns complete. Metadata footers visible. Delete affordances visible on hover. |
| S-4 | **Conversation list (sidebar)** | List of prior conversations by `updated_at` desc; current one highlighted. |
| S-5 | **Mic permission denied** | Inline banner inside composer area, dismissible. |
| S-6 | **Upstream error mid-stream** | Error pill replaces the in-flight assistant message; chat below remains intact. |
| S-7 | **Step cap reached** | Subtle "Stopped after N steps" indicator below the final assistant message. |
| S-8 | **Loading conversation history** | Initial page-load skeleton before hydration completes. |

Deliver each screen at **desktop 1440 × 900** and **mobile 390 × 844**. Light mode is required; dark mode is a nice-to-have if time permits.

---

## 3. Information architecture

```
┌──────────────────────────────────────────────────────────────┐
│  AppShell                                                    │
│  ┌────────────────┐  ┌────────────────────────────────────┐ │
│  │ Sidebar        │  │ ChatPane                           │ │
│  │  · New chat    │  │  ┌──────────────────────────────┐  │ │
│  │  · Conv list   │  │  │ MessageList (scroll)         │  │ │
│  │                │  │  │   Message · Message · …      │  │ │
│  │                │  │  └──────────────────────────────┘  │ │
│  │                │  │  ┌──────────────────────────────┐  │ │
│  │                │  │  │ Composer                     │  │ │
│  │                │  │  └──────────────────────────────┘  │ │
│  └────────────────┘  └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- **Sidebar** is collapsible on desktop; replaced by a hamburger sheet on mobile.
- **MessageList** auto-scrolls to bottom while a stream is in flight; auto-scroll pauses if the user manually scrolls up.
- **Composer** is sticky to the viewport bottom; grows up to a max height before internal scroll.

---

## 4. Component inventory + state variants

For each component, the designer must produce **every listed state** as a separate frame (or as a state-stack on a single artboard).

### 4.1 `Message` — user

States: `default`, `hover (delete affordance visible)`.

Layout: right-aligned bubble, accent fill, max-width ~70% of pane.

### 4.2 `Message` — assistant

The assistant message is an **interleaved stack of blocks** rendered in stream order. Block types and their states:

| Block | States |
| --- | --- |
| `TextBlock` (markdown) | streaming (caret blinking at end), settled |
| `ReasoningPanel` | streaming-collapsed, streaming-expanded, settled-collapsed, settled-expanded |
| `ToolCall` | pending, running, complete-success, complete-error, expanded (input+output visible) |

Beneath the last block: `MessageFooter` showing `timestamp · model · in/out tokens · $cost · ⋯` with a delete action behind the menu.

States to deliver for the whole assistant message:
- `streaming` (one or more blocks still live)
- `settled`
- `errored` (mid-stream failure — see §4.6)
- `capped` (step cap reached — small inline note above footer)

### 4.3 `ReasoningPanel`

Collapsible block. **Default state is collapsed.** Header: an icon + label.

| State | Header label | Visual cue |
| --- | --- | --- |
| streaming-collapsed | "Thinking…" | Pulsing dot, animated |
| streaming-expanded | "Thinking…" | Pulse + revealed reasoning text streaming live |
| settled-collapsed | "Thoughts" | Static chevron |
| settled-expanded | "Thoughts" | Reasoning text fully visible |

Reasoning text uses a slightly muted color and smaller line-height than primary message text — reader should be able to tell it apart from the answer at a glance.

### 4.4 `ToolCall`

Inline block within the assistant message stream.

| State | Triggered by SSE event | Visual |
| --- | --- | --- |
| pending | `tool-call-start` | Gray pill, tool name, "Preparing input…" |
| running | `tool-call-end` (input fully streamed; result not yet back) | Blue pill, spinning indicator, tool name |
| complete-success | `tool-call-result` with `isError: false` | Green check pill, tool name + duration |
| complete-error | `tool-call-result` with `isError: true` | Amber pill (NOT red), tool name + "Returned an error" |

Each pill is **clickable to expand**, revealing:
- **Input** — JSON, monospace, syntax-highlighted, scrollable if long.
- **Output** — formatted view appropriate to the tool. For `drug_info`: name, indications, warnings, dosage as a small definition list. For `symptom_lookup`: description, common causes, when-to-seek-care, plus the disclaimer string. Raw JSON view is available behind a "View raw" toggle.

The pill must visually anchor *inside* the message stream (indented, connected to surrounding text), not float as a separate card.

### 4.5 `MessageFooter`

Compact metadata row beneath each assistant message.

```
14:32 · sonnet-4.6 · 1,204 in / 387 out · $0.0072 · ⋯
```

- Timestamp is local time, 24h.
- Token counts use thousands separator.
- Cost shows up to 4 decimal places; values < $0.0001 show as "<$0.0001".
- The `⋯` opens a menu containing: `Copy`, `Delete`. On user messages the same menu is the only place delete lives (no hover trash icon clutter).

Cache token savings (`cache_read_tokens`) — when present and non-zero — appear as a small "(X cached)" annotation next to input tokens, dimmed.

### 4.6 `Composer`

Sticky bottom. Components left-to-right:
- Multiline textarea (auto-grow, min 1 row, max ~6).
- **Mic button** — toggle. States: `idle`, `recording (pulsing red dot)`, `denied (lock icon, click → tooltip + permission help)`.
- **TTS toggle** — speaker icon. States: `off (default)`, `on`.
- **Send button** — disabled until input is non-empty; shows spinner while waiting for first token (the `submitting` state).

Below the textarea, a thin row reserved for transient banners:
- "Listening — say your question" (while recording)
- "Microphone permission denied. Enable mic access in browser settings to use voice input." (S-5 state)

### 4.7 `AudioPlayer` (TTS playback)

Two variants:
- **Latest assistant message:** auto-plays. Compact bar showing only a progress line and a pause button. Collapses to nothing when audio ends.
- **Older assistant messages:** manual player. Native-feel controls: play/pause, scrubber, time elapsed/total, volume.

If TTS generation fails, the player simply does not appear (silent failure per spec). No error UI.

### 4.8 `Sidebar / ConversationList`

- "+ New chat" button at top.
- List items: title (auto-derived from first user message, truncated to ~40 chars), `updated_at` relative ("2m ago", "Yesterday"), 3-dot menu (`Rename`, `Delete`).
- Active conversation has a left accent bar.
- Empty state: "No conversations yet."

### 4.9 `LoadingSkeleton`

For S-8 (page load before history hydrates): 3 stub message bubbles with shimmer animation, no avatars.

### 4.10 `FirstTokenIndicator`

While `state === 'submitting'` (no first token yet), show under the user's just-sent message: three pulsing dots in an assistant-aligned bubble. Disappears the instant the first `text-delta` or `reasoning-delta` arrives.

---

## 5. Streaming visual semantics (the heart of this brief)

The user must be able to glance at the screen and tell:

1. **The model is generating** — caret in the active text block, or pulsing dot in reasoning.
2. **A tool is running** — distinct from text generation, anchored inline so causality is clear.
3. **A tool finished** — color shift from running → complete; the answer continues from there.
4. **Generation is finished for this turn** — caret gone, footer appears.

Movement budget: at most **one** animated element per message at a time (caret OR reasoning pulse OR tool spinner). When a tool is running, the text caret pauses. This avoids a "Christmas tree" of competing animations.

---

## 6. Visual system

### 6.1 Design language anchor — Anthropic

The reference is `anthropic.com` and `claude.ai`. Concrete cues:

- **Warm, paper-like surfaces.** Off-white cream/sand backgrounds. Avoid pure `#FFFFFF` and pure `#000000` anywhere.
- **Serif display + grotesque sans.** A serif for first-run greeting and markdown headings; a clean sans for body, chrome, and metadata.
- **Coral accent, used sparingly.** A single warm orange-coral for primary CTA, active items, links, and the streaming caret. No secondary accent colors.
- **Borders over shadows.** 1px hairlines for separation. Shadow reserved for true elevation (modals/popovers — not used in this scope).
- **Calm, generous whitespace.** Comfortable density, not packed. Reading rhythm matters more than information density.
- **Thin line icons.** ~1.5px stroke, rounded caps and joins (Lucide / Phosphor-Light feel).
- **Quiet motion.** Short, gentle, no bounce, no spring.

The agent should treat anthropic.com / claude.ai as authoritative when this brief is silent.

### 6.2 Color tokens (light)

| Token | Description |
| --- | --- |
| `bg/canvas` | Warm off-white cream — page background |
| `bg/surface` | Slightly lighter than canvas — message backgrounds, sidebar |
| `bg/surface-raised` | Slightly darker than surface — hover row, selected sidebar item |
| `bg/user-bubble` | Warm tan / pale apricot — user message fill |
| `border/subtle` | Hairline border between surfaces |
| `border/strong` | Input outlines, expanded tool-pill outlines |
| `text/primary` | Warm near-black (≈`#1C1B17` register) — body text |
| `text/secondary` | Warm mid-gray — metadata, reasoning text, timestamps |
| `text/disabled` | Warm light-gray — dim values |
| `accent/primary` | Anthropic coral — primary CTA, active item, links |
| `accent/primary-hover` | Slightly darker coral |
| `accent/streaming` | Coral — caret + reasoning pulse |
| `state/tool-pending` | Warm gray pill |
| `state/tool-running` | Soft desaturated blue pill (cool but warm-tuned) |
| `state/tool-success` | Muted sage / olive green pill |
| `state/tool-warn` | Warm amber pill — tool errors AND step-cap notice |
| `state/error` | Restrained brick red — only S-6 mid-stream error pill |

Optional dark mode: preserve the warmth — warm dark gray (≈`#1F1E1A` register), not pure black; same coral, slightly lifted in luminosity.

### 6.3 Typography ramp

Family stacks (designer chooses an exact serif/sans within the spirit; system fallbacks listed):

```
--font-serif: ui-serif, "Tiempos Headline", "Copernicus", "Iowan Old Style", Charter, Georgia, serif
--font-sans:  "Söhne", "Styrene B", Inter, ui-sans-serif, system-ui, sans-serif
--font-mono:  "Söhne Mono", ui-monospace, "JetBrains Mono", Menlo, monospace
```

| Token | Family | Size / line-height | Weight | Use |
| --- | --- | --- | --- | --- |
| `display/lg` | serif | 40 / 48 | 400 | First-run greeting heading |
| `display/md` | serif | 28 / 36 | 400 | Empty-state subhead |
| `heading/lg` | serif | 22 / 30 | 500 | Markdown h1 |
| `heading/md` | serif | 19 / 28 | 500 | Markdown h2 |
| `heading/sm` | sans  | 16 / 24 | 600 | Markdown h3, section labels |
| `body/md`    | sans  | 15 / 24 | 400 | Default chat body |
| `body/sm`    | sans  | 13.5 / 22 | 400 | Reasoning text (paired with `text/secondary`) |
| `caption`    | sans  | 12 / 18 | 500, tabular-nums | Metadata footer |
| `label`      | sans  | 13 / 18 | 500 | Tool-pill labels, sidebar items, button text |
| `code/inline`| mono  | 13.5 / 22 | 400 | Inline `code` |
| `code/block` | mono  | 13 / 22 | 400 | Code blocks, JSON tool input/output |

Rules:
- Serif is reserved for first-run greeting and markdown headings only — never for chrome (buttons, labels, footers).
- Body weight 400; emphasis 500. Markdown `**strong**` renders 600. Avoid 700+.
- Letter-spacing: `-0.005em` on body sans, `-0.01em` on serif headings, `0` on mono.
- Tabular-nums on metadata, token counts, costs, timestamps, durations.

### 6.4 Spacing scale (4-base)

```
space-0: 0    space-3: 12   space-6: 32
space-1: 4    space-4: 16   space-7: 48
space-2: 8    space-5: 24   space-8: 64
```

- All padding, margin, and gap values come from this scale — no off-scale values.
- Default rhythm: between blocks `space-5` (24); inside a card `space-3` (12); intra-line `space-2` (8).
- Message-list outer padding: `space-6` (32) desktop, `space-4` (16) mobile.
- Composer outer padding: `space-4` (16).

### 6.5 Radius scale

```
radius-xs: 4   radius-sm: 6   radius-md: 8   radius-lg: 12   radius-pill: 999
```

- Inputs, code blocks, JSON panels: `radius-sm`.
- Cards, message bubbles, tool-call expanded panels, sidebar items, menus: `radius-md`.
- Tool-call pills, mic/TTS toggles, chips, status badges: `radius-pill`.
- Send button: `radius-md`.

### 6.6 Elevation scale (border-first)

```
elevation-0: none                                                        — flat surface
elevation-1: 1px hairline border (border/subtle), no shadow              — surfaces, cards, message bubbles
elevation-2: 1px border (border/strong) + 0 1 2 rgba(0,0,0,0.04)         — composer focused, active hover row
elevation-3: 0 8 24 rgba(28,27,23,0.08), no border                       — popovers (defined for completeness; not used in this scope)
```

If a separation can be communicated by `elevation-1`, do not use `elevation-2`. No skeuomorphic depth, no gradients.

### 6.7 Motion vocabulary

```
duration-fast:   120ms   — hover, focus
duration-normal: 200ms   — toggle, expand/collapse, sidebar open
duration-slow:   320ms   — initial page reveal, conversation switch fade
ease-standard:   cubic-bezier(0.2, 0, 0, 1)
ease-emphasis:   cubic-bezier(0.3, 0, 0, 1)
```

Stream-specific motion:
- **Streaming caret** — 1.0s blink, square wave (instant on/off, typewriter-feel; no fade).
- **Reasoning pulse** — 1.6s sine pulse on opacity 0.3 → 1.0 on the dot only, not the panel.
- **Tool spinner** — 0.9s linear rotation, thin coral ring.

All three have `prefers-reduced-motion` static equivalents (caret = solid, pulse = static dot, spinner = static dotted ring). No bounce, overshoot, or spring physics anywhere.

### 6.8 Iconography

- **Style:** line, ~1.5px stroke, rounded caps and joins. Source-feel: Lucide or Phosphor-Light.
- **Size tokens:** `icon-sm` 14, `icon-md` 18, `icon-lg` 24.
- **No filled glyphs** in chrome. Filled is allowed only for state badges (the green check on tool-complete-success, the coral dot on streaming).
- **No medical iconography in chrome** — no caduceus, cross, pill, syringe in nav, sidebar, header. Within tool output, a small contextual glyph (e.g., a beaker line-icon for `drug_info`) is acceptable if it stays in the line style.

### 6.9 Density, rhythm, symmetry

- **Baseline rhythm.** Every vertical measurement is a multiple of 4. Optical alignment trumps mathematical alignment — when a serif heading needs a 2px nudge for cap-height alignment, take it.
- **Reading line.** Aim for 60–75 characters per line in the message column at 720px max.
- **Vertical alignment within a message.** Tool pills, reasoning panels, and text blocks share the same left edge; nothing floats independently inside the message column.
- **Symmetry rules.** The chat pane is centered in the viewport at all breakpoints. User and assistant messages occupy the *same* column (right- and left-anchored within it) — do not push user bubbles to the right edge of the viewport. Sidebar is left, composer is bottom-fixed; no right-rail.
- **Card breathing room.** Adjacent cards / blocks always have at least `space-4` (16) between them. No touching borders.

### 6.10 Breakpoints

```
mobile:   ≤ 599px       single column, sidebar as sheet (hamburger)
tablet:   600–1023px    single column, sidebar collapsible
desktop:  ≥ 1024px      two-column, sidebar fixed (280px)
wide:     ≥ 1440px      content column stays at 720px; extra width is gutter
```

Deliverables in §10 cover desktop (1440) and mobile (390); the designer should annotate any non-obvious reflow rule (e.g., where the metadata footer wraps).

---

## 7. Interaction details

| Interaction | Behavior |
| --- | --- |
| Submit | Enter sends; Shift+Enter newlines. |
| Auto-scroll | Pinned to bottom during streaming; pauses if user scrolls up; "Jump to latest" pill appears. |
| Hover delete | Delete affordance (or its menu) only shows on hover/focus, never permanently. |
| Reasoning toggle | Click anywhere on the panel header. |
| Tool expand | Click the pill. Smooth height transition; long content scrolls within. |
| Mic toggle | Click to start; click again to stop early. Auto-stop ~1.2s after silence triggers submit. |
| TTS toggle | Persistent across the session (localStorage). |
| Conversation switch | Optimistic — selected immediately, content fades in once loaded. |
| Delete confirmation | Inline confirm ("Delete?" / "Cancel"), no modal. |

---

## 8. Content & copy (canonical strings)

These strings are the canonical source — designer should not invent variants.

- First-run greeting (above empty composer): **"Ask about a medication or a symptom. Answers are informational, not medical advice."**
- Symptom_lookup disclaimer (rendered inside tool output): **"This information is general and not a substitute for professional medical advice. If symptoms are severe or worsening, contact a clinician."**
- Mic denied banner: **"Microphone permission denied. Enable mic access in browser settings to use voice input."**
- Upstream error pill: **"Something went wrong while generating. Try again."**
- Step cap inline note: **"Stopped after the maximum number of reasoning steps."**
- Empty conversation list: **"No conversations yet."**

---

## 9. Accessibility requirements

- Color contrast: meet WCAG AA for body text (4.5:1), large text (3:1), UI components (3:1).
- All interactive elements keyboard-reachable; visible focus rings (designer must show focus state for buttons, pills, sidebar items, composer).
- Streaming caret and reasoning pulse must NOT be the only signal — pair with a textual label ("Thinking…", screen-reader-announced status).
- Animations respect `prefers-reduced-motion`: replace caret blink, reasoning pulse, and tool spinner with static equivalents (designer should produce a "reduced motion" frame for the streaming state).
- Tool pills must have a non-color indicator of state (icon + text), not color alone.

---

## 10. Deliverables

The design agent should produce:

1. **One Pencil document** with frames for screens S-1 through S-8 at desktop and mobile breakpoints.
2. **One components page** with every state variant from §4 (tool pill ×5, reasoning panel ×4, message ×4, composer ×4, audio player ×2, etc.).
3. **One tokens page** documenting the color, type, and spacing tokens chosen.
4. **A short rationale comment** on each screen frame: what the design decision is and which spec requirement it satisfies (FR/feature reference, not prose).

Naming convention: `S-{n}-{slug}` for screens, `C-{slug}-{state}` for components, e.g. `C-toolcall-running`, `C-reasoning-streaming-expanded`.

---

## 11. Acceptance criteria (designer's definition of done)

- [ ] All 8 screens delivered at both breakpoints (light mode minimum).
- [ ] Every component state listed in §4 has a frame.
- [ ] No two states of the same component are visually ambiguous (e.g. tool-running vs tool-pending must be distinguishable without color alone).
- [ ] Every animated element from §5 has a corresponding `prefers-reduced-motion` static frame.
- [ ] All canonical copy strings from §8 appear verbatim in the relevant frames.
- [ ] Token documentation page is present and the rest of the design references those tokens (no orphan colors).
- [ ] Focus states shown for all interactive elements.
- [ ] Healthcare disclaimer surfaces in S-1, in `symptom_lookup` tool output, and beneath the composer (small dim text).

---

## 12. Reference — backend stream events the UI must visualize

(Pulled from `specs/phase-1-agentic-streaming-backend.md` §3.2.1, restated here so the designer doesn't need to chase the reference.)

| Event | Triggers UI change |
| --- | --- |
| `start` | Replace `FirstTokenIndicator` with empty assistant bubble (caret blinking). |
| `text-delta` | Append to active `TextBlock`; caret follows. |
| `reasoning-start` / `-delta` / `-end` | Show/update/freeze `ReasoningPanel`. |
| `tool-call-start` | Insert `ToolCall` pill in `pending` state. |
| `tool-call-delta` | Stream args into pill's hidden input panel (no visible change unless expanded). |
| `tool-call-end` | Pill → `running`. |
| `tool-call-result` | Pill → `complete-success` or `complete-error`. |
| `step` (reason `capped`) | Show `capped` note above message footer. |
| `metadata` | Render `MessageFooter`. |
| `done` | Stop caret; final settled state. |
| `error` | Replace in-flight blocks with error pill (S-6); preserve already-streamed content above. |

---

## 13. What the designer should NOT do

- Invent product features (no settings panels, no theming UI, no admin views).
- Add branding, logos, or marketing copy.
- Design auth/login screens — single-tenant.
- Use saturated medical iconography (no caduceus, crosses, pill bottles in primary chrome).
- Add modals where inline interactions suffice (delete, error, permission denial all stay inline).
- Use shadows or gradients where a 1px hairline border communicates the same separation.
- Use off-scale spacing, radii, or font sizes — every value must come from the scales in §6.4 / §6.5 / §6.3.
