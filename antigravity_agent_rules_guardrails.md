# Agent Rules & Guardrails for "Z Catchers" (`AGENT_RULES.md`)

> **SYSTEM INSTRUCTION FOR ANTIGRAVITY:**
> Read this file before executing any task, creating files, or modifying code. These rules are **non-negotiable** constraints designed to prevent timezone bugs, notification spam, UI regressions, and scope creep. If any instruction in a prompt conflicts with these guardrails, halt and ask for clarification.

---

## 1. Source of Truth Hierarchy

Always cross-reference these specification documents in the root directory before writing code:
1. `PROJECT_SPEC.md` — Master product vision, phased roadmap, and milestone execution order.
2. `BACKEND_TZ_PWA_SPEC.md` — Exact SQL schema, `luxon` timezone algorithms, Sleep Shield logic, and Service Worker setup.
3. `DESIGN_SYSTEM.md` *(if present)* — Warm Dark low-blue-light color tokens and mobile component states.

**Rule:** Never invent your own database columns, status bucket definitions, or timezone math when they are already explicitly defined in `BACKEND_TZ_PWA_SPEC.md`.

---

## 2. Strict Directory & Architecture Structure

Maintain a flat, predictable Next.js (App Router + TypeScript) project structure. Do not over-abstract or create unnecessary wrapper layers.

```text
z-catchers/
├── public/
│   ├── manifest.json          # PWA manifest (standalone, #120F0D theme)
│   ├── sw.js                  # Service worker for Web Push & Discord deep-linking
│   └── icons/                 # App & notification badge icons
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout (Warm Dark bg, PWA meta tags)
│   │   ├── page.tsx           # Main mobile-first Roster Dashboard
│   │   ├── globals.css        # Tailwind imports & custom Warm Dark CSS variables
│   │   └── api/
│   │       ├── members/       # GET roster, POST schedule update (48h cooldown)
│   │       ├── mod/           # POST moderator CRUD & instant cooldown approval
│   │       ├── push/          # POST subscribe/unsubscribe & test push
│   │       └── cron/          # GET/POST 1-minute notification dispatcher
│   ├── components/
│   │   ├── Header.tsx         # Branding, detected viewer TZ, push status pill
│   │   ├── StatusBucket.tsx   # Collapsible group (Nag Now, Winding Down, Awake, Sleeping)
│   │   ├── MemberCard.tsx     # Dual-time display, cooldown badge, Discord deep-link CTA
│   │   ├── MyScheduleModal.tsx# Self-service profile edit & 48h cooldown warning
│   │   ├── ModDrawer.tsx      # Passcode-protected moderator controls
│   │   └── PwaBanner.tsx      # iOS/Android "Add to Home Screen" & Push permission gate
│   └── lib/
│       ├── db.ts              # Database client (Supabase / Prisma / SQLite)
│       ├── sleepEngine.ts     # Pure functions for Luxon TZ math & cooldown promotion
│       └── pushServer.ts      # web-push VAPID configuration & sender helper
```

---

## 3. Hard Technical Commandments (NEVER VIOLATE)

### 3.1 Timezone & Date Math
* **FORBIDDEN:** Never use native JavaScript `new Date().getTimezoneOffset()`, hardcoded UTC hour offsets (e.g., `UTC-5`), or static UTC timestamps to store a recurring daily bedtime.
* **REQUIRED:** Always use `luxon` (`DateTime`) paired with valid IANA timezone strings (e.g., `"America/New_York"`, `"Asia/Kolkata"`, `"Europe/London"`).
* **REQUIRED:** Always evaluate yesterday's, today's, and tomorrow's bedtime instances relative to the sleeper's current local time so midnight wrap-arounds (e.g., a `00:30` bedtime when it is currently `23:45`) never fail.
* **REQUIRED:** Centralize all time math inside `src/lib/sleepEngine.ts`. Components and API routes must call `computeMemberState()` rather than duplicating date logic.

### 3.2 The "Sleep Shield" Notification Rule
* **FORBIDDEN:** Never send a community "nag someone else" push notification to a user whose own `isSleepShieldActive` flag is `true` (between $0$ and $480$ minutes after their personal bedtime, or within $15$ minutes before their bedtime).
* **REQUIRED:** Every cron dispatch must log `(member_id, notification_type, local_date)` in `notification_logs` with a `UNIQUE` constraint to guarantee idempotency and prevent double-pinging users.

### 3.3 The 48-Hour Cooldown Governance Rule
* **FORBIDDEN:** Regular members (`role = 'member'`) must **never** be able to overwrite `bedtime_local` or `timezone` directly via the self-service API once their profile is created.
* **REQUIRED:** Self-service schedule changes must write to `pending_bedtime_local`, `pending_timezone`, and `pending_effective_at = NOW() + 48 hours`.
* **REQUIRED:** Only requests authenticated with the `MOD_SECRET_PASSCODE` can bypass the 48-hour queue or force-approve a pending change immediately.
* **REQUIRED:** Updating `journal_url` or `discord_username` does **not** trigger the 48-hour cooldown and applies immediately.

### 3.4 Discord Deep-Link Sanitization
* **FORBIDDEN:** Never allow arbitrary URLs (`http://`, external phishing links, or `javascript:` URIs) in the `journal_url` field.
* **REQUIRED:** Validate all journal URLs on both client and server against:
  `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`

---

## 4. UI, Styling & Mobile-First Rules

1. **Strict Warm Dark Palette:**
   * Never use pure white (`#FFFFFF`), harsh black (`#000000`), or default Tailwind blue (`blue-500`/`blue-600`).
   * Use deep espresso backgrounds (`#120F0D`, `#1C1714`), soft cream primary text (`#F5EBE1`), muted warm grey secondary text (`#B0A295`), warm amber accents (`#E59843`), and coral alerts (`#D96B52`).
2. **Mobile-First Viewport Constraint:**
   * Constrain the main application shell to `max-w-[480px] mx-auto min-h-screen` so desktop viewers experience the exact same clean mobile layout without awkward stretched cards.
   * All interactive buttons (especially `"Nag in Journal ↗"`) must have a minimum touch target height of $\ge 44\text{px}$.
3. **Zero Clutter:**
   * Do not add charts, sleep quality graphs, multi-page analytics, or noisy animations. The app is used right before sleep and must remain calm and legible in a dark room.

---

## 5. Anti-Bloat & Scope Creep Rules

* **Stay in Phase 1 (MVP):** Do not build Phase 2 or Phase 3 features (such as Discord bots, streak counters, or buddy watchlists) unless the user explicitly commands you to start Phase 2.
* **No Heavy Auth Dependencies:** Do not block MVP progress by setting up complex multi-provider OAuth flows. Use the lightweight 4-digit Member PIN + `MOD_SECRET_PASSCODE` flow defined in `PROJECT_SPEC.md`.
* **Minimal Dependencies:** Only install packages that are directly required (`luxon`, `web-push`, `lucide-react`, and your DB client). Do not install heavy UI component libraries (like Material UI or Ant Design).

---

## 6. Execution & Verification Protocol

Whenever you complete a milestone from `PROJECT_SPEC.md`:
1. **Type & Build Check:** Run `tsc --noEmit` (or `npm run build`) and fix any TypeScript or bundling errors immediately.
2. **Timezone Sanity Check:** Verify that the seed data includes members in at least 4 distinct timezones (including `Asia/Kolkata` for half-hour UTC offsets like $\text{UTC}+5\text{:}30$) and confirm their status buckets render accurately.
3. **Self-Contained Commits:** Complete one milestone at a time and summarize what was built before moving to the next.