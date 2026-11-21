# 🌙 Z Catchers

> A mobile-first Progressive Web App (PWA) for international Discord communities to foster bedtime accountability across timezones.

---

## 📖 Overview

**Z Catchers** solves the problem of cross-timezone sleep accountability. Because members live in different timezones, nobody knows what someone else's "11:30 PM" means without doing mental math. 

Z Catchers converts everyone's schedule into the viewer's local time, triggers automated wind-down notifications, and alerts awake community members when a friend reaches bedtime so they can "nag" them to sleep directly inside their personal Discord journal thread.

### Key Highlights
- **Cross-Timezone Visibility:** Automatically converts community bedtimes to the viewer's local timezone, grouped by who is awake, winding down, or asleep.
- **Sleep Shield:** Members who stay up past bedtime can receive reminders and nags. Checking in silences alerts for that sleep cycle.
- **Direct Discord Journal Redirection:** 1-tap navigation directly into a member's Discord journal thread.
- **Anti-Cheat Governance:** 48-hour pending cooldown on schedule changes to prevent users from pushing their bedtime back late at night to avoid accountability.
- **Circadian-Friendly Palette:** Strict warm-dark, low-blue-light theme designed specifically for late-night viewing.

---

## 🛠️ Architecture & Tech Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Styling:** Tailwind CSS (Warm Dark Palette) + Lucide React icons
- **Timezone Calculations:** `luxon` (paired with strict IANA timezone identifiers)
- **Database & Auth:** Supabase / PostgreSQL (with Row Level Security)
- **Notifications:** Web Push API (`web-push`, VAPID) + Service Worker
- **Scheduler:** Cron engine evaluating bedtimes with Sleep Shield guardrails

---

## 📚 Technical Documentation & Specifications

Detailed blueprints are available in this repository:
- [Agent Rules & Guardrails](./AGENT_RULES.md)
- [Master Specification & Execution Plan](./PROJECT_SPEC.md)
- [Backend, Timezone & PWA Technical Reference](./BACKEND_TZ_PWA_SPEC.md)
- [Design System & UI Specification](./DESIGN_SYSTEM.md)

---

## 🚀 Getting Started

### Discord sign-in and push subscription rollout

For an existing database, apply the [push rotation migration](./supabase/migrations/20261121_push_subscription_rotation.sql) before deploying the Discord-only auth changes. This adds the credential digest and transactional binding function without changing existing device rows. As members launch the updated app, their service worker upgrades existing subscriptions. Monitor legacy rotation usage through the `[push-rotation] legacy_rotation` server log. Failed rotations log a reason code and can be repaired from notification settings after signing in with the Discord account that linked the device.

### Automated reminders and strikes

The same dispatcher sends wind-down reminders and evaluates missed bedtimes. It needs an authenticated request every minute, even when nobody has the app open.

1. For an existing database, apply the [weekly schedule migration](./supabase/migrations/20261113_add_weekly_schedule.sql) if those columns are missing and the [sleep-history UUID migration](./supabase/migrations/20261118_sleep_logs_member_uuid.sql) if `sleep_logs.member_id` is still text. The UUID migration stops if it finds invalid or orphan IDs so the operator can reconcile them before retrying. Then apply the [accountability migration](./supabase/migrations/20261119_dispatch_accountability.sql) followed by the [dispatcher completion migration](./supabase/migrations/20261120_cron_stage_completion.sql). Use `supabase/schema.sql` only for disposable or new databases where demo profiles are expected.
2. Configure the deployment's Supabase service role, VAPID key pair and `CRON_SECRET`. Enable personal notifications on a test member's device.
3. In Supabase, enable Cron and `pg_net`. Store the deployment's HTTPS origin as `zcatchers_app_url` and its matching `CRON_SECRET` as `zcatchers_cron_secret` in Vault. Run the schedule script once. It registers a named one-minute job and reads the token from Vault on each invocation. [Schedule script](./supabase/schedule_dispatch.sql) · [Supabase Cron setup](https://supabase.com/docs/guides/cron/quickstart)
   For a protected Vercel preview, use an isolated Supabase test database and store its Vercel automation bypass secret in the test database's Vault as `zcatchers_vercel_bypass`.
4. Verify several consecutive HTTP 200 responses at `/api/cron/dispatch-notifications` in deployment logs. At a test bedtime, verify the wind-down push on the subscribed device and the nightly record at or after +10 minutes for a missed check-in. An authenticated GET with `?dry_run=true` previews the evaluation.

The checked-in Vercel schedule runs once daily at 00:00 UTC. The GitHub Actions fallback requests a run every five minutes. Scheduled runs skip dispatch until the repository Actions secrets `APP_URL` and `CRON_SECRET` are set. Manual runs report missing secrets as errors. The actual cadence can leave entire reminder windows uncovered.
