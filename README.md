# 🌙 Z Catchers

> A mobile-first Progressive Web App (PWA) for international Discord communities to foster bedtime accountability across timezones.

---

## 📖 Overview

**Z Catchers** solves the problem of cross-timezone sleep accountability. Because members live in different timezones, nobody knows what someone else's "11:30 PM" means without doing mental math. 

Z Catchers converts everyone's schedule into the viewer's local time, triggers automated wind-down notifications, and alerts awake community members when a friend reaches bedtime so they can "nag" them to sleep directly inside their personal Discord journal thread.

### Key Highlights
- **Cross-Timezone Visibility:** Automatically converts community bedtimes to the viewer's local timezone, grouped by who is awake, winding down, or asleep.
- **Sleep Shield Guarantee:** Awake community members are notified to nag sleepy members, but the app strictly guarantees that users within their own sleep window are never disturbed.
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
- [Master Specification & Execution Plan](./antigravity_master_spec_execution_plan.md)
- [Backend, Timezone & PWA Technical Reference](./backend_timezone_pwa_technical_spec.md)

---

## 🚀 Getting Started

*Project setup instructions will be documented here as development kicks off.*
