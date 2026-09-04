# Declaration

Declaration is a mobile-first, real-time multiplayer card game for six existing friends. Each player gets a private hand on their phone while the group keeps talking on the FaceTime, Discord, Zoom, or other call it already uses. The primary occasion is a remote game night; six friends together in person are also supported.

## Status

This repository provides a complete, framework-independent Declaration v1.0 rules engine: card/set modeling, normal asks, timed declarations, Blind Declaration selection and resolution, game lifecycle phases, score/card conservation, terminal game completion, and winner determination. The engine validates authoritative actions and timestamps, uses start-time ownership snapshots, and keeps hidden hand data out of action results.

Build 14 makes the game playable across six phones: a host creates a shuffled
six-seat game, shares one-time invitation links whose secrets live only in the
browser URL fragment, and each invitation explicitly exchanges into a secure
cookie-scoped seat. The game screen reads only its
credential-scoped player view and sends idempotent actions to the durable
PostgreSQL transport, refreshing by short polling for other players and timer
resolution. The deterministic local harness remains at `/dev/game`; the Build
09 component reference remains available at `/dev/ui`.

The public home page explains how a host can get six friends into private seats
for a remote table, uses the device share sheet for private seat invitations
when available, and links to a deterministic `/demo` so a new player or
reviewer can try the core interaction without assembling six people. `/story`
presents the origin with the original friend group, the focused V1 decisions,
the system boundary, and the launch scorecard.

## Product thinking

The [product brief](./PRODUCT.md) records the audience, product thesis, v1
goals and non-goals, decision tradeoffs, success metrics, first playtest
protocol, and rollout gates. The live product story deliberately distinguishes
launch definitions from measured results; baselines will be added only after
real moderated tables.

The [launch checklist](./LAUNCH_CHECKLIST.md) is the operator runbook for the
clean build gate, loopback database validation, staging configuration,
six-phone smoke test, production promotion, and post-launch evidence capture.

## Technology

- Next.js App Router
- React and TypeScript
- Tailwind CSS
- ESLint
- Vitest
- npm

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful local routes:

- `/` — public product landing and live game creation
- `/demo` — deterministic single-device playable demo
- `/story` — public product case study and launch scorecard
- `/dev/game` — local engine and perspective-switching harness
- `/dev/ui` — component and card-deck reference

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

For local transaction/locking coverage, start Supabase locally, apply the
migration, and set an explicitly local `DECLARATION_TEST_DATABASE_URL` (only
`localhost` / loopback URLs are accepted by the suite):

```bash
supabase db reset
DECLARATION_TEST_DATABASE_URL=postgres://... npm run test:postgres
```

See [Supabase setup](./supabase/README.md) for the private-schema role and
connection-string requirements. Do not point this command at a hosted or
production database.

To use creation and invitation redemption locally or in production, configure
`DECLARATION_PROVISIONING_DATABASE_URL` with the direct connection for the
separately scoped `declaration_provisioner` role. Gameplay uses only the
transaction-pooler `DATABASE_URL` for `declaration_runtime`.

## Production transport requirements

Set `DECLARATION_APP_ORIGIN` to the exact HTTPS public origin (loopback HTTP is
accepted only for local development). Creation, invitation redemption, and
actions require that exact browser `Origin`.

Production is supported on Vercel and requires an Upstash Redis database. Add
these non-public secrets in every Vercel environment that serves these routes
(never `NEXT_PUBLIC_*`):
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and
`DECLARATION_RATE_LIMIT_KEY_SECRET`. The last value must be the canonical
base64url encoding of at least 32 cryptographically random bytes and must be
kept in the secret manager. The application constructs the shared Upstash
sliding-window limiter lazily from those validated settings; it does not need
or accept module-local startup registration.

The limiter uses Vercel's supported `ipAddress(request)` source identity and
HMAC-derived, domain-separated Redis keys, so Redis never receives raw IPs,
cookies, credentials, invitation tokens, or game IDs. If Vercel cannot supply
an authoritative address, any rate-limit setting is invalid, or Redis is
unavailable, the affected public/authenticated endpoint returns a generic 503.
There is intentionally no timeout-based allow-through behavior. Local
development and tests use an isolated deterministic in-memory limiter instead.

| Boundary | Shared source limit | Authenticated seat limit |
| --- | ---: | ---: |
| Game creation | 8/minute | — |
| Invitation redemption | 20/minute | — |
| Game reads | 360/minute | 90/minute |
| Game actions | 180/minute | 30/minute |

Six players polling every 1.5 seconds make 240 reads/minute behind one NAT
(6 × 40), leaving 120 requests/minute of source-level headroom; each seat makes
40 reads/minute, below its 90/minute limit. A 429 response is generic, includes
`Retry-After`, and the client pauses polling with bounded jitter before
resuming. User actions are never retried automatically.

Manual production setup, in order:

1. Create an Upstash Redis database and place its REST URL/token plus the HMAC
   secret in the Vercel **Production** environment. For staging/canary, use a
   separate Redis database and HMAC secret rather than reusing production.
2. Configure the exact `DECLARATION_APP_ORIGIN` and the separately scoped
   runtime/provisioner database URLs described in [Supabase setup](./supabase/README.md).
3. Apply the reviewed migration as the database owner and confirm the two
   custom roles/grants before enabling traffic.
4. Verify the production deployment from an approved staging/canary path. Do
   not use local integration-test credentials for this step.

Vercel WAF rules can add defense in depth, but they are optional: application
rate limits remain the required control.

Processed-action receipts retain the newest 128 actions per game; retry a
network-delivered action with its original ID only within that window. See the
[Supabase setup](./supabase/README.md) for role grants and local test setup.

## Structure

```text
src/
  app/          Next.js routes and application shell
  components/   Reusable React UI components
  game/         Framework-independent game domain code
    constants/
    engine/
    types/
    utils/
  lib/          Shared application utilities and integrations
  server/       Private durable transport, provisioning, and database access
tests/          Unit tests
```

## Project references

- [Game rules](./RULES.md)
- [Product design principles](./DESIGN.md)
- [Product brief and launch scorecard](./PRODUCT.md)
- [Launch checklist](./LAUNCH_CHECKLIST.md)
- [Architecture](./ARCHITECTURE.md)
