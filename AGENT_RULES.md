# Agent Rules & Guardrails for "Z Catchers" (`AGENT_RULES.md`)

> **SYSTEM INSTRUCTION FOR ANTIGRAVITY:**
> Read this file before executing any task, creating files, or modifying code. These rules are **non-negotiable** constraints designed to prevent timezone bugs, notification spam, UI regressions, and scope creep. If any instruction in a prompt conflicts with these guardrails, halt and ask for clarification.

---

## 1. Source of Truth Hierarchy

Always cross-reference these specification documents in the root directory before writing code:
1. `PROJECT_SPEC.md` — Master product vision, phased roadmap, responsive architecture, and milestone execution order.
2. `BACKEND_TZ_PWA_SPEC.md` — Exact SQL schema, `luxon` timezone algorithms, Sleep Shield logic, and Service Worker setup.
3. `DESIGN_SYSTEM.md` — Warm Dark low-blue-light color tokens, responsive desktop + mobile PWA specifications, and Sleepy Fox mascot guidelines.

**Rule:** Never invent your own database columns, status bucket definitions, or timezone math when they are already explicitly defined in `BACKEND_TZ_PWA_SPEC.md`.

---

## 2. Strict Directory & Architecture Structure

Maintain a flat, predictable Next.js (App Router + TypeScript) project structure. Do not over-abstract or create unnecessary wrapper layers.

```text
z-catchers/
├── public/
│   ├── manifest.json          # PWA manifest (standalone, #120F0D theme, fox icon)
│   ├── sw.js                  # Service worker for Web Push & Discord deep-linking
│   └── icons/                 # Sleepy Fox app icons & notification badges
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Responsive root layout (Warm Dark bg, PWA meta tags)
│   │   ├── page.tsx           # Responsive Dashboard (Mobile PWA + Desktop Grid)
│   │   ├── globals.css        # Tailwind imports & custom Warm Dark CSS variables
│   │   └── api/
│   │       ├── members/       # GET roster, POST schedule update (48h cooldown)
│   │       ├── mod/           # POST moderator CRUD & instant cooldown approval
│   │       ├── push/          # POST subscribe/unsubscribe & test push
│   │       └── cron/          # GET/POST 1-minute notification dispatcher
│   ├── components/
│   │   ├── Header.tsx         # Fox mascot logo, live clock, shield toggle, command bar
│   │   ├── FoxMascot.tsx      # Vector Fox Mascot (logo, lantern, alert bell, sleeping den)
│   │   ├── StatusBucket.tsx   # Responsive grid (Nag Now, Winding Down, Awake, Sleeping)
│   │   ├── MemberCard.tsx     # Dual-time display, cooldown badge, Discord deep-link CTA
│   │   ├── MyScheduleModal.tsx# Self-service profile edit (dialog on desktop, sheet on mobile)
│   │   ├── ModDrawer.tsx      # Moderator controls (dialog on desktop, sheet on mobile)
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
* **REQUIRED:** Suppress community pushes during the 15 minutes before the recipient’s bedtime. After bedtime, unchecked-in members may receive personal reminders, strike alerts and nags. An open check-in silences pushes, and a completed sleep cycle remains protected through the eight-hour quiet window.
* **REQUIRED:** Every cron dispatch must log `(member_id, notification_type, local_date)` in `notification_logs` with a `UNIQUE` constraint to guarantee idempotency and prevent double-pinging users.

### 3.3 The 48-Hour Cooldown Governance Rule
* **FORBIDDEN:** Regular members (`role = 'member'`) must **never** be able to overwrite `bedtime_local` or `timezone` directly via the self-service API once their profile is created.
* **REQUIRED:** Self-service schedule changes must write to `pending_bedtime_local`, `pending_timezone`, and `pending_effective_at = NOW() + 48 hours`.
* **Role-only moderation:** Self-service uses the queue for every role. Only explicit staff actions in `/api/mod` can approve a pending change early or edit an active schedule immediately. Check the actor’s active linked Discord identity and live database role, the target’s role and, for approval, the pending schedule the staff member reviewed. Moderators can act on members, the Owner can act on members and moderators, and staff use self-service for their own schedules.
* **REQUIRED:** Updating `journal_url` or `discord_username` does **not** trigger the 48-hour cooldown and applies immediately.

### 3.4 Discord Deep-Link Sanitization
* **FORBIDDEN:** Never allow arbitrary URLs (`http://`, external phishing links, or `javascript:` URIs) in the `journal_url` field.
* **REQUIRED:** Validate all journal URLs on both client and server against:
  `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$`

---

## 4. UI, Styling & Responsive Layout Rules

1. **Strict Warm Dark Palette with Fox Accents:**
   * Never use pure white (`#FFFFFF`), harsh black (`#000000`), or default Tailwind blue (`blue-500`/`blue-600`).
   * Use deep espresso backgrounds (`#120F0D`, `#1C1714`), soft cream primary text (`#F5EBE1`), muted warm grey secondary text (`#B0A295`), warm amber accents (`#E59843`), coral alerts (`#D96B52`), and fox mascot accents (`#E07A5F` terracotta rust, `#F4A261` golden amber).

2. **True Responsive Dual-Layout (Desktop Website + Mobile PWA):**
   * **FORBIDDEN:** Never constrain the entire desktop app shell to a narrow mobile container (such as locking the layout to `max-w-md` or `max-w-[480px]`).
   * **REQUIRED Mobile View (< 768px):** Retain a single-column vertical stack, thumb-friendly bottom navigation bar (`h-16`), and slide-up bottom sheets for modals. Minimum touch target height $\ge 44\text{px}$.
   * **REQUIRED Desktop & Tablet View (≥ 768px / 1024px+):**
     * Expand the main container to `max-w-7xl mx-auto px-6 lg:px-8 py-6`.
     * Render the top navigation as a full-width Command Bar displaying the Fox logo, live local clock, viewer timezone pill, Sleep Shield toggle, and quick-action buttons (`"My Schedule"`, `"Mod Panel"`, `"Notification Settings"`).
     * Render status buckets across the full desktop width using a responsive multi-column CSS Grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4` for `MemberCard` components.
     * Render modals as centered dialogs (`max-w-lg`) with backdrop blur (`backdrop-blur-md bg-night-bg/80`).

3. **"Z Catchers" Sleepy Fox Mascot Identity:**
   * Integrate the cozy, minimalist Fox mascot into brand logo headers, contextual status banners (yawning/lantern when winding down, alert bell when bedtime hits), and empty bucket states (*"Every fox in this den is fast asleep"*).
   * Update PWA manifest icons and push notification badges to feature the Fox mascot.

4. **Zero Clutter:**
   * Do not add charts, sleep quality graphs, multi-page analytics, or noisy animations. The app is used late at night and must remain calm and legible in a dark room.

---

## 5. Anti-Bloat & Scope Creep Rules

* **Stay in Phase 1 (MVP):** Do not build Phase 2 or Phase 3 features (such as Discord bots, streak counters, or buddy watchlists) unless the user explicitly commands you to start Phase 2.
* **No Heavy Auth Dependencies:** Use the existing Discord OAuth session for member actions and live role checks for moderator access. See the cooldown governance rule for the schedule override path during the rollout.
* **Minimal Dependencies:** Only install packages that are directly required (`luxon`, `web-push`, `lucide-react`, and your DB client). Do not install heavy UI component libraries (like Material UI or Ant Design).

---

## 6. Execution & Verification Protocol

Whenever you complete a milestone from `PROJECT_SPEC.md`:
1. **Type & Build Check:** Run `tsc --noEmit` (or `npm run build`) and fix any TypeScript or bundling errors immediately.
2. **Mandatory Unit Tests:** Every feature or endpoint that is implemented **must** have corresponding automated unit tests. Run `npm run test:unit` and verify all suites pass cleanly before concluding your task or opening a PR.
3. **Timezone Sanity Check:** Verify that the seed data includes members in at least 4 distinct timezones (including `Asia/Kolkata` for half-hour UTC offsets like $\text{UTC}+5\text{:}30$) and confirm their status buckets render accurately.
4. **Responsive & Mascot Verification:** Ensure both mobile viewport (< 768px) and desktop viewport (≥ 768px) render cleanly with the Fox mascot visible and multi-column grid functioning properly.

---

## 7. Git & Branching Protocol

* **Active Working Branch:** Use `krish` for regular work.
* **Punishments Implementation Phases:** Start each phase on its specified feature branch from the latest `origin/dev` after the previous phase merges. Open one PR per phase into `dev`. Follow the [Punishments implementation plan](PUNISHMENTS_IMPLEMENTATION_PLAN.md#feature-branch-workflow) and release through `dev` → `main`.
* **Target Integration Branch:** Open pull requests from the working branch to `dev`, the repository's default branch on GitHub.
* **Production Branch:** `main` is reserved for tagged releases and production-ready deployments merged from `dev`.

---

## 8. Mandatory Handoff Protocol (`HANDOFF.md`)

* **Rule:** At the conclusion of **every single task, milestone, or user session**, the agent MUST update `HANDOFF.md` in the root directory before concluding their turn.
* **Required Handoff Content:**
  1. **Metadata & Status:** Update the timestamp, current working branch, latest commit hash, and results from `npx tsc --noEmit` and `npm run test:unit`.
  2. **Work Completed in Current Task:** Detailed, bulleted changelog of what was built, files modified/created, and issues resolved.
  3. **Task & Jira Status:** Update the Jira task/epic table showing which items are DONE, IN PROGRESS, or TODO.
  4. **Immediate Next Steps:** State clearly and specifically what the next agent or session should implement next (e.g., the exact file paths and logic required).
* **Never Skip:** An agent's turn or task is **incomplete** if `HANDOFF.md` has not been refreshed to document the current state of the repository.
