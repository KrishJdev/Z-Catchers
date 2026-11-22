# Passcode-free moderation for Z Catchers

Use the existing Discord sign-in for all moderation. Krish is the sole **Owner** and appoints **Moderators** from the existing roster. The app stores three roles in Supabase: `member`, `moderator`, and `owner`.

The current app has member and moderator roles. The drawer's **Admin** label is hard-coded. Moderator access can come from the database or `MOD_DISCORD_IDS`. Several staff APIs also accept the shared passcode, and early approvals and immediate schedule edits require it today. See [the auth helper](src/lib/auth.ts), [the moderation API](src/app/api/mod/route.ts), and [the moderator drawer](src/components/ModDrawer.tsx).

## Feature branch workflow

Submit the Phase 0 inventory from `krish` to `dev`. Phases 1–3 were integrated into `dev` through separate pull requests. Start Phase 4 on its own branch from the merged Phase 3 on `dev`. Open a pull request to `dev` and use its isolated Supabase checks as release evidence. After integration, use a separate `dev` → `main` release so the API and drawer ship together.

## Permissions

| Action | Member | Moderator | Owner |
|---|---|---|---|
| Manage own profile, schedule and sleep activity | Yes, with the standard 48-hour schedule cooldown | Same | Same |
| Approve or reject schedule requests, make immediate schedule edits, edit routine roster details, and correct check-in or wake records | — | For members | For members and moderators |
| Manage punishment tasks, dated strike corrections, and individual Metastrikes | — | For members | For members and moderators |
| Grant or revoke moderator access and deactivate or reactivate accounts | — | — | For members and moderators |
| Use webhook tests or manual digests, purge verified demo profiles, and run existing destructive or bulk correction actions | — | — | With the existing data safeguards and owner target protection |

Moderators use self-service for their own accounts and can manage regular members. The owner handles requests involving moderators. The owner's own schedule uses the normal cooldown. The site protects the owner account from role changes, deactivation, deletion and Discord relinking. Owner recovery uses an operator-controlled database procedure after confirming the linked Discord identity.

## Phase 0 · Confirm the owner and inventory current access

**Pull request** `krish` → `dev`

- Verify Krish's existing active member row against the linked Discord ID. Record the member ID and Discord ID in the rollout checklist. Review existing database moderators and current `MOD_DISCORD_IDS` entries, including allowlist-only moderators. Confirm the accounts that should carry over.
- Inventory live callers of `x-mod-passcode` and body passcode fields, including fixtures, scripts and deployments. Identify which deployments can still access the production database.
- Update [AGENTS.md](AGENTS.md), [AGENT_RULES.md](AGENT_RULES.md), [PROJECT_SPEC.md](PROJECT_SPEC.md), [BACKEND_TZ_PWA_SPEC.md](BACKEND_TZ_PWA_SPEC.md), and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) during implementation. Document the feature branch workflow for this rollout, define explicit staff actions as the schedule-override path, and retain the standard self-service cooldown.

**Exit check.** The owner identity and moderator list are verified, and the application and database cutover have a documented order.

See the [Phase 0 inventory and rollout checklist](MODERATION_ROLLOUT_CHECKLIST.md) for the verified access, deployment scope and cutover sequence.

## Phase 1 · Store the owner and support moderator assignment

**Branch** `codex/moderation-1-owner-and-roles`

- Extend `members.role` and the [Member type](src/lib/db.ts) with `owner`. Add an allowed-role constraint and a unique partial index enforcing at most one owner. Add a constraint requiring the owner row to be active and Discord-linked. Mirror the migration in [schema.sql](supabase/schema.sql).
- Prepare one operator-run bootstrap transaction using the verified member ID and Discord ID. Require a matching active profile and fail if a different owner already exists. Backfill confirmed allowlist-only moderators and preserve existing intended moderator assignments. Make re-running the same bootstrap safe.
- Add an explicit `set_moderator` action to the existing `POST /api/mod` route. A signed-in owner can promote an active, linked member or revoke moderator access. Reject role fields in generic profile updates. Allow role changes only between `member` and `moderator`.
- Use a service-role-only database function for the role change. In one transaction, verify the actor's owner role and linked identity, check the expected target role and permitted transition, update the role, and record the actor, target, old role, new role and timestamp. Return a conflict on a stale edit so the roster can refresh. Apply same-origin checks for browser mutations.

**Exit check.** Migration and API tests cover the verified owner, repeat bootstrap, second-owner rejection, existing moderator preservation, owner-only promotion and revocation, and competing edits. Attempts to grant `owner` through the website or to alter the owner account fail.

## Phase 2 · Check live roles and remove the passcode

**Branch** `codex/moderation-2-live-role-auth`

- Use the signed Discord session for identity. In [auth.ts](src/lib/auth.ts), load the current active profile and require the signed member ID and Discord ID to match the stored row. Authorize from the live database role. Derive UI permissions from `/api/auth/me` and enforce the same permissions on the server. Missing or mismatched identity and failures to verify the live role deny privileged access.
- Enforce the table above across `/api/mod`, its punishment and webhook routes, and staff access through the cancel-pending, check-in, wake-up and Metastrike routes. Resolve the target for punishment writes from the task ID server-side. Protect the owner across roster mutation and bulk actions. Check the current target role in staff write conditions or transactions so role changes cannot race with protected edits.
- Keep `/api/members/update-schedule` for own-profile updates and the 48-hour queue. Use explicit staff actions in `/api/mod` for immediate schedule edits and early approvals. Apply an approval only if the queued change still matches the request that was reviewed. Use dated corrections for routine strike changes and reserve legacy destructive or bulk paths for the owner.
- Remove the passcode verifier, passcode headers and request fields, the `verify` action, and rate-limit code dedicated to the retired passcode. Remove the runtime Discord ID allowlist once the backfill is ready. Use the database role for authorization and derive any compatibility `is_moderator` response flag from the live role. Keep scheduler and other independent credentials intact. Preserve historical `master_mod` audit rows and attribute new staff actions to the signed-in member.

**Exit check.** Unit and API tests exercise unauthenticated requests, the retired credential, each role, role changes during an existing session, and unauthorized targets. Cover the 48-hour cooldown, approval races, role injection through roster edits, and signed-in audit attribution. Replace shared-passcode test fixtures with Discord session fixtures.

## Phase 3 · Simplify the drawer and assign moderators from the roster

**Branch** `codex/moderation-3-drawer-and-roster`

- In [ModDrawer.tsx](src/components/ModDrawer.tsx), open the drawer directly for owners and moderators. Remove **Lock**, **Unlock**, both passcode inputs, and their client state and request fields. Remove the old `z_catchers_mod_passcode` session storage entry. Keep **Close** and show the current **Owner** or **Moderator** badge.
- In **Mod Panel → Roster**, show **Make moderator** on eligible members and **Remove moderator** on moderator rows, visible to the owner. Confirm the selected account and change, then refresh the row. Show owner-only roster and webhook actions where applicable. Refresh capabilities on role-related errors so an open drawer reflects a demotion.
- Keep the existing Warm Dark desktop dialog and mobile PWA sheet, with the Sleepy Fox and accessible touch targets.

**Exit check.** On desktop and mobile, the owner can promote and revoke access from the roster. The promoted moderator can approve another member's pending schedule while signed in. Revocation blocks the next privileged request in that same session.

## Phase 4 · Rehearse and release

**Branch** `codex/moderation-4-release-rehearsal`

1. Prepare the [rollout checklist](MODERATION_ROLLOUT_CHECKLIST.md) and run `npx tsc --noEmit`, `npm run test:unit`, and `npm run build` on the phase branch. Exercise the migration on fresh and existing data and test an installed PWA after updating. Verify the complete change with isolated Supabase CI on the pull request to `dev`, then release through `main`.
2. Apply the additive schema migration, pause legacy staff writes, then bootstrap the verified owner and backfill intended moderators. Switch the API and drawer together. Route staff traffic to the role-only release and retire old deployments that can still reach production.
3. Smoke-test the owner, a moderator and a member. Verify the approval queue still contains pending requests, the former passcode cannot authorize a request, and role revocation takes effect immediately. Remove `MOD_SECRET_PASSCODE` and `MOD_DISCORD_IDS` from deployment configuration.
4. If cutover fails, pause staff writes, verify the owner and moderator assignments, and use the rehearsed operator recovery and a corrected role-only release.

**Exit check.** Record the migration, sole-owner verification, and promotion, approval and revocation results in [HANDOFF.md](HANDOFF.md).
