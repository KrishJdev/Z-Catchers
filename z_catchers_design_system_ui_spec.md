# Z Catchers: Warm Dark Design System & Component Specification (`DESIGN_SYSTEM.md`)

> **AGENT DIRECTIVE FOR ANTIGRAVITY:**
> **Z Catchers** is designed to be opened in dark bedrooms right before sleep. The interface must feel like a warm bedside lamp—calm, cozy, uncluttered, and free of harsh blue light. Follow the exact color tokens, typography rules, and component state specifications in this document.

---

## 1. Core Aesthetic Principles

1. **Zero Blue-Light Glare:** Never use pure white (`#FFFFFF`), pure black (`#000000`), or standard Tailwind blues/indigos (`blue-500`, `indigo-600`). Every background, border, and text color is tinted with warm espresso, amber, or cream undertones.
2. **Thumb-Friendly Mobile Ergonomics:** Design strictly for a $375\text{px}$ to $480\text{px}$ mobile viewport first. Center the app container (`max-w-[480px] mx-auto`) on desktop screens so it retains a focused, native app feel everywhere.
3. **Instant Scannability:** A sleepy user should be able to open the app and know within $2\text{ seconds}$:
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
| `cream-primary` | `#F5EBE1` | Primary text: Member names and converted viewer bedtime |
| `cream-secondary` | `#B0A295` | Secondary text: Sleeper's local time, timezone labels, subtitles |
| `cream-muted` | `#73675C` | Muted text: Sleeping cards, disabled buttons, helper captions |
| `amber-glow` | `#E59843` | Primary brand accent, "Winding Down" status, active nav tab |
| `coral-nag` | `#D96B52` | Urgent "Bedtime Hit / Nag Now" alert border, badge, and primary CTA |
| `sage-awake` | `#6B9E78` | Calm "Awake" status dot and Push Notification active indicator |
| `slumber-indigo` | `#5B6B94` | Muted "Sleeping / Sleep Shield Active" status badge |

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
  }
}
```

---

## 3. Typography & Numeric Rules

* **Font Stack:** Clean sans-serif (`Inter`, `Plus Jakarta Sans`, or system UI) for UI labels; monospace or `tabular-nums` for all clocks and countdowns.
* **Tabular Numerals Mandate:** Every time string (`11:30 PM`) and live countdown pill (`in 28m`, `14m ago`) **must** apply the Tailwind `tabular-nums` utility class so numbers never jitter when the live timer ticks.
* **Hierarchy Scale:**
  * **App Title:** `text-lg font-semibold tracking-tight text-cream-primary`
  * **Converted Viewer Time (Card Hero Stat):** `text-xl font-bold tabular-nums text-cream-primary`
  * **Member Username:** `text-base font-medium text-cream-primary`
  * **Sleeper Local Time / Timezone Subtext:** `text-xs tabular-nums text-cream-secondary`
  * **Status & Cooldown Pills:** `text-xs font-medium tracking-wide`

---

## 4. Mobile App Shell & Viewport Layout

```
+------------------------------------------+
| 🌙 Z Catchers        [Viewing: IST +5:30]| <- Sticky Top Header (56px)
+------------------------------------------+
| 🔔 Enable Push Alerts to nag friends [X] | <- Conditional PWA / Push Banner
+------------------------------------------+
|                                          |
| ▼ 🚨 NAG NOW (BEDTIME HIT)           (1) | <- Priority Bucket 1 (Always Expanded)
| +--------------------------------------+ |
| | Alex                    [12m past!]  | |
| | 9:00 AM your time                    | |
| | (10:30 PM EDT • America/New_York)    | |
| | [ 💬 Nag in Discord Journal ↗ ]      | | <- Full-width Coral CTA (44px tall)
| +--------------------------------------+ |
|                                          |
| ▼ 🕯️ WINDING DOWN SOON               (2) | <- Priority Bucket 2 (Always Expanded)
| +--------------------------------------+ |
| | Sam                        [in 24m]  | |
| | 11:30 PM your time                   | |
| | (11:30 PM IST • Asia/Kolkata)        | |
| | ⏳ Shifting to 12:00 AM in 31h 15m   | | <- 48h Cooldown Banner (if pending)
| | [ Check Discord Journal ↗ ]          | |
| +--------------------------------------+ |
|                                          |
| ▼ ☀️ AWAKE                           (4) | <- Priority Bucket 3 (Expanded)
|   [Compact Member Cards...]              |
|                                          |
| ▶ 🌙 SLEEPING (SLEEP SHIELD ACTIVE)  (3) | <- Priority Bucket 4 (Dimmed)
|   [Muted Member Cards...]                |
|                                          |
+------------------------------------------+
|   [ 🏠 Roster ]  [ 🕒 My Time ] [ 🛡️ Mod ] | <- Sticky Bottom Nav (64px + safe-area)
+------------------------------------------+
```

### Layout Rules:
* **Container:** `max-w-[480px] mx-auto min-h-screen bg-night-bg text-cream-primary pb-24 px-4`
* **Touch Targets:** Every interactive button, bucket toggle, and navigation tab must have a minimum height of $\ge 44\text{px}$.
* **iOS Safe Area:** Apply `pb-[env(safe-area-inset-bottom)]` to the sticky bottom navigation bar so it never collides with the iOS home indicator bar when installed as a standalone PWA.

---

## 5. Exact Component States (`MemberCard.tsx`)

The `MemberCard` component is the heart of **Z Catchers**. It must adapt its visual prominence based on the member's calculated `SleepBucket` from `sleepEngine.ts`:

### State 1: `BEDTIME_NOW` (0 to 60 mins past bedtime — Urgent Nag State)
* **Card Container:** `bg-night-surface border-2 border-status-coral/80 rounded-2xl p-4 shadow-lg`
* **Status Pill:** `bg-status-coral/20 text-status-coral border border-status-coral/40 px-2.5 py-0.5 rounded-full text-xs font-semibold animate-pulse`
  * Text: `"🚨 Bedtime hit 14m ago"`
* **Action Button:** Full-width primary button (`w-full min-h-[44px] bg-status-coral hover:bg-status-coral/90 text-night-bg font-semibold rounded-xl flex items-center justify-center gap-2 mt-3`)
  * Label: `"Nag in Discord Journal ↗"`

### State 2: `WINDING_DOWN` (1 to 60 mins before bedtime)
* **Card Container:** `bg-night-surface border border-status-amber/60 rounded-2xl p-4`
* **Status Pill:** `bg-status-amber/15 text-status-amber border border-status-amber/30 px-2.5 py-0.5 rounded-full text-xs font-medium`
  * Text: `"🕯️ Bedtime in 28m"`
* **Action Button:** Secondary warm button (`w-full min-h-[44px] bg-night-elevated hover:bg-status-amber/20 text-status-amber border border-status-amber/40 font-medium rounded-xl flex items-center justify-center gap-2 mt-3`)
  * Label: `"Say Goodnight in Journal ↗"`

### State 3: `AWAKE` (More than 60 mins before bedtime)
* **Card Container:** `bg-night-surface border border-night-border rounded-2xl p-3.5`
* **Status Pill:** `text-cream-secondary text-xs tabular-nums`
  * Text: `"☀️ in 6h 15m"`
* **Action Button:** Compact inline link button on the right or bottom (`min-h-[40px] px-3 bg-night-elevated text-cream-secondary hover:text-cream-primary rounded-lg text-xs font-medium inline-flex items-center gap-1.5`)
  * Label: `"Journal ↗"`

### State 4: `SLEEPING` (1 to 8 hours past bedtime — Sleep Shield Active)
* **Card Container:** `bg-night-surface/60 border border-night-border/60 rounded-2xl p-3.5 opacity-60 transition-opacity hover:opacity-90`
* **Status Pill:** `bg-status-slumber/15 text-status-slumber border border-status-slumber/30 px-2.5 py-0.5 rounded-full text-xs`
  * Text: `"🌙 Catching Z's • Shield Active"`
* **Action Button:** Subtle muted link (`text-cream-muted hover:text-cream-secondary text-xs inline-flex items-center gap-1`)
  * Label: `"Leave quiet note in Journal ↗"`

### State 5: Pending 48-Hour Cooldown Sub-Banner (Combinable with any state above)
Whenever `member.pending_effective_at` is in the future, render a dashed sub-banner inside the card right above the action button:
* **Banner Style:** `mt-2.5 px-3 py-1.5 rounded-lg bg-status-amber/10 border border-dashed border-status-amber/40 text-xs text-status-amber flex items-center justify-between tabular-nums`
* **Text:** `"⏳ Schedule shifting to [Pending Viewer Time] in 34h 12m"`

---

## 6. Modals, Drawers & Onboarding Banners

### 6.1 Mobile Bottom Sheet Pattern (`MyScheduleModal` & `ModDrawer`)
* On mobile viewports, modals must slide up from the bottom of the screen (`fixed inset-x-0 bottom-0 z-50 max-w-[480px] mx-auto bg-night-surface border-t border-night-border rounded-t-3xl p-5 shadow-2xl max-h-[85vh] overflow-y-auto`).
* Form inputs (`input`, `select`) must use `bg-night-elevated border border-night-border text-cream-primary rounded-xl px-3.5 py-3 text-base focus:outline-none focus:border-status-amber` (using `text-base` / $16\text{px}$ prevents iOS Safari from auto-zooming the viewport when tapping an input).

### 6.2 48-Hour Cooldown Warning Callout (Inside `MyScheduleModal`)
When a user edits their existing bedtime or timezone, display a clear callout box above the Save button:
* **Style:** `bg-status-amber/10 border border-status-amber/30 rounded-xl p-3 text-xs text-cream-secondary leading-relaxed`
* **Copy:** `"🛡️ Accountability Cooldown: Changing your bedtime or timezone takes 48 hours to take effect so nobody can dodge their bedtime at the last minute. Updating your Discord Journal link is instant."`

### 6.3 PWA & Push Permission Banner (`PwaBanner.tsx`)
* **Condition 1 (iOS Browser, Not Installed):** If detected on iOS Safari and `window.navigator.standalone !== true`, render a collapsible warm card at the top:
  * `"📲 Install Z Catchers for Bedtime Alerts: Tap the Share button below and select 'Add to Home Screen' to unlock push notifications on iOS."`
* **Condition 2 (Push Permission Not Granted):** If `Notification.permission !== 'granted'`, render a prominent one-tap bar:
  * `"🔔 Turn on Bedtime & Nag Notifications"` button (`bg-status-amber text-night-bg font-semibold rounded-xl min-h-[44px] w-full`).
* **Condition 3 (Subscribed & Ready):** Hide the banner completely and show a small sage-green status pill in the top header (`"🔔 Alerts On"`).