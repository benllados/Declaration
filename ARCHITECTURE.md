# Declaration Architecture

## Game logic outside React

Game rules and state transitions belong in `src/game/`, which is framework-independent TypeScript. React and Next.js should render and orchestrate game state, not define rules. This keeps the game engine testable, portable, and independent of UI implementation details.

## Future multiplayer model

Multiplayer will be server-authoritative: the server will validate actions and own the canonical game state. Clients must never receive hidden cards belonging to other players.

The game engine, UI, and future multiplayer infrastructure remain separate concerns:

- `src/game/` contains the domain model and deterministic rules engine.
- `src/app/` and `src/components/` contain the Next.js and React user interface.
- Future server and realtime infrastructure will coordinate authoritative state and deliver appropriately scoped client views.

## Testing

Automated unit tests will verify game rules and state transitions. Tests should target framework-independent game code so rule behavior remains reliable as the UI and networking layers evolve.

## Future Supabase use

Supabase is intended for a future multiplayer-infrastructure phase. It is not configured or implemented in this repository yet.
