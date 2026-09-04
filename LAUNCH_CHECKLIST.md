# Declaration launch checklist

This is the shortest safe path from the current Build 14 working tree to a public game. Do not add feature work between the code gate and the first production playtest.

## 1. Reproduce the application build

Run on the development Mac from a fresh terminal:

```bash
npm install
git diff --check
npm run lint
npm run typecheck
npm test
npm run build
```

`npm install` is intentional before the gate: the uploaded dependency snapshot contains macOS-native packages, and the current lockfile should be refreshed by npm before relying on a clean install on Vercel/Linux. Review and retain only the expected lockfile changes.

Expected test baseline before the portfolio launch pass: 172 passing application tests, with the PostgreSQL integration tests skipped until an approved loopback database is configured. The new creation/share test must also pass.

## 2. Validate the private database locally

- Start an isolated PostgreSQL/Supabase instance bound only to `localhost`, `127.0.0.1`, or `::1`.
- Create the `declaration_runtime` and `declaration_provisioner` login roles through the approved local administration path.
- Set local-only owner, runtime, provisioner, and test connection strings outside source control.
- Apply the migrations in order:
  1. `20260818000000_declaration_durable_transport.sql`
  2. `20260824000000_declaration_provisioner_least_privilege.sql`
- Run `npm run test:postgres` only against the loopback test database.

For an existing hosted database where the first migration is already recorded, do not rewrite migration history. Apply only the reviewed forward migration that has not yet been recorded.

## 3. Configure staging

Add these server-only values to the Vercel staging/preview environment:

- `DATABASE_URL` — transaction-pooler URI for `declaration_runtime`
- `DECLARATION_PROVISIONING_DATABASE_URL` — direct URI for `declaration_provisioner`
- `DECLARATION_APP_ORIGIN` — exact HTTPS staging origin
- `DECLARATION_SEAT_TTL_SECONDS` — optional; defaults to seven days
- `UPSTASH_REDIS_REST_URL` — staging Redis only
- `UPSTASH_REDIS_REST_TOKEN` — staging Redis only
- `DECLARATION_RATE_LIMIT_KEY_SECRET` — canonical base64url for at least 32 random bytes

Never expose these through `NEXT_PUBLIC_*`. Do not reuse production Redis or the production HMAC secret in staging.

## 4. Run the six-phone staging smoke test

Use six browsers or devices on the same Wi-Fi/NAT.

- Home page explains the game and reaches the creation form from “Set the table.”
- `/demo` works without database access and lets a reviewer switch seats.
- Host creates exactly six different player names.
- Each “Share seat” action opens the native share sheet or copies the correct one-time link.
- Opening an invitation immediately removes its token from the visible URL.
- No invitation redeems until the player presses “Join game.”
- All six seats join and show only their own hand.
- A successful ask transfers the card and preserves the turn.
- An unsuccessful ask moves the turn to the target player.
- Refreshing a joined device preserves its scoped seat.
- A normal Declaration interrupts play, displays the 90-second timer, and resolves assignments.
- Polling remains healthy with all six devices behind one NAT.
- A retryable 429/503 does not destroy an unredeemed invitation.

Record any blocker with the device, browser, step, expected behavior, and observed behavior. Fix only launch-blocking or repeated problems before production.

## 5. Promote to production

- Create separate production Upstash credentials and HMAC secret.
- Set the exact production `DECLARATION_APP_ORIGIN`.
- Confirm the production runtime role cannot read invitation hashes and the provisioner cannot read game state, cards, or credential hashes.
- Deploy the exact staging-tested commit.
- Repeat creation, one invitation redemption, one read, and one action on production.
- Keep the initial audience invited and small while the first three complete tables are observed.

## 6. Capture the product-management proof

After the first three moderated tables:

- Add the activation, time-to-table, first-action, and completion baselines to `PRODUCT.md`.
- Write the top repeated user problem and the decision it caused.
- Capture a 30–60 second phone recording showing creation, seat sharing, one ask, and one Declaration.
- Update `/story` with measured results only; do not present targets as outcomes.
- Use this concise portfolio narrative: problem → product bet → key tradeoff → launch evidence → observed learning → next decision.
