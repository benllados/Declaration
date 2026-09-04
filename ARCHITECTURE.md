# Declaration Architecture

## Game logic outside React

Game rules and state transitions belong in `src/game/`, which is framework-independent TypeScript. React and Next.js should render and orchestrate game state, not define rules. This keeps the game engine testable, portable, and independent of UI implementation details.

## Multiplayer model

Multiplayer is server-authoritative: PostgreSQL owns the canonical game state,
the server validates every action under a per-game row lock, and clients never
receive hidden cards belonging to other players.

The game engine, UI, and future multiplayer infrastructure remain separate concerns:

- `src/game/` contains the domain model and deterministic rules engine.
- `src/app/` and `src/components/` contain the Next.js and React user interface.
- `src/server/` contains the private PostgreSQL repository, credential-scoped
  projections, one-time invitation redemption, and provisioning boundary.
- Browser routes expose only a role-scoped player view and public action
  outcomes. Clients use short polling for remote actions and timer expiry.

## Local gameplay integration

Build 10 keeps a deterministic six-player harness in `src/lib/local-game/`, outside the frozen engine. The production root owns one local authoritative engine state for development, then adapts it into a `PlayerGameView` before it reaches presentation components. That view includes only the local hand plus public players, counts, turn, score, phase, and resolved sets; it deliberately excludes other hands and declaration ownership snapshots. The Ask surface creates an action intent and delegates its result to `resolveAsk`; it does not transfer cards or advance turns itself.

The local harness remains available only at `/dev/game`; production game pages
consume the server-delivered player-scoped state. The Build 09 visual reference
remains separately available at `/dev/ui`.

## Testing

Automated unit tests will verify game rules and state transitions. Tests should target framework-independent game code so rule behavior remains reliable as the UI and networking layers evolve.

## Supabase transport

The private `declaration_private` schema stores games, seats, and action
receipts. Browser/Data API roles receive no access. `declaration_runtime` uses
the pooled `DATABASE_URL` for ordinary gameplay, while
`declaration_provisioner` uses a direct connection for game creation,
invitation redemption, and credential recovery. See `supabase/README.md` for
role setup.
