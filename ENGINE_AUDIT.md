# Declaration Engine Audit — Build 08

Audit date: 2026-08-16  
Scope: framework-independent `src/game/` engine against `RULES.md` v1.0.

## Quality gates

- `npm test`: 74 passing tests across 5 files
- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- Dependencies: unchanged

## Major invariants

- The canonical deck contains 54 unique cards, partitioned into nine distinct six-card sets.
- A valid game state accounts for each canonical card exactly once: either in one active hand or in one resolved set, never both.
- Team scores are non-negative integers and their sum equals the resolved-set count; a completed game always awards nine points.
- State construction validates team composition, card conservation, resolved-set uniqueness, lifecycle consistency, and terminal winner consistency before freezing copied state.
- Engine transitions are pure: representative deal, ask, declaration, timeout, Blind selection, and completion tests confirm the input state remains unchanged.

## Rule-to-engine coverage

| Rules sections | Engine modules | Primary tests |
| --- | --- | --- |
| 1–2: deck, sets, initial composition | `cards.ts`, `sets.ts`, `constants/game.ts`, `teams.ts` | `domain.test.ts`, `audit.test.ts` invariants |
| 3: private authoritative ownership | action result types in `asking.ts`, `declaration.ts`; server-only state comments | `asking.test.ts`, `declaration.test.ts` |
| 4–5: turns and asks | `engine/asking.ts` | `asking.test.ts`, `audit.test.ts` |
| 6: declaration lifecycle and timer | `engine/declaration.ts`, `types/declaration.ts` | `declaration.test.ts`, `audit.test.ts` |
| 7–8: zero-card and Blind mode | `engine/normal-play.ts`, `engine/blind-declaration.ts` | `lifecycle.test.ts`, `audit.test.ts` |
| 9: terminal completion and winner | `engine/normal-play.ts`, `engine/declaration.ts` | `lifecycle.test.ts`, `audit.test.ts` |
| 10–11: no built-in communication and authoritative boundaries | no communication feature exists; pure domain modules remain outside React | all game tests; architecture review |

## Findings and corrections

1. **Successful asks did not previously trigger Blind Declaration.** If the requested card was a team’s final active card, `resolveAsk` left the game in `PLAYING`, despite Rules §8 ending normal asking immediately. The transfer path now detects the zero-card team and transitions atomically to `BLIND_DECLARATION` for the opposing team. Regression coverage proves this transition and card conservation.

2. **The state factory allowed impossible lifecycle combinations.** It now rejects normal play with a zero-card team, `DECLARING` without an active normal declaration, all sets resolved outside `GAME_OVER`, an active Blind declaration without its selected Blind Declarer, and completed Blind games that lost their locked declarer history. Existing fixtures were updated to create valid distributions rather than relying on impossible normal-play states.

3. **Extreme finite timestamps could lose the required 90-second interval through floating-point precision.** Declaration start now rejects timestamps that cannot produce a finite deadline exactly 90 seconds later, and active-state validation checks the interval directly. Exact-deadline submission remains timely; timeout remains strictly after the deadline.

4. **Malformed runtime action shapes could throw before producing a domain result.** Ask, declaration start/submission/timeout, and Blind-declarer selection now defensively return machine-readable invalid results without mutating state. This supplements (and does not weaken) the TypeScript action types.

## Adversarial and lifecycle coverage added

- unknown card and malformed action boundaries;
- stale submit/timeout after prior resolution;
- timeout at deadline minus one, exact deadline, and deadline plus one;
- terminal and score/card conservation assertions over all 54 cards;
- Scenario A: normal successful ask, normal declaration, Blind mode, and game completion;
- Scenario B: normal play transitions to Blind mode, then every remaining set resolves;
- Scenario C: correct, incorrect, and timed-out declarations produce a valid nine-point completed game.

## Intentionally deferred concerns

- Database/network concurrency, retries, action idempotency keys, persistence, authentication, reconnects, and UI are outside this engine build.
- `NormalPlayGameState` intentionally contains authoritative private ownership and declaration snapshots. A future server integration must keep this state private and return role-scoped public/player views; action results already avoid returning unrelated hands or snapshots.
- Real-world no-communication enforcement is intentionally not implemented, consistent with Rules §10.

## Conclusion

No unresolved contradiction or ambiguity was found in `RULES.md`. The audited engine is suitable to freeze as the Declaration v1.0 rules engine for UI and server-authoritative multiplayer integration, provided that the future server serializes actions and never exposes the full authoritative state to clients.
