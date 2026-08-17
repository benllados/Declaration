# Declaration

Declaration is a mobile-first, real-time multiplayer card game designed for six friends playing together in person on their phones.

## Status

This repository currently provides the engineering foundation, a framework-independent card/set domain model, normal-play asking, and normal Declaration resolution. The engine validates asks and declarations, uses authoritative declaration timestamps and start-time ownership snapshots, tracks scores and resolved sets, and keeps hidden hand data out of action results. Game UI, multiplayer, authentication, Blind Declaration Mode, winner determination, and Supabase integration have not been implemented.

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
