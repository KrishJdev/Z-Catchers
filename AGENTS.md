# Multi-Agent Directives: Z Catchers (`AGENTS.md`)

> **CRITICAL DIRECTIVE FOR ALL AI AGENTS & CODING ASSISTANTS:**  
> This file defines the core operating principles, guardrails, and handoff protocols for working on the **Z Catchers** codebase.  
> Detailed technical guardrails are codified in [`AGENT_RULES.md`](./AGENT_RULES.md). Always cross-reference [`PROJECT_SPEC.md`](./PROJECT_SPEC.md), [`BACKEND_TZ_PWA_SPEC.md`](./BACKEND_TZ_PWA_SPEC.md), and [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md).

---

## 1. Golden Operating Rules

1. **Active Branch:** Work on and commit to **`krish`** by default. Start each Punishments implementation phase on its own feature branch from the latest `origin/dev` and open a separate PR into `dev` following the [Punishments feature branch workflow](PUNISHMENTS_IMPLEMENTATION_PLAN.md#feature-branch-workflow). Never commit directly to `dev` or `main`.
2. **Timezone Math:** Always use `luxon`. Never use native JavaScript `new Date().getTimezoneOffset()` or manual offset math.
3. **48-Hour Cooldown:** Self-service schedule changes for every role enter a 48-hour pending state. Early approval and immediate edits use explicit, server-authorized staff actions in `/api/mod` with target role checks.
4. **Sleep Shield:** Members who have not checked in may receive personal notifications and nags after bedtime. Suppress pushes for open check-ins and for members who have slept during the eight-hour sleep window. The 15-minute pre-bedtime community quiet period still applies.
5. **Discord URL Sanitization:** Enforce the regex `^https:\/\/(ptb\.|canary\.)?discord\.com\/channels\/\d+\/\d+(\/\d+)?$` for all journal links.
6. **Warm Dark UI:** Strictly adhere to the Warm Dark low-blue-light design system (`#120F0D` background, `#F5EBE1` text) and include the Sleepy Fox mascot.
7. **Mandatory Unit Tests:** Every feature that is implemented **must** have corresponding automated unit tests. Never consider a feature complete or merge-ready without automated test coverage (`npm run test:unit` must pass cleanly).

---

## 2. Mandatory Handoff Protocol (`HANDOFF.md`)

> [!IMPORTANT]
> **RECORD IN HANDOFF AFTER EACH TASK:**  
> At the conclusion of **every single task, milestone, or user session**, the active agent **MUST** update [`HANDOFF.md`](./HANDOFF.md) in the project root before finishing the turn.

### What Must Be Updated in `HANDOFF.md`:
1. **Header Metadata:**
   * Update the `Last Updated` ISO timestamp.
   * Verify and record the active working branch (`krish` or the current moderation phase branch).
   * Record the latest commit hash and verification check results (`npx tsc --noEmit` and `npm run test:unit`).
2. **Task Changelog:**
   * Summarize what was accomplished during the current task.
   * List all files created, modified, or deleted.
3. **Task & Milestone Table:**
   * Update the status (DONE, IN PROGRESS, TODO) of any affected Jira tasks or implementation milestones.
4. **Immediate Next Steps:**
   * Detail exactly what the incoming agent or next developer should build next, including relevant spec sections, endpoints, or UI components.

---

## 3. Specification Hierarchy

Before creating files or modifying code, verify requirements across:
1. [`AGENT_RULES.md`](./AGENT_RULES.md) — Non-negotiable technical commandments, git protocols, and directory rules.
2. [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) — Master product vision, feature requirements, and phased roadmap.
3. [`BACKEND_TZ_PWA_SPEC.md`](./BACKEND_TZ_PWA_SPEC.md) — SQL schema, timezone conversion algorithms, and push architecture.
4. [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — Color tokens, typography, mascot guidelines, and responsive layout rules.
5. [`HANDOFF.md`](./HANDOFF.md) — Real-time progress tracker and current state of development.
