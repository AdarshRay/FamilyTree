# Web launch verification — 16 October 2026

The web launch uses Google sign-in only. Email signup and recovery remain behind
`VITE_EMAIL_AUTH_ENABLED=true`, which requires a separately configured SMTP
provider. No paid service was enabled.

## Fixes

- Restored the inactive Supabase project and verified its deployed migrations.
- Added password recovery for future email-enabled deployments, including web
  and desktop redirects and expired-link handling.
- Fixed account deletion after TLink approval. Deleting either participant now
  removes their connections and revokes collaboration access created by those
  connections, preserving unrelated trees and direct memberships.
- Allowed publishing requests up to 120 seconds; ordinary backend requests
  retain an eight-second timeout. Caller cancellation is preserved.
- Applied compatible dependency updates to remove high and critical development
  dependency advisories.

## Verification

- Production build and 34 automated tests pass.
- Production dependencies have zero reported vulnerabilities. The complete
  dependency audit has no high or critical advisories; eight moderate findings
  remain in the desktop packaging dependency chain (`sprintf-js`). They are not
  shipped in the static web build. Do not force a desktop-builder downgrade as
  part of this web release.
- Browser Google sign-in returns to the authenticated dashboard.
- Disposable live accounts verified password login, recovery-token exchange,
  password change, rejection of the old password, and login with the new one.
  The recovery fixture bypassed email delivery; SMTP inbox delivery is not tested.
- Live checks verified tree creation/read/update, membership creation, hidden
  trees for uninvited users, viewer write/upload denial, administrator RPC
  denial for ordinary users, invitations, TLink acceptance/disconnection,
  and photo upload/replacement/listing/deletion.
- Account deletion succeeds through the deployed function, deleted accounts can
  no longer sign in, and owned trees cascade away. Disposable test accounts and
  their trees were removed.
- `supabase/tests/account_deletion.sql` passes against the migrated database and
  rolls back its fixtures. It checks that deleting a collaborator revokes
  connection-created access while preserving another owner's tree.
- Synthetic publication created a live site at
  https://adarshray.github.io/launch-verification-2026-10-16/ containing only
  “Launch Test Founder”. This test tree/repository is separate from the real
  family tree. Republishing through the browser succeeds with the timeout fix.
  The synthetic tree was removed from the application after verification; the
  standalone sample repository/site remains available as evidence.

## Security advisory context and limits

All 14 application tables have row-level security enabled. The advisor flags
authenticated access to 16 security-definer RPCs; these provide intentional
application operations, with authentication/ownership/administrator checks.
Live tests confirmed viewer and ordinary-user privilege denials. The two GitHub
credential/state tables have RLS with no client policies intentionally: backend
functions access them using the service role. These advisory patterns should
continue to be reviewed when RPC behavior changes:
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

Leaked-password protection is disabled in Supabase. The launch UI offers Google
sign-in; review password security before enabling email accounts:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Mac signing, notarization, packaging, and distribution were not verified by this
web launch assessment. This is functional launch verification, not a penetration
test or an uptime guarantee. Free Supabase projects may require restoration
after inactivity.
