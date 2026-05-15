# Design System: NODX Web — Article Analyzer (Wise Edition)

**Project:** NODX Web / @odixbat
**Context:** Tool / Dashboard UI
**Base:** Wise Design System — https://wise.design/
**Dials:** Creativity `4` · Density `5` · Variance `4` · Motion `4`

---

## 1. Visual Theme & Atmosphere

Clean, functional, and legible — a professional editorial tool built on the Wise design language. White backgrounds, generous whitespace, and a single bold accent (Wise Bright Green) that signals action without noise. The atmosphere is direct and clear: no dark theatrics, no grain, no ambience. The interface disappears so the content can be read.

---

## 2. Color Palette & Roles

**Backgrounds & Surfaces**
- **Screen White** (`#FFFFFF`) — Primary background. All screens default here
- **Neutral Surface** (`rgba(14,15,12,0.04)`) — Default card/panel background
- **Elevated Surface** (`rgba(14,15,12,0.06)`) — Elevated panels, hover states
- **Active Surface** (`rgba(14,15,12,0.09)`) — Focused/selected states
- **Panel Off-White** (`#F7F8F6`) — Slide-over panels (History)

**Text**
- **Content Primary** (`#0E0F0C`) — Headlines, primary labels, critical copy
- **Content Secondary** (`#454745`) — Body copy, descriptions, field text
- **Content Tertiary** (`#6A6C6A`) — Timestamps, metadata, placeholders

**Borders & Structure**
- **Border Neutral** (`rgba(14,15,12,0.12)`) — All structural 1px borders

**Shadows**
- **Card Shadow** (`0 0 0 1px rgba(14,15,12,0.08), 0 2px 8px rgba(14,15,12,0.06), 0 1px 2px rgba(14,15,12,0.04)`)

**Accent — Wise Bright Green**
- **Lime** (`#9FE870`) — Primary CTA, active states, progress fills, analyze button
- **Forest** (`#163300`) — Text on lime surfaces, editorial emphasis labels, link color

**Status Palette (functional only)**
- **Positive** (`#2F5711`) — Success states, positive sentiment
- **Warning** (`#EDC843`) — Warning alerts (background use only)
- **Negative** (`#A8200D`) — Error states, destructive actions
- **Info** (`#A0E1E1`) — Informational highlights

**Banned Colors**
- Pure black (`#000000`) — use Content Primary (`#0E0F0C`)
- Pure white (`#ffffff`) — always Screen White (`#FFFFFF`)
- Any purple, violet, or neon gradient — strictly banned
- Warm grays or gold tones — this system uses cool-neutral `#0E0F0C`-family only
- Warm-tinted dark backgrounds (`#070605`, `#0d0b09`)

---

## 3. Typography Rules

**Font Stack**
- **Primary:** `Inter`, `-apple-system`, `sans-serif` — All UI text, body, labels
- **No separate mono stack** — Inter at small sizes with letter-spacing serves label roles

**Weight System (Wise uses Medium + SemiBold)**
- **400 Regular** — Body copy, descriptions, field text
- **500 Medium** — Interactive labels, secondary headings (use sparingly)
- **600 SemiBold** — Display headlines, editorial emphasis, primary headings

**Scale**
- **Display** — `clamp(2.4rem, 6vw, 3.5rem)` · `letter-spacing: -0.04em` · `line-height: 1.04` · `font-weight: 600`
- **Headline** — `1.28rem` · `letter-spacing: -0.02em` · `line-height: 1.38` · `font-weight: 400`
- **Body** — `14px` · `letter-spacing: normal` · `line-height: 1.6` · Color: Content Secondary
- **Label** — `9px` · `letter-spacing: 0.14em` · `text-transform: uppercase` · Color: Content Tertiary

**Banned:**
- `Geist`, `Geist Mono` — replaced by Inter
- Generic serif fonts — absolutely banned in tool UIs
- All-caps body text

---

## 4. Component Stylings

**Buttons**
- Primary: Lime (`#9FE870`) fill · Forest (`#163300`) text · `border-radius: 0` (flush form bottom) or `border-radius: 100px` (pill)
- Secondary: Ghost — `1px solid rgba(14,15,12,0.12)` border · transparent fill · Content Primary text
- Active state: `transform: translateY(-1px) scale(0.98)` — tactile push
- Hover: `background: rgba(255,255,255,0.1)` sweep via `::before` pseudo-element

**Cards / Panels**
- Border radius: `4px` (card) · `8px` (panel)
- Fill: Neutral Surface
- Border: `1px solid rgba(14,15,12,0.12)`
- Shadow: Card Shadow variable
- Use cards ONLY when elevation communicates hierarchy

**Inputs / Forms**
- Background: transparent · Border: Border Neutral via parent · no border-radius (form clips)
- Label: Inter 9px uppercase above input, Content Tertiary color
- Focus: no focus ring on interior inputs (parent card provides container)
- Placeholder: Content Tertiary

**Tabs / Navigation**
- Active tab: Lime underline (`1px solid #9FE870` bottom border via `::after`)
- Active tab text: `--gold` (Lime)
- Inactive: Content Tertiary · hover to Content Secondary
- Tab labels: Inter 9px uppercase

**Skeleton Loaders**
- Shimmer: `skelPulse` — `opacity: 0.5 → 1.0` (2s ease-in-out infinite)
- Neutral Surface background: `rgba(14,15,12,0.05)`
- Never circular spinners

**Best Line Pullquote**
- Left border: `2px solid #9FE870` (Lime)
- No card wrapping — free-standing block
- Label: Lime color, 55% opacity

**Hook Cards**
- Left border: `2px` colored per hook type (HOOK_TYPE_COLORS)
- Hover: `translateX(3px)` — directional slide, not lift

---

## 5. Layout Principles

- CSS Grid for structural layouts
- Max-width: `1080px` tab panels, `540px` entry form
- Horizontal padding: `24px` mobile · `24px` desktop (tight for tool UI)
- Full-height: `min-height: 100dvh`
- No overlapping elements

---

## 6. Motion & Interaction

- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` — spring deceleration
- Reveal: `fadeInUp` — `opacity: 0→1` + `translateY(12px→0)` · `300ms`
- Stagger: `80ms` per child
- Tab underline: `tabIn` scaleX from left · `250ms`
- Loading bar: `barSweep` horizontal sweep · `1.9s` infinite
- No film grain, no ambient gradients

---

## 7. Anti-Patterns (Banned)

**Typography**
- `Geist`, `Geist Mono` — replaced by Inter
- Weight 400-only constraint — Wise uses 500/600 for hierarchy
- Generic serif fonts

**Color**
- Dark backgrounds (`#070605`, `#040404`, `#0d0b09`)
- Gold/warm accent (`#c8a24a`) — replaced by Wise Lime
- Warm-tinted surfaces (`rgba(255,240,180,...)`)
- Purple, violet, neon gradients
- Film grain overlays (light mode, not needed)

**Layout**
- 3 equal cards in a row
- `height: 100vh` — always `min-height: 100dvh`
- Flexbox percentage math with `calc()`

**UI Patterns**
- Circular loading spinners
- Outer glow shadows
- Custom mouse cursors

**Copy**
- AI clichés: "Unlock", "Seamless", "Next-Gen", "Elevate", "Game-changer"
- Emojis anywhere in the UI
