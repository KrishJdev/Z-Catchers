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

The database trigger blocks changes to the Owner's role, active state, member ID and Discord link, and blocks deletion. Follow the [operator recovery procedure](#owner-recovery) if the verified Owner's Discord identity must be re-linked.

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
- The legacy drawer had two passcode inputs and cached the unlock value as `z_catchers_mod_passcode`. The role-only drawer deletes that entry and the Phase 4 service worker replaces the old shell cache. Include installed PWAs and old browser tabs when testing the upgrade.
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

#### Rehearse on isolated data

- [ ] Run type checking, the unit suites and the production build. Require the **Supabase Cron and push smoke test** on the PR to `dev`. It starts a disposable project, adds a pending request to the legacy schema, bootstraps a fixture Owner, verifies the queue, and exercises the signed sessions and operator recovery. The unit suites also boot the full fresh-install schema.
- [ ] Install the legacy build from an isolated origin and keep a signed-in tab open on that origin. Switch that origin to the candidate build with the same session signing configuration. Relaunch the installed app online from its launcher icon and reload the tab. Verify the **Owner** badge, the roster and pending request, absence of passcode controls, and replacement of the old service worker shell cache. Exercise a permitted staff action after the update.
- [ ] Use separate Owner, Moderator and Member sessions. Choose a test Member's schedule request with a deadline after the test window. Promote another linked Member from the Owner's roster and leave that Member's original session signed in. In the promoted session, approve the pending request. Revoke the role from the Owner's roster and verify that the next staff request on the same session is denied. Confirm the approved schedule and its audit actor.
- [ ] Rehearse [Owner recovery](#owner-recovery) with fixture identities. Record the test origin, exercised builds, device, role results and check URLs in the handoff. Keep production previews with inherited database credentials out of write testing.

#### Prepare production and pause legacy writes

1. Verify the target Supabase project, its current applied migrations, the private Owner identity and the approved moderator inventory. Record a recoverable backup or point-in-time recovery reference and confirm access to the database owner connection. Record the current production commit, the candidate commit and the current scheduler endpoint in the private operator record.
2. Apply the additive [owner and roles migration](supabase/migrations/20261126_moderation_owner_and_roles.sql). Confirm the existing app can still read its roster. Before running the bootstrap, put legacy staff routes behind the maintenance control and cover every production-connected deployment URL or alias. For each legacy deployment, verify the platform blocks access or that the deployment has lost production database reach. Check direct deployment URLs even after moving aliases. Keep the role-only candidate protected until its application and database checks pass.
3. Record a private snapshot of the pending schedule queue before bootstrapping. During the brief write pause, account for ordinary member updates and requests already due for automatic promotion when comparing snapshots. The query below captures the exact pending values without exporting a profile's Discord details.

   ```sql
   SELECT m.id AS member_id, jsonb_object_agg(f.key, f.value) AS pending
   FROM public.members AS m
   CROSS JOIN LATERAL jsonb_each(to_jsonb(m)) AS f
   WHERE m.pending_effective_at IS NOT NULL AND left(f.key, 8) = 'pending_'
   GROUP BY m.id
   ORDER BY m.id;
   ```

#### Switch to the role-only release

1. Run the guarded [Owner bootstrap](supabase/bootstrap_moderation_owner.sql) with the reviewed private values and approved moderator list. Check that exactly one active Discord-linked Owner matches both verified IDs and that the Moderator roster matches the approved inventory.
2. Apply the [live-role migration](supabase/migrations/20261127_moderation_live_roles.sql) while the legacy paths remain paused. Compare the pending queue with the pre-bootstrap snapshot before running the smoke approval. Investigate any unexplained change before restoring staff access.
3. Promote the candidate API and drawer together through `main` and route traffic to the new deployment. Verify the old deployment routes cannot reach the production database or receive staff mutations before resuming staff access. Repeat the open-tab and installed-PWA checks on the live origin.
4. With an agreed test request and linked volunteers, repeat the role smoke. Verify that a Member's own schedule changes use the 48-hour queue, the promoted session can approve the reviewed request, and revocation blocks its next privileged request. Verify that a sessionless request carrying the former passcode receives `401` and cannot alter the queue. Record the result without copying the credential into logs or the handoff.
5. Remove `MOD_SECRET_PASSCODE` and `MOD_DISCORD_IDS` from deployment configuration wherever present. Keep the independent Discord OAuth, session and scheduler credentials. Verify the next scheduled dispatcher request returns HTTP `200`. Record the migration, owner, queue, staff smoke and scheduler result in [HANDOFF.md](HANDOFF.md).

### Owner recovery

1. Pause staff writes on every production-connected deployment and record the incident, recovery point, current Owner and Moderator roster. If the correct Owner is linked and role assignments match, keep them in place and repair the role-only deployment. If the bootstrap has never succeeded, verify the inventory and use the bootstrap transaction.
2. If the sole Owner needs a replacement Discord link, verify the new Discord identity out of band before using a private copy of [the recovery transaction](supabase/recover_moderation_owner.sql). Supply the existing Owner member UUID, expected old Discord ID and verified new Discord ID. Run it as the database owner with stop-on-error enabled. The operation keeps the same member and role, requires the new ID to be unlinked and restores trigger protection in the same transaction. A successful retry preserves the recorded row.
3. Verify exactly one active linked Owner with the expected new ID, and compare the pending queue and Moderator roster with the snapshots. Confirm the old signed session cannot mutate staff data. Have the Owner sign in through Discord with the verified replacement account and complete a permitted staff check. Record the operator, reason, before and after identity, and result in the private operator record.
4. Resume staff access on the verified role-only deployment. Keep legacy deployments blocked during recovery. If the transaction rejects a mismatched, missing or already-linked identity, keep staff writes paused while reconciling the account records.
