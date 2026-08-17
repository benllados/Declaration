# Declaration

Declaration is a mobile-first, real-time multiplayer card game designed for six friends playing together in person on their phones.

## Status

This repository provides a complete, framework-independent Declaration v1.0 rules engine: card/set modeling, normal asks, timed declarations, Blind Declaration selection and resolution, game lifecycle phases, score/card conservation, terminal game completion, and winner determination. The engine validates authoritative actions and timestamps, uses start-time ownership snapshots, and keeps hidden hand data out of action results.

Build 10 adds a local single-client production gameplay table at `/`. It starts a deterministic six-player game through the existing setup/dealing engine, renders a player-scoped view, and sends normal Ask intents through the frozen engine. This is a development integration only: multiplayer, authentication, persistence, and Supabase are not implemented. The Build 09 component reference remains available at `/dev/ui`.

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

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

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
tests/          Unit tests
```

## Project references

- [Game rules](./RULES.md)
- [Product design principles](./DESIGN.md)
- [Architecture](./ARCHITECTURE.md)
