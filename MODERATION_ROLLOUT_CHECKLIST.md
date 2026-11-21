# Moderation rollout checklist

## Phase 0 access inventory

Reviewed on 2026-11-22 against the production release from PR #104 and the matching `dev` source.

- [x] Matched Krish’s signed-in production Discord profile with its active Supabase member row. The row has database role `member` and effective moderator access through the Discord allowlist. Krish is the designated Owner.
- [x] Queried the roster for database moderators. There were zero rows with `role = 'moderator'`. The local allowlist contained only the verified owner.
- [x] Krish confirmed the production `MOD_DISCORD_IDS` contains only his account and approved zero Moderator carryovers. The verified active row is the only bootstrap target.

The private operator copy in the shared Git directory (`git rev-parse --path-format=absolute --git-common-dir`, file `moderation-phase-0-private.md`) contains the verified member UUID, Discord ID and operator confirmation. Use those IDs together in the Phase 1 bootstrap. Record deployment details there or in the private operator record.

## Phase 1 owner bootstrap

1. Apply [the role migration](supabase/migrations/20261126_moderation_owner_and_roles.sql). It supports the three roles, protects the single active Discord-linked Owner, and installs the service-role assignment function and its audit table.
2. Follow the cutover prerequisites below before running [the operator transaction](supabase/bootstrap_moderation_owner.sql) as the database owner. Fill in both verified IDs in a private copy. For this rollout, the approved moderator list is empty. The prepared copy is `moderation-phase-1-bootstrap.sql` in the directory printed by `git rev-parse --path-format=absolute --git-common-dir`.
3. Confirm the sole active Owner matches both IDs, the existing Moderator assignments match the approved inventory, and the pending queue matches the pre-cutover snapshot. An identical bootstrap retry leaves the roster unchanged, including moderator changes made after the first successful run. A different or unverified owner causes the transaction to fail.

The database trigger blocks changes to the Owner's role, active state, member ID and Discord link, and blocks deletion. Any recovery must be coordinated with paused staff writes and a verified replacement identity. Rehearse that operator procedure in Phase 4 before the production cutover.

### Shared-passcode callers before Phase 2

This table records the legacy paths that must be retired during cutover.

| Route | Legacy credential | Caller and use |
|---|---|---|
| `GET /api/mod` | `x-mod-passcode` | [ModDrawer](src/components/ModDrawer.tsx) roster and pending queue reads. |
| `POST /api/mod` | `mod_passcode` or `x-mod-passcode` | ModDrawer unlock (`verify`), early approval, cancel pending, edit member, adjust strikes, clear nightly logs, toggle active and purge demo profiles. The API also supports legacy deletion. |
| `GET /api/mod/webhook` | `x-mod-passcode` | ModDrawer webhook status. |
| `POST /api/mod/webhook` | `passcode` or `x-mod-passcode` | ModDrawer test and manual digest. The API also supports webhook URL validation. |
| `GET /api/mod/punishments` | `x-mod-passcode` | [ModeratorPunishmentQueue](src/components/ModeratorPunishmentQueue.tsx) initial and paginated reads. The route also reads task detail. |
| `POST /api/mod/punishments` | `x-mod-passcode` or `mod_passcode` | ModeratorPunishmentQueue assign, edit and complete. The API also accepts dated strike corrections. |
| `POST /api/members/in-bed` | `x-mod-passcode` | ModDrawer uses the header to cancel a member’s check-in. Member actions use the profile’s session. |
| `POST /api/members/wake-up` | `x-mod-passcode` | Staff compatibility accepted by the route. The repository’s own-profile callers use Discord sessions. |
| `POST /api/members/cancel-pending` | `mod_passcode` or `x-mod-passcode` | Staff compatibility accepted by the route. ModDrawer uses `/api/mod` for staff cancellation. |
| `POST /api/members/update-schedule` | `mod_passcode` or `x-mod-passcode` | Direct-write compatibility accepted by the route. The self-service UI uses Discord sessions and ModDrawer edits through `/api/mod`. |
| `POST /api/members/strikes/metastrike` | `mod_passcode` or `x-mod-passcode` | Staff compatibility accepted by the route. The member UI uses the linked profile’s session. |

- The legacy auth path read the passcode, the Discord allowlist and the live database role. Phase 2 derives the compatibility `is_moderator` flag in [/api/auth/me](src/app/api/auth/me/route.ts) from the active linked database role. Keep the separate account and scheduler credentials through cutover.
- The legacy drawer had two passcode inputs and cached the unlock value as `z_catchers_mod_passcode`. The Phase 2 drawer deletes that entry. Include installed PWAs and old browser tabs when testing the upgrade.
- Before Phase 2, executable passcode fixtures lived in [dispatcher CI](scripts/test-dispatcher-ci.mjs), [dispatch recovery](scripts/test-dispatch-recovery.mjs), [cancel pending](scripts/test-cancel-pending-and-subscribe-rate-limiting.mjs), the former schedule override suite and [strike routes](scripts/test-strikes-api-and-routes.mjs). [The live-role suite](scripts/test-moderation-live-roles.mjs) now uses signed Discord sessions and verifies that the former credentials cannot authorize writes. The hosted dispatcher smoke workflow starts disposable Supabase for these integration tests.
- [The environment template](.env.example) lists the credentials needed by the role-only app. The production scheduler script and GitHub fallback use the separate `CRON_SECRET`. Historical issue-seed scripts document past behavior. Review Vercel request logs by route and confirm any external callers with the operator before cutover. Keep credential values out of the request log review.

### Deployments with database access

| Environment | Evidence and cutover treatment |
|---|---|
| Vercel production | `main` at `e72f3f6`, serving the production domain. The active production Discord profile matched the Supabase row. |
| Vercel branch previews | Ready `dev` (`33f2be5`) and `krish` (`de4a95b`) deployments were listed. Vercel scopes the Supabase URL, service-role key and Discord allowlist to both Production and Preview. Treat these previews as production-connected and use isolated Supabase for role testing. |
| Retained Vercel deployments | The dashboard lists older preview and production deployments. Check each retained deployment’s environment and reachability, including direct deployment URLs and aliases. Treat it as production-connected until its isolation or retirement is verified. The project settings view did not list `MOD_SECRET_PASSCODE`. Check historical deployment configuration and any inherited variables separately. |
| Local and CI | This checkout’s `.env.local` can read the production roster. The dispatcher smoke job uses disposable Supabase. The generic CI job uses placeholders when Supabase secrets are absent. Recheck repository and environment secret names plus any additional deployment workflows before rehearsing. |

### Application and database cutover order

1. In Phase 1, rehearse the additive role migration and operator bootstrap against isolated copies of fresh and existing data. Complete the private owner and moderator checklist before using production. Record the recovery point and capture the pending schedule queue so it can be checked after cutover.
2. Apply the additive role schema to production. Before bootstrapping, pause legacy staff access to production across the current app and retained production-connected previews and deployments. Keep the pending queue intact. Run the guarded owner bootstrap and approved moderator backfill in one transaction.
3. With legacy staff access paused, apply [the live-role migration](supabase/migrations/20261127_moderation_live_roles.sql). It installs the role-checked staff transactions and removes the old passcode rate-limit function. Switch the API and drawer together to the role-only release. Route staff to the new deployment and verify that old deployment URLs can no longer write to production. Test the upgrade from an installed PWA and a signed-in tab that was open before cutover.
4. Smoke-test an Owner, Moderator and Member. Verify the pending queue, self-service 48-hour cooldown, explicit staff approval, immediate revocation in an existing session and rejection of the former passcode. Remove `MOD_SECRET_PASSCODE` and `MOD_DISCORD_IDS` from deployment configuration and verify the scheduler still runs.
5. If cutover fails, pause staff actions, inspect the stored owner and approved moderators, and recover through the rehearsed operator procedure and a corrected role-only release.
