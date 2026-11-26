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
| **Winding Down** | Fox holding a warm glowing lantern | Small mascot next to the Roster heading when friends are winding down |
| **Overdue** | Alert fox ringing a tiny brass bell | Small mascot next to the Roster heading when friends are past bedtime |
| **Quiet den** | Curled-up sleeping fox with floating `"Zzz"` | Quiet roster summary or the Sleeping empty state |

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
* **Header:** Compact 56px sticky bar showing the Fox logo, detected local timezone, notification settings bell, and signed-in profile avatar.
* **Roster intro:** Pair a 32 px Sleepy Fox with the Roster heading and one line of community status. Count friends within the selected All or Starred view. Give the compact segmented filter 44 px targets and put it immediately above the four sections. The selected filter and each section's disclosure state persist for the browser session.
* **Status Buckets:** Show Overdue, Winding Down, Awake, and Sleeping in order. Use plain tabular counts and 44 px disclosure rows above full-width `MemberCard` components. Actionable sections open by default, and Awake and Sleeping start folded.
* **Shared Footer:** Use one fixed, blurred espresso surface for the check-in strip and 64 px navigation row. Show a compact personal status and use filled amber for the primary action. Manual wake time and undo sit on a wrapping row below it. The footer applies bottom safe-area padding once. Reserve its measured height plus the roster's bottom gap so the last card's controls can scroll into view. The Mod entry appears only for effective moderators.

### 4.2 Desktop & Tablet Website View (≥ 768px / 1024px+)
On wider viewports, Z Catchers transforms into a spacious, multi-column community dashboard:
* **Container:** `max-w-7xl mx-auto px-6 lg:px-8 py-6` to utilize wide monitors cleanly without awkward stretching.
* **Top Header / Command Bar:**
  * Left: Fox mascot SVG logo + "Z Catchers" brand wordmark.
  * Center: Live local digital clock (`tabular-nums`) with viewer's timezone string and a read-only Sleep Shield status.
  * Right: Desktop quick-action navigation buttons:
    * **My Sleep** opens the Tonight summary and the Calendar, Schedule, and Punishments views.
    * **Mod Panel** opens the moderator drawer for effective moderators.
    * The bell opens Notification settings and reflects this device’s push status. The adjacent avatar opens Account settings, with Edit profile, Sleep schedule, and Sign out.
* **Check-in panel:** At 768 px and up, place the same check-in instance next to the roster intro in a bordered panel. Hide the mobile navigation and let the page scroll naturally. An open manual wake draft stays mounted as the layout changes.
* **Status Buckets & Multi-Column Member Grid:**
  * Status sections expand across the full container width.
  * Member cards render inside a responsive CSS Grid:
    `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`
  * Empty buckets render a peaceful den state: a curled sleeping fox with the message *"Every fox in this den is fast asleep."*

---

## 5. Roster member cards

Use two aligned rows in the existing mobile list and responsive desktop grid. The first row holds one profile button containing the avatar and display name, the converted bedtime labeled **your time**, and a separate star toggle. Truncate long display names while keeping the whole name available to assistive technology. Show **You** beneath the viewer's name. The second row aligns the status, journal link, and labeled **Details** button across the grid. Set times and countdowns in tabular numerals.

| Roster state | Status | Journal action |
| --- | --- | --- |
| Overdue | Coral minutes overdue or time left in grace | Filled coral **Nag in Journal** |
| Winding Down | Warm countdown | Outlined amber **Say Goodnight** |
| Awake | Cream secondary **Awake** on a neutral surface | **Journal** |
| Sleeping | Cream secondary **Sleeping** or **In bed** on a neutral surface | **Quiet Note** |
| Your card | Same state and time with a quiet **You** label | **Journal**, or **Quiet Note** while sleeping |

Keep the existing journal reopen labels after a recorded assist. Allow the text to wrap at narrow card widths. Use targets of at least 44 × 44 px and visible keyboard focus. The shared check-in area carries the primary sleep action at every width.

### Member details

Open the existing bottom sheet on phones and use a centered dialog on desktop. Keep the close control visible while the body scrolls within a dynamic viewport height. Restore focus to **Details** on close. Show the member's local bedtime, wake time, and timezone together. Place any pending schedule, streak, role, accountability information, assist count, and secondary controls below according to their existing visibility rules.

Show **Punishments** and its open count only in the viewer's own Details when the data is available. My Sleep also links to the authenticated task list. Show monthly strike and Metastrike balances in Details using rust and amber. In My Sleep, show three punishment progress segments with a separate label such as **1 of 3 toward your next punishment**.

Keep **Grace**, **Strike Issued**, **Protected by Metastrike**, and any eligible nag controls in Details. The viewer can request a Metastrike from Details or My Sleep when available. Staff strike review stays in the Mod Panel with its existing target permissions.

---

## 6. Modals, Drawers & Dialog Architecture

### 6.1 Responsive Modal Dual-Pattern
* **Mobile View (< 768px):** Slide-up bottom sheet (`fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto bg-night-surface border-t border-night-border rounded-t-3xl p-5 shadow-2xl max-h-[85vh] overflow-y-auto`).
* **Desktop View (≥ 768px):** Centered dialog modal (`fixed inset-0 z-50 flex items-center justify-center p-4 bg-night-bg/80 backdrop-blur-md` with inner dialog `w-full max-w-lg bg-night-surface border border-night-border rounded-2xl p-6 shadow-2xl`).

### 6.2 48-Hour Cooldown Warning Callout (Inside `MyScheduleModal`)

The **Account settings** sheet starts with the account avatar, display name, and Discord handle when available. Use full-width rows for **Edit profile** and **Sleep schedule**, with the effective date of a pending change beside the schedule. Use coral for **Sign out**.
When a user edits their existing bedtime or timezone, display a clear callout box above the Save button:
* **Style:** `bg-status-amber/10 border border-status-amber/30 rounded-xl p-3 text-xs text-cream-secondary leading-relaxed`
* **Copy:** `"🛡️ Accountability Cooldown: Changing your bedtime or timezone takes 48 hours to take effect so nobody can dodge their bedtime at the last minute. Updating your Discord Journal link is instant."`

The same callout applies to every role. Show immediate edits and early approval as explicit actions in **Mod Panel** for eligible targets.

### Mod Panel after the moderation cutover

Show the Mod entry for signed-in Owners and Moderators based on current server permissions. Open the Warm Dark desktop dialog or mobile sheet directly, with the **Owner** or **Moderator** badge, **Close**, the Sleepy Fox and touch targets of at least 44 px.

Keep **Approvals**, **Roster**, **Punishments**, and **Metastrikes** in the persistent drawer header. Place **Advanced** alongside Close for the Owner. On phones, use a single content scroller and size the sheet to the visible viewport when the keyboard opens.

In **Roster**, use compact searchable rows with an avatar, name, role, and available strike summary. At 1280 px and wider, show the list and member details side by side. At narrower widths, open the detail as a separate view inside the drawer and restore the roster's search, scroll, and keyboard focus on return.

Group detail controls under **Schedule**, **Accountability**, and **Account access**. Show the member's name in confirmations for role changes and destructive actions. Keep write controls behind their existing permissions and close an editor if its target disappears or its permission is revoked.

In **Approvals**, pair the current and requested bedtime and wake time with their local timezones and show the effective date. Compare the scheduled nights that change and wrap the two labeled columns when space is tight. Give Punishments and Metastrikes matching queue headings, spacing, and read states.

Show **Edit strikes** according to the roster row's `can_review_strikes` capability. The Owner sees it on every profile, including their own. A Moderator sees it on every other profile.

### 6.3 PWA & Push Permission Banner (`PwaBanner.tsx`)
* **Condition 1 (iOS Browser, Not Installed):** If detected on iOS Safari and `window.navigator.standalone !== true`, render a collapsible warm card:
  * `"📲 Install Z Catchers for Bedtime Alerts: Tap Share and select 'Add to Home Screen' to unlock push notifications."`
* **Condition 2 (Push Permission Not Granted):** If `Notification.permission !== 'granted'`, render a prominent banner with fox bell icon:
  * `"🔔 Turn on Bedtime & Nag Notifications"` button (`bg-status-amber text-night-bg font-semibold rounded-xl min-h-[44px]`).
* **Condition 3 (Subscribed & Ready):** Hide banner and display active badge in header/command bar (`"🔔 Alerts On"`).

### 6.4 Reviewed Metastrikes

Use a centered Warm Dark dialog on desktop and a scrollable bottom sheet with safe-area padding on mobile. Keep the Sleepy Fox and 44 px controls. The date picker labels unavailable nights and shows the selected month's used, reserved and remaining slots. Put validation beside the reason field and confirm that the request was sent for review.

In My Sleep, show the calendar month's requests with a text status, private reason and any decision explanation. Offer withdrawal on pending requests. Shared views use **Protected by Metastrike**.

In the Mod Panel, show pending count, oldest requests first and recent decisions. Show the member, cycle, reason, submission time, applicable strike and monthly quota in each pending row. Confirm approval and require an explanation for decline. Show the hold in the member and staff task lists, where it pauses assignment or completion.

### 6.5 Member profiles and My Sleep

- A member profile starts with the avatar, display name, current roster status, and local clock. Keep **Open journal** visible on phones and give the star control a 44 px touch target with a pressed state. Use **Calendar** and **Schedule** view labels.
- My Sleep begins with **Tonight** and the active cycle's resolved bedtime and wake time. Add **Punishments** to the view switcher. Put the private Metastrike request beside the selected night and the recorded and request histories below the calendar. Keep monthly progress, open punishments, and completed history in distinct sections. Display supplied deadlines on assigned tasks.
- Place the month switcher above the weekday headings. Outline the selected day in amber, highlight the local current date with a filled numeral, and use a dot for sleep status with a rust lightning bolt for strikes and an amber shield for Metastrikes. Include the sleep and ledger status in the date button's accessible label.
- Place selected-night details immediately after the grid on phones and beside the grid from 1024 px. Date selection brings focus to the details. Keep monthly statistics beneath the grid and use readable secondary text for recorded and target times. Keep the issuance time, timezone, source, and counting status in the selected night's strike details. Give strike history its own retry control.
