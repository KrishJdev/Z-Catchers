# Z Catchers mobile PWA and desktop UI refresh

Bring the first actionable roster card higher on phones, make moderation easier to scan, and give member profiles and My Sleep clearer entry points. Keep the Warm Dark palette and Sleepy Fox. **Overdue, Winding Down, Awake, and Sleeping are all part of the refreshed roster.** The compact header replaces the separate fox summary card above the filters.

The design review covered the signed-in production site at 390 px and at desktop widths. Component references below use the reviewed `origin/dev` snapshot at `24a2e54`. Check the latest merged code when starting each phase, especially the moderator strike tools and shared calendars.

## Feature branch workflow

| Phase | Feature branch | Outcome |
| --- | --- | --- |
| [1. Roster dashboard and navigation](#phase-1---roster-dashboard-and-navigation) | `codex/ui-1-roster-dashboard` | Compact opening screen and unified mobile check-in and navigation |
| [2. Member cards](#phase-2---member-cards) | `codex/ui-2-member-cards` | Scannable time and action in every roster state |
| [3. Moderator drawer](#phase-3---moderator-drawer) | `codex/ui-3-moderator-drawer` | Searchable roster and focused member editing |
| [4. Profiles and My Sleep](#phase-4---profiles-and-my-sleep) | `codex/ui-4-profiles-my-sleep` | Clear member identity, sleep tools, and account settings |

1. Fetch `origin` when starting each phase. Create its feature branch from the latest `origin/dev` after the previous phase merges. Work from a clean checkout or a separate worktree so the local `krish` changes stay independent. For a clean checkout, the first branch starts with `git switch -c codex/ui-1-roster-dashboard origin/dev` after `git fetch origin`.
2. Open one PR per phase into `dev`. Include phone and desktop before-and-after evidence, feature and regression checks, and the phase's `DESIGN_SYSTEM.md` updates. Include this plan in Phase 1 if it has yet to land in `dev`. Record the result and next branch in `HANDOFF.md`.
3. Review Phases 1 and 2 separately in `dev` and include both in the same planned production release. Follow the existing `dev` to `main` release flow for deployment. Keep this refresh limited to presentation and interaction using the current APIs. Schedule rules, Sleep Shield behavior, access checks, ledger writes, and notification delivery stay governed by the existing code.

## Shared design and verification

- Use the existing espresso and cream tokens. Use `text-cream-secondary` for metadata people need to read and reserve muted styling for genuinely secondary or disabled elements. Use filled amber for the main action, coral for overdue urgency or destructive actions, and quieter surfaces for other statuses. Prefer spacing or a divider to a nested bordered panel. Use tabular numerals for times and durations.
- Keep important copy around 14 px on phones and emphasize times with larger type. Give touch controls at least 44 × 44 px of hit area, visible keyboard focus, and accessible labels for icon controls. Apply safe-area padding only once per edge. Keep sheets at a keyboard-safe dynamic viewport height and let content scroll behind persistent sheet headers or action footers. Use the existing dialogs and respect reduced motion.
- Run `npx tsc --noEmit`, `npm run test:unit`, and `npm run build` in every implementation branch. Extend the existing suites for behaviors that change. Cross-check the phase in a preview with seeded accounts and save before-and-after screenshots at 390 px and 1440 px. Exercise 360, 430, 768, and 1024 px for overflow, stacking, and layout transitions. Use long display names, different viewer and member timezones, empty and populated lists, and failed reads.
- Verify the home indicator, resume, keyboard and sheet close behavior on installed iOS and Android PWAs before calling those device flows verified. Browser-width checks cover responsive layout and should be recorded separately. Use preview fixtures for writes and role coverage.
- Re-run the baseline checks on a fresh `origin/dev` checkout before Phase 1. The earlier `krish` run passed type checking and 50 of 51 suites. Its punishment API suite received a 503 when the local HTTP database fixture fetch failed. If the local fixture remains unavailable, reproduce in hosted CI and record the actual result.

## Phase 1 - Roster dashboard and navigation

**Edit** `src/app/page.tsx`, `Header.tsx`, `StatusBucket.tsx`, `PinnedSelfActionBar.tsx`, and `BottomNav.tsx` under `src/components/` where applicable.

1. Remove the separate large Roster summary card. Put a small fox beside **Roster** and show one community summary such as **3 friends past bedtime**, **2 winding down**, or **The den is quiet**. Use the same filtered status collection as the visible list so the summary makes sense in Starred. Keep the personal bedtime in the check-in area.
2. Place a compact **All / Starred** segmented filter directly above the list. Preserve the saved stars and the existing way to return to All from an empty Starred view. Keep the header's timezone, notifications, and profile controls. Retain the existing conditional install, notification, offline, and retry prompts.
3. Keep the four sections in this order with their own counts and disclosure controls. **Overdue**, **Winding Down**, **Awake**, **Sleeping**. Preserve current empty-section behavior, sorting, default expansion, and saved disclosure preferences. Shorten the overdue heading and remove redundant decorative framing around counts.
4. On phones, put the personal check-in strip and bottom navigation inside one fixed container. Keep one compact status line and one primary action for the current state. Allow manual wake and undo controls to wrap under the primary action when needed. Account for the actual footer height so the final roster item remains reachable in every state. Keep the staff-only Mod tab.
5. On desktop, show the same personal check-in controls in a contained panel beside the roster summary. Keep the top command bar and wide grid. Use one check-in instance so resizing does not reset a manual wake draft or interrupt the current request. Preserve the existing in-bed, wake, manual time, undo, back-to-bed, stale cycle, and error flows.

**Acceptance**

- At 390 px with a mixed roster and no contextual banner, the first actionable card appears higher than in the baseline. The top and bottom areas show the personal countdown once. All four buckets still render when populated, and filters and expansion work after reload.
- One-tap check-in and wake work from the phone footer. Manual wake and undo remain discoverable. The last roster action is clear of the footer at narrow widths and with the maximum set of controls.
- At 1440 px the grid has no fixed check-in band. Verify open manual wake, error and retry, offline roster retry, and active navigation state at the breakpoint.
- Extend `scripts/test-pinned-self-action-bar.mjs`, `test-smart-status-bucket-folding.mjs`, and the existing mobile touch and PWA robustness suites as needed.

## Phase 2 - Member cards

**Edit** `src/components/MemberCard.tsx` and the roster grid in `StatusBucket.tsx` if sizing requires it. Reuse the existing details sheet and card handlers.

1. Use the avatar and name as one visible profile target. Keep the star easy to reach and keep the Details trigger explicitly labeled. Give the converted bedtime one clear label such as **12:00 AM your time**. Use compact text for the state or countdown and put the member-local schedule in Details. Long names must leave room for time and controls.
2. Use the following visible action hierarchy. Keep the existing eligibility rules and labels for exceptional states, including grace periods and previously opened journals.

| Roster state | Visual treatment | Visible entry point |
| --- | --- | --- |
| Overdue | Coral status and a filled primary action | **Nag in Journal** |
| Winding Down | Warm status text and an outlined action | **Say Goodnight** |
| Awake | Compact neutral row or card | **Journal** |
| Sleeping | Compact neutral row or card with readable sleep status | **Quiet Note** |
| Your card | Same time and status layout with a quiet **You** indicator | **Details** and the appropriate journal action. The shared check-in area carries the primary sleep action. |

3. Move streaks, role and accountability badges, assist details, pending schedule changes, and secondary actions into Details where their current visibility rules allow. Keep self-only punishment access through the card's Details and My Sleep. Keep the existing moderator capability checks on any staff action available in Details.
4. On desktop, align avatar and name, time and state, then actions across each row. Use consistent action positioning so a long name or a self-only detail cannot inflate peer cards. Keep the existing responsive multi-column grid with a compact treatment for Awake and Sleeping.

**Acceptance**

- All four peer states and the viewer's card fit at 360 and 390 px with readable names, time labels, and buttons. Discord actions open the same journal destinations with the same assist and nag behavior. Star toggling, profile navigation, and Details work by touch and keyboard with focus restored on close.
- Verify differing viewer and member timezones, bedtime after midnight, long labels, grace and already-nagged states, pending schedules, sleeping shield states, and private punishment visibility. Compare clean and worst-case desktop grid rows.
- Extend `scripts/test-compact-member-cards.mjs` and `test-ui-normalization-and-button-wrapping.mjs`. Run the existing Discord assist and wake regression suites.

## Phase 3 - Moderator drawer

**Edit** `src/components/ModDrawer.tsx`, `ModeratorStrikeReview.tsx`, and `RosterRoleAction.tsx`. Reuse `ModeratorPunishmentQueue.tsx`, `ModeratorMetastrikeQueue.tsx`, and `ResponsiveDialog.tsx` for their existing workflows.

1. Keep the drawer title, role badge, close control, and four current tabs visible near the top. Keep Owner-only Advanced access within the drawer chrome. Use one vertically scrolling content area on phones and a persistent header. Show counts only when they describe the corresponding queue or list.
2. Under **Roster**, show one compact searchable row with avatar, display name, role or active status, and a short accountability summary where permitted. Select a member to show the existing actions in a detail view. On phones, use a dedicated detail screen inside the sheet with a back control. Preserve the search, scroll position, and focus on return. On wide desktops, let the roster and selected member sit side by side in the dialog. Use the single-pane view at narrower widths where the forms need the room.
3. In member detail, group the current controls under **Schedule**, **Accountability**, and **Account access**. Keep the dated strike review, pass controls, journal, schedule and check-in overrides, and Owner-only role and active-state actions behind their existing target permissions. Keep explicit confirmation and member context for role and destructive actions. Clear or close an active form if its member disappears or the actor loses the required access.
4. Under **Approvals**, show **Current** and **Requested** bedtime and wake time with the relevant timezone. Compare actual changed days for custom schedules, show the effective date or remaining time, and keep approve and reject actions visible. Stack labeled values when a two-column layout becomes too narrow. Preserve retry, write feedback, and queue refresh behavior. Give Punishments and Metastrikes the same heading, spacing, loading, error, and empty-state treatment while reusing their existing form and review components.

**Acceptance**

- More than one member row can be scanned at first glance in a populated 390 px drawer. Search, open, edit, and back retain the selected member context. A long display name or open keyboard leaves the active control reachable. Desktop selection keeps the list visible in the wide layout.
- Verify Member, Moderator, and Owner access, including staff attempts on themselves and restricted targets. Cover role changes during an open detail, dated strike edits, approval for custom schedules, and the Punishments, Metastrikes, and Advanced states exposed by the preview.
- Extend `scripts/test-moderation-drawer.mjs`. Run `test-moderation-live-roles.mjs`, `test-moderation-owner-and-roles.mjs`, `test-punishment-screens.mjs`, and `test-reviewed-metastrikes.mjs` with fixtures appropriate to the current rollout flags.

## Phase 4 - Profiles and My Sleep

**Edit** `src/components/SleepCalendarModal.tsx`, `MyScheduleModal.tsx`, `StrikeHistory.tsx`, `PunishmentList.tsx`, and their entry points in the dashboard as needed.

1. **Member profile.** Put avatar, name, current sleep status, and local time in a compact identity header. Keep a labeled **Open journal** link and the star action on mobile. Use short **Calendar** and **Schedule** tabs and keep the shared calendar view scoped to the data it already exposes.
2. **My Sleep.** Start with a compact **Tonight** area with the resolved bedtime and wake time, then **Calendar**, **Schedule**, and **Punishments**. Map the shortened Schedule label to the existing timetable view. Keep the direct Punishments entry from the roster. Put the private Metastrike action and history near the relevant calendar details, with the existing access and cycle-selection behavior.
3. **Calendar.** Put the month switcher directly above the grid. Keep monthly stats as a compact summary near the calendar, below it on phones when they would push dates below the fold. Give selected day, today, and sleep or strike markers different visual treatments and accessible names. Show the selected night's details immediately beneath the grid on phones and beside it on sufficiently wide desktops. Preserve month navigation, date anchoring, wake edits, and recorded strike details where allowed.
4. **Account settings.** Keep the top avatar as the entry point. Label the sheet **Account settings** and show the account identity with **Edit profile**, **Sleep schedule**, and **Sign out**. Keep pending schedule status beside the schedule entry. Reuse the existing editor and confirmation behavior. Keep monthly punishment progress distinct from open punishments and completed history. Use deadline labels only if the reviewed baseline already exposes deadline data.

**Acceptance**

- From the roster, a member can open another profile and its journal, reach their own My Sleep and punishment list, and reach editing from account settings. The active tab and selected calendar day stay clear at 360 px. Selecting a day makes the associated details easy to find at phone and desktop widths.
- Verify self and shared calendar access, month change, no sleep logs, late or missed check-ins, dated strike events, pending schedules, wake edit error and retry, and open punishments from an earlier month. Existing permissions determine what each viewer can see.
- Extend `scripts/test-member-profile-and-overflow-fix.mjs`, `test-profile-and-schedule-tab.mjs`, and `test-private-strike-history.mjs` where behavior changes. Run existing sleep-history, wake-up, and punishment screen checks. Complete a final cross-screen pass for spacing, typography, button emphasis, and focus across the roster, Mod, and My Sleep.
