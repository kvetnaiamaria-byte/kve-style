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

Owner signup can use Supabase's default mail sender; registration for other people requires custom SMTP. Keep email confirmation enabled. Set Site URL and allow-listed confirmation redirect to:
https://kve-style-git-codex-kve-test-version-kvetnaiamaria.vercel.app/cloud-confirm.html

The UI currently supports signup and password login, not password recovery. Real iPhone and Telegram behavior must still be checked by the owner. No paid upgrades were enabled.

Supabase's security advisor reports an intentional deny-all RLS table for private reservations and disabled leaked-password protection, which is not available on this Free plan: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Database sources and validation

The SQL is already applied in the new project and recorded in Supabase migration history. Do not reapply it there. Source SQL order for a NEW EMPTY project: initial-library.sql, restrict-rpc.sql, quota-reservations.sql, validate-photo-size.sql, conflict-response.sql. Use a new migration for future changes.

- 32 automated tests: existing UI regression suite plus cloud repository and migration behavior.
- tests/cloud-security.sql: transaction-only fixtures with ROLLBACK for isolation, quota, ownership and revision conflicts.
- Two temporary Auth users: actual login/upload/read, denial of another user's download, stale revision handling, deletion, concurrent quota reservations, exact 50 MB boundary and actual upload size enforcement.
- Browser UI: test account login and idea save; physical iPhone verification remains a user step.
