# Cloud preview status

Cloud support is opt-in through the data menu. The original browser library is neither overwritten nor automatically uploaded. This document supersedes the earlier local-only statements in README.md and ANALYSIS.md. Production main remains unchanged.

## Files and setup

Serve root HTML/JS/CSS files, vendor/ and the original icon. No build required. Install pinned dependencies with `pnpm install --frozen-lockfile`; run `npm test` (32 tests).

- cloud-storage.js: private photo upload, versioned document commits, portable export, additive legacy migration.
- cloud-ui.js: account login, local/cloud switch, migration confirmation, usage display and sync on focus/every minute outside forms.
- cloud-config.js: browser-safe publishable key only; never add service_role or secret keys.
- vendor/supabase-2.117.2.js: official npm UMD, with license and pinned pnpm-lock.yaml.
- Auth sessions use IndexedDB so a full localStorage does not block login.

## Limits and privacy

Guests: 50,000,000 bytes. Verified owner email kvetnaiamaria@gmail.com: 500,000,000 bytes. Aggregate protective cap: 950,000,000 bytes. The provider quota is shared with other projects in the organization, if any are added.

Photos are private with short-lived signed URLs. RLS and ownership-checked functions isolate accounts. Direct document writes are disallowed; expected revisions prevent stale device overwrites. Logout clears the in-memory library and image URL cache. Cloud requires internet.

Uploads reserve bytes under a global transaction lock. A storage.objects trigger validates actual final size, because Storage finalizes uploads under a privileged role. This was tested against real uploads and deliberately undersized reservations. Retest these checks after Storage upgrades. No RLS policy permits overwriting existing image files.

Failed uploads can leave reserved space or unattached objects. There is NO automatic orphan cleanup. Such space requires a separate administrator review; a retry of the same photo reuses its reservation. Ordinary removal of a library photo releases it only after a successful document commit.

## Migration and rollback

Migration first downloads a raw local backup and asks the user to confirm ownership of the source and destination email. A device binding prevents a different account from claiming the same browser library. Import merges with existing cloud content, remaps conflicting IDs, and records the source hash atomically to prevent repeating the same migration. Original localStorage is retained.

The test domain cannot read the Telegram/production origin's localStorage. Migration of the real original library must eventually run at that original origin in a separately approved production release. Do not clear browser data. JSON export embeds image bytes, not expiring signed URLs.

## Remaining launch configuration

Owner signup can use Supabase's default mail sender; registration for other people requires custom SMTP. Keep email confirmation enabled. Site URL and the exact allow-listed confirmation redirect are configured as:
https://kve-style-git-codex-kve-test-version-kvetnaiamaria.vercel.app/cloud-confirm.html

The UI currently supports signup and password login, not password recovery. Real iPhone and Telegram behavior must still be checked by the owner. No paid upgrades were enabled.

Supabase's security advisor reports an intentional deny-all RLS table for private reservations and disabled leaked-password protection, which is not available on this Free plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Database sources and validation

The SQL is already applied in the new project and recorded in Supabase migration history. Do not reapply it there. Source SQL order for a NEW EMPTY project: initial-library.sql, restrict-rpc.sql, quota-reservations.sql, validate-photo-size.sql, conflict-response.sql. Use a new migration for future changes.

- 32 automated tests: existing UI regression suite plus cloud repository and migration behavior.
- tests/cloud-security.sql: transaction-only fixtures with ROLLBACK for isolation, quota, ownership and revision conflicts.
- Two temporary Auth users: actual login/upload/read, denial of another user's download, stale revision handling, deletion, concurrent quota reservations, exact 50 MB boundary and actual upload size enforcement.
- Browser UI: test account login, idea save, session restore and saved idea after reload, and logout. Physical iPhone verification remains a user step.

## Telegram Mini App login (2026-09-28)

Bot: `@archive_style_bot`, ID `8904793828`. No bot token, SMTP provider, or purchased domain is required. Frontend must be opened as a Telegram Mini App, not an ordinary link in Telegram's browser. Telegram SDK exposes initData; it is never trusted without server verification.

Deploy `supabase/migrations/20260928142743_telegram_auth.sql`, then `supabase/functions/telegram-auth/index.ts` with `verify_jwt=false`: the endpoint authenticates Telegram's production Ed25519 signature, fixed bot ID, timestamp (5 minutes, 30-second clock skew), duplicate fields, and signed user ID before any database work. Test keys cannot be supplied in requests. Only exact production and preview origins receive CORS headers. Edge defaults provide Supabase server secrets; none enter the frontend. Never log initData, OTPs, or session tokens.

New accounts require an explicit Create action. The server reserves a random UUID and unguessable non-deliverable internal email; it creates a confirmed Auth user with that exact UUID, then uses admin.generateLink + server-side verifyOtp to obtain normal refreshable Supabase sessions without sending email. Every returned user ID is checked against the mapping. Existing accounts require a separately verified Supabase session and explicit Link action; no libraries are copied or reassigned. Owner verified email remains unchanged, preserving the 500 MB entitlement. New Telegram accounts get the existing 50 MB quota. Browser-only login for Telegram-only accounts is not part of this stage; open the bot in Telegram on each device.

Mapping and short-lived replay receipts are server-only (RLS with no client policies; client table/RPC grants revoked). Claim is an invoker function callable only by service_role. Advisory locking serializes account creation/linking, unique constraints prevent competing bindings, and canonical proof fingerprints prevent replay. Successful attempts consume the proof, including failures after the reservation step: reopen the Mini App to retry. Login attempts are throttled per bound Telegram identity. Only old authentication receipts are cleaned up; this does not delete photos, libraries or accounts. An unfinished provisioning reservation can retry with the same UUID; a previously provisioned but missing Auth user fails closed rather than creating another account.

Validation: cryptographic tampering/wrong bot/stale/future/duplicate-field tests; server session-exchange and UID-mismatch tests; PostgreSQL privilege/uniqueness/replay tests; existing app and storage regressions. Real successful Telegram login and owner linking require manual verification from the bot before merging the preview. Rollback frontend: set `telegramEnabled:false`; existing email login and data continue to work. Do not delete identity mappings to roll back.

Security Advisor's no-policy notices on the two Telegram tables are intentional: only the server may access them ([explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Existing leaked-password-protection warning is unchanged; the new Telegram path does not use passwords.


## Telegram bot welcome

`supabase/functions/telegram-bot` answers private messages with a short KVÉ introduction and a Web App button. Deployment requires the production secret `TELEGRAM_BOT_TOKEN`; it must only be entered in Supabase Edge Function Secrets and must never be committed or pasted into chat. A GET request after deployment idempotently configures the webhook, `/start`, `/app`, `/help`, the bot description, short description, and menu button using fixed values from source code.

Telegram webhook requests are authenticated with a secret derived from the bot token and compared without early exit. The endpoint is public at the gateway (`verify_jwt=false`) because Telegram cannot send a Supabase JWT; all unverified requests are rejected before their body is processed. `kve_bot_updates` is server-only and records update IDs so Telegram retries cannot send duplicate replies. A failed outbound reply releases its receipt for retry; successful receipts older than 30 days are deleted. The bot stays quiet in groups. The bot token and webhook secret are never returned or logged.
