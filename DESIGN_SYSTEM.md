# Z Catchers: Warm Dark Design System & Component Specification (`DESIGN_SYSTEM.md`)

> **AGENT DIRECTIVE FOR ANTIGRAVITY:**
> **Z Catchers** is designed to be opened in dark bedrooms right before sleep and as an active community dashboard during the day. The interface must feel like a warm bedside lamp—calm, cozy, uncluttered, and free of harsh blue light. Follow the exact color tokens, typography rules, responsive desktop + mobile PWA specifications, and Fox mascot guidelines in this document.

---

## 1. Core Aesthetic & Architectural Principles

1. **Zero Blue-Light Glare:** Never use pure white (`#FFFFFF`), pure black (`#000000`), or standard Tailwind blues/indigos (`blue-500`, `indigo-600`). Every background, border, and text color is tinted with warm espresso, amber, terracotta, or cream undertones.
2. **Dual Responsive Ergonomics (Mobile PWA + Desktop Dashboard):**
   * **Mobile View (< 768px):** Retain a focused single-column vertical stack, thumb-zone bottom navigation, and slide-up bottom sheets for modals. Feels like a lightweight, native mobile PWA.
   * **Desktop & Tablet Website View (≥ 768px / 1024px+):** Expand the main container to `max-w-7xl mx-auto px-6 lg:px-8`. Provide a full-featured desktop web command center with a wide top command bar, multi-column status grids, live local clocks, and centered dialog modals.
3. **The "Sleepy Fox" Mascot Identity:**
   * A cozy, minimalist fox mascot is the emotional heart of Z Catchers, embodying the warm, nocturnal den where friends look after each other's rest.
   * Illustrated using clean vector geometric shapes, warm rust orange (`#E07A5F`), golden amber (`#F4A261`), and soft cream (`#F5EBE1`).
   * Never overly cartoonish or noisy; designed to fit gracefully into a calm night-mode aesthetic.
4. **Instant Scannability:** A user should be able to open the app and know within $2\text{ seconds}$:
   * Who needs to be nagged right now.
   * What time everyone goes to bed in **the viewer's own timezone**.
   * How to jump straight into a member's Discord journal thread with a single tap.

---

## 2. Color Tokens & Tailwind Configuration

Configure these exact tokens inside `tailwind.config.ts` (or CSS variables in `globals.css`) and use them exclusively across all components:

| Token / Class Name | Hex Code | Role & Usage |
| :--- | :--- | :--- |
| `night-bg` | `#120F0D` | Root page background & PWA theme color (Deep warm espresso) |
| `night-surface` | `#1C1714` | Default `MemberCard`, header, and bottom nav background |
| `night-elevated` | `#26201B` | Inputs, hover states, secondary buttons, and collapsible bucket headers |
| `night-border` | `#332B24` | Default $1\text{px}$ hairline borders on cards and dividers |
| `cream-primary` | `#F5EBE1` | Primary text: Member names, brand wordmark, and converted viewer bedtime |
| `cream-secondary` | `#B0A295` | Secondary text: Sleeper's local time, timezone labels, subtitles |
| `cream-muted` | `#73675C` | Muted text: Sleeping cards, disabled buttons, helper captions |
| `amber-glow` | `#E59843` | Primary brand accent, "Winding Down" status, active nav tab |
| `coral-nag` | `#D96B52` | Urgent "Bedtime Hit / Nag Now" alert border, badge, and primary CTA |
| `sage-awake` | `#6B9E78` | Calm "Awake" status dot and Push Notification active indicator |
| `slumber-indigo` | `#5B6B94` | Muted "Sleeping / Sleep Shield Active" status badge |
| `fox-rust` | `#E07A5F` | Terracotta / warm rust orange base fur for the Sleepy Fox mascot |
| `fox-amber` | `#F4A261` | Golden amber highlight for mascot ears, tail accents, and lantern flame |

### Ready-to-Use `tailwind.config.ts` Extension

```typescript
// Inside tailwind.config.ts -> theme.extend.colors
colors: {
  night: {
    bg: '#120F0D',
    surface: '#1C1714',
    elevated: '#26201B',
    border: '#332B24',
  },
  cream: {
    primary: '#F5EBE1',
    secondary: '#B0A295',
    muted: '#73675C',
  },
  status: {
    amber: '#E59843',
    coral: '#D96B52',
    sage: '#6B9E78',
    slumber: '#5B6B94',
  },
  fox: {
    rust: '#E07A5F',
    amber: '#F4A261',
  },
}
```

---

## 3. The "Z Catchers" Sleepy Fox Mascot

The mascot brings character, warmth, and intuitive visual cues to the community experience without disturbing the low-blue-light environment.

```
       /\_/\
      ( >.< ) ~ z Z Z
     /  🦊  \
    (  (   )  )
     ""   ""
```

### 3.1 Mascot Identity & Logo Integration
* **Brand Logo & Header:** A custom SVG Sleepy Fox icon (cozy stylized fox head or curled sleeping fox profile with warm rust `#E07A5F` base, golden amber `#F4A261` inner ear/cheeks, and cream `#F5EBE1` muzzle) placed adjacent to the **Z Catchers** wordmark.
* **Vector Aesthetic:** Minimalist geometric curves, soft rounded corners, zero harsh black outlines.

### 3.2 Contextual Fox Mascot States
The mascot changes pose and expression depending on community activity and the viewer's status:

| Context / State | Mascot Pose & Motif | Visual Placement & Trigger |
| :--- | :--- | :--- |
| **Brand / Header** | Cozy fox profile with warm crescent glow | Sticky header on mobile and desktop command bar |
| **Winding Down / Awake** | Cozy fox yawning or holding a warm glowing lantern | Hero banner when members are in wind-down window or community is active |
| **Bedtime Hit (Nag Now)** | Alert fox ringing a tiny brass bell or peeking over card edge | Urgent alert banner prompting: *"It's bedtime for your friends! Ring the bell in their journal."* |
| **Sleeping / Sleep Shield** | Curled-up sleeping fox wrapped in fluffy tail with subtle floating `"Zzz"` | Viewer's personal Sleep Shield active banner, or empty status bucket state: *"Every fox in this den is fast asleep."* |

### 3.3 PWA Manifest & Notification Assets
* **PWA App Icon (`public/icons/icon-512x512.png` & `public/icons/icon.svg`):**
  * Deep espresso `#120F0D` background.
  * Curled sleeping fox mascot centered with floating amber crescent moon and soft `"Zzz"`.
  * Clean squircle mask with no harsh white edges.
* **Push Notification Badge (`public/icons/badge-96x96.png`):**
  * Monochrome/silhouette minimalist fox head icon optimized for mobile notification trays.

---

## 4. Dual Responsive Layout Architecture

### 4.1 Mobile View (< 768px)
On mobile screens, Z Catchers operates as a high-density, thumb-accessible PWA:
* **Container:** Single-column vertical flow with padding `px-4 py-3`, max width constrained to screen bounds.
* **Header:** Compact 56px sticky bar showing the Fox logo, detected local timezone pill, and push notification bell toggle.
* **Status Buckets:** Collapsible accordion sections with status count pills and full-width `MemberCard` components.
* **Bottom Navigation:** Fixed bottom bar (`h-16`, `border-t border-night-border`, `bg-night-surface/95 backdrop-blur-md`) with thumb-friendly touch targets ($\ge 44\text{px}$) and iOS `env(safe-area-inset-bottom)` spacing.

```
+------------------------------------------+
| 🦊 Z Catchers        [Viewing: IST +5:30]| <- Sticky Top Header (56px)
+------------------------------------------+
| 🔔 Enable Push Alerts to nag friends [X] | <- Conditional PWA / Push Banner
+------------------------------------------+
| 🦊 [Nag Alert: 1 friend needs sleep! ]   | <- Contextual Fox Banner
+------------------------------------------+
| ▼ 🚨 NAG NOW (BEDTIME HIT)           (1) | <- Priority Bucket (Accordion)
| +--------------------------------------+ |
| | MemberCard (Single Column)           | |
| +--------------------------------------+ |
| ▼ 🕯️ WINDING DOWN SOON               (2) |
|   ...                                    |
+------------------------------------------+
|   [ 🏠 Roster ]  [ 🕒 My Time ] [ 🛡️ Mod ] | <- Sticky Bottom Nav (64px)
+------------------------------------------+
```

### 4.2 Desktop & Tablet Website View (≥ 768px / 1024px+)
On wider viewports, Z Catchers transforms into a spacious, multi-column community dashboard:
* **Container:** `max-w-7xl mx-auto px-6 lg:px-8 py-6` to utilize wide monitors cleanly without awkward stretching.
* **Top Header / Command Bar:**
  * Left: Fox mascot SVG logo + "Z Catchers" brand wordmark.
  * Center: Live local digital clock (`tabular-nums`) with viewer's timezone string and Sleep Shield status toggle badge (`🌙 Sleep Shield: Active / Inactive`).
  * Right: Desktop quick-action navigation buttons:
    * `"My Schedule"` (opens centered schedule modal)
    * `"Mod Panel"` (opens moderator passcode modal)
    * `"Notifications"` (toggles Web Push / VAPID subscription)
* **Bottom Nav Hidden:** Sticky mobile bottom bar is completely hidden (`hidden md:hidden`) on desktop.
* **Status Buckets & Multi-Column Member Grid:**
  * Status sections expand across the full container width.
  * Member cards render inside a responsive CSS Grid:
    `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`
  * Empty buckets render a peaceful den state: a curled sleeping fox with the message *"Every fox in this den is fast asleep."*

```
+---------------------------------------------------------------------------------------------------------+
| 🦊 Z Catchers   |  🕒 11:30 PM (Asia/Kolkata)  •  [ 🌙 Shield: Active ]  |  [My Schedule] [Mod] [🔔 Alerts]| <- Command Bar
+---------------------------------------------------------------------------------------------------------+
| 🦊 Contextual Hero Banner: "Cozy Den • 2 friends winding down, 1 past bedtime"                         |
+---------------------------------------------------------------------------------------------------------+
| ▼ 🚨 NAG NOW (BEDTIME HIT) (2)                                                                          |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | MemberCard #1      | | MemberCard #2      | | (CSS Grid 4-col)   | |                    |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
|                                                                                                         |
| ▼ 🕯️ WINDING DOWN SOON (3)                                                                             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | MemberCard #3      | | MemberCard #4      | | MemberCard #5      | |                    |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
|                                                                                                         |
| ▼ ☀️ AWAKE (8)                                                                                          |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
| | MemberCard #6      | | MemberCard #7      | | MemberCard #8      | | MemberCard #9      |             |
| +--------------------+ +--------------------+ +--------------------+ +--------------------+             |
+---------------------------------------------------------------------------------------------------------+
```

---

## 5. Exact Component States (`MemberCard.tsx`)

The `MemberCard` component adapts gracefully to both single-column mobile lists and multi-column desktop grids:

### State 1: `BEDTIME_NOW` (0 to 60 mins past bedtime — Urgent Nag State)
* **Card Container:** `bg-night-surface border-2 border-status-coral/80 rounded-2xl p-4 shadow-lg shadow-status-coral/10 flex flex-col justify-between`
* **Status Pill:** `bg-status-coral/20 text-status-coral border border-status-coral/40 px-2.5 py-0.5 rounded-full text-xs font-semibold animate-pulse`
  * Text: `"🚨 Bedtime hit 14m ago"`
* **Action Button:** Full-width primary button (`w-full min-h-[44px] bg-status-coral hover:bg-status-coral/90 text-night-bg font-semibold rounded-xl flex items-center justify-center gap-2 mt-3`)
  * Label: `"Nag in Discord Journal ↗"`

### State 2: `WINDING_DOWN` (1 to 60 mins before bedtime)
* **Card Container:** `bg-night-surface border border-status-amber/60 rounded-2xl p-4 flex flex-col justify-between`
* **Status Pill:** `bg-status-amber/15 text-status-amber border border-status-amber/30 px-2.5 py-0.5 rounded-full text-xs font-medium`
  * Text: `"🕯️ Bedtime in 28m"`
* **Action Button:** Secondary warm button (`w-full min-h-[44px] bg-night-elevated hover:bg-status-amber/20 text-status-amber border border-status-amber/40 font-medium rounded-xl flex items-center justify-center gap-2 mt-3`)
  * Label: `"Say Goodnight in Journal ↗"`

### State 3: `AWAKE` (More than 60 mins before bedtime)
* **Card Container:** `bg-night-surface border border-night-border rounded-2xl p-4 flex flex-col justify-between`
* **Status Pill:** `text-cream-secondary text-xs tabular-nums`
  * Text: `"☀️ in 6h 15m"`
* **Action Button:** Compact link button (`min-h-[40px] px-3 bg-night-elevated text-cream-secondary hover:text-cream-primary rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 mt-3`)
  * Label: `"Journal ↗"`

### State 4: `SLEEPING` (1 to 8 hours past bedtime — Sleep Shield Active)
* **Card Container:** `bg-night-surface/60 border border-night-border/60 rounded-2xl p-4 opacity-60 transition-opacity hover:opacity-90 flex flex-col justify-between`
* **Status Pill:** `bg-status-slumber/15 text-status-slumber border border-status-slumber/30 px-2.5 py-0.5 rounded-full text-xs`
  * Text: `"🌙 Catching Z's • Shield Active"`
* **Action Button:** Subtle muted link (`text-cream-muted hover:text-cream-secondary text-xs flex items-center justify-center gap-1 mt-3`)
  * Label: `"Leave quiet note in Journal ↗"`

### State 5: Pending 48-Hour Cooldown Sub-Banner
Whenever `member.pending_effective_at` is in the future, render a dashed sub-banner inside the card above the action button:
* **Banner Style:** `mt-2.5 px-3 py-1.5 rounded-lg bg-status-amber/10 border border-dashed border-status-amber/40 text-xs text-status-amber flex items-center justify-between tabular-nums`
* **Text:** `"⏳ Schedule shifting to [Pending Viewer Time] in 34h 12m"`

---

## 6. Modals, Drawers & Dialog Architecture

### 6.1 Responsive Modal Dual-Pattern
* **Mobile View (< 768px):** Slide-up bottom sheet (`fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-night-surface border-t border-night-border rounded-t-3xl p-5 shadow-2xl max-h-[85vh] overflow-y-auto`).
* **Desktop View (≥ 768px):** Centered dialog modal (`fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-bg/80 backdrop-blur-md` with inner dialog `w-full max-w-lg bg-night-surface border border-night-border rounded-2xl p-6 shadow-2xl`).

### 6.2 48-Hour Cooldown Warning Callout (Inside `MyScheduleModal`)
When a user edits their existing bedtime or timezone, display a clear callout box above the Save button:
* **Style:** `bg-status-amber/10 border border-status-amber/30 rounded-xl p-3 text-xs text-cream-secondary leading-relaxed`
* **Copy:** `"🛡️ Accountability Cooldown: Changing your bedtime or timezone takes 48 hours to take effect so nobody can dodge their bedtime at the last minute. Updating your Discord Journal link is instant."`

### 6.3 PWA & Push Permission Banner (`PwaBanner.tsx`)
* **Condition 1 (iOS Browser, Not Installed):** If detected on iOS Safari and `window.navigator.standalone !== true`, render a collapsible warm card:
  * `"📲 Install Z Catchers for Bedtime Alerts: Tap Share and select 'Add to Home Screen' to unlock push notifications."`
* **Condition 2 (Push Permission Not Granted):** If `Notification.permission !== 'granted'`, render a prominent banner with fox bell icon:
  * `"🔔 Turn on Bedtime & Nag Notifications"` button (`bg-status-amber text-night-bg font-semibold rounded-xl min-h-[44px]`).
* **Condition 3 (Subscribed & Ready):** Hide banner and display active badge in header/command bar (`"🔔 Alerts On"`).
