# Declaration product brief

## Product thesis

Declaration is a mobile-first companion for exactly six longtime friends who want to keep a familiar card-game ritual going after distance makes a shared table harder. Each phone carries one private hand and a shared view of public game state; the group keeps its real conversation on the voice or video call it already uses. It also works for six friends together in person.

The product succeeds when it securely handles the hidden information and bookkeeping that a remote game night needs, while leaving the bluffing, jokes, and friendships to the people playing.

## User and occasion

- Primary user: a host with five existing friends ready to play.
- Primary occasion: a remote game night while the group is connected through its preferred voice/video service.
- Secondary occasion: six friends playing together in person.
- Job to be done: preserve a familiar shared ritual across distance while securely managing hidden information and game state.
- Key constraint: the experience is intentionally built for one six-person friend group, not strangers, asynchronous play, or remote matchmaking.

## V1 goals and non-goals

### Goals

- Get six named players from one host flow into six private seats without accounts or an app install.
- Let each player hold a private hand on a phone while the group continues talking through an existing call.
- Make asking, turn changes, declarations, timers, scoring, reconnecting, and game completion unambiguous.
- Prevent one player from receiving another player’s hidden hand.
- Recover safely from refreshes, duplicate actions, transient failures, and shared-network rate limits.
- Preserve the original group’s identity through the complete custom 54-card deck.
- Work comfortably at a 390 × 844 mobile viewport.

### Non-goals

- Public matchmaking, strangers, rankings, progression, or monetization.
- Asynchronous play or variable player counts.
- Built-in chat or video; the group brings its preferred communication service.
- Replacing the social conversation with an on-screen social layer.

## Core journey

1. The host enters six names in team order.
2. The server creates a shuffled authoritative game and six one-time invitations.
3. The host shares the private links through the group’s usual channel.
4. Each player explicitly redeems one invitation into a secure, cookie-scoped seat.
5. Players ask for cards, continue after successful asks, and pass the turn after misses.
6. Any player may interrupt normal play with a timed Declaration.
7. The final unresolved sets enter Blind Declaration and the game ends with a winner.

## Product decisions and tradeoffs

| Decision | User benefit | Tradeoff accepted |
| --- | --- | --- |
| Use existing calls | Friends keep talking where they already feel comfortable | Remote conversation depends on a separate FaceTime, Discord, Zoom, or other call |
| No accounts | Faster group activation | Seat recovery depends on the scoped browser credential |
| One-time invitation per seat | Clear ownership and private hands | Host must share six distinct links correctly |
| Server-authoritative state | Trustworthy rules, scoring, and secrecy | More backend and deployment complexity than a client-only game |
| Short polling | Simple, durable synchronization for V1 | More read traffic and slightly less immediacy than a socket transport |
| Exact six-player scope | Purpose-built experience for the real game | No partial groups, flexible counts, or public matchmaking |
| Custom friend-group deck | Emotional identity and a reason this does not feel interchangeable | The current deck is deeply personal, not yet a scalable tool for other groups |
| Public solo sandbox | Recruiters and new players can evaluate the interaction immediately | The sandbox is illustrative and does not simulate network behavior |

## Launch scorecard

The first launch should establish baselines rather than optimize arbitrary targets. These are measurement definitions, not achieved results.

| Metric | Definition | First measurement | What it diagnoses |
| --- | --- | --- | --- |
| Table activation | Created games where all six invitations are redeemed | `games.created_at` and `game_seats.invite_redeemed_at` | Host setup and sharing friction |
| Time to table | Time from creation to sixth redemption | Game and seat timestamps | Whether the six-link model is practical |
| First-action success | Activated tables with at least one accepted ask or Declaration | Processed action receipts during moderated sessions | Whether players understand the primary interaction |
| Game completion | Activated tables whose authoritative phase reaches `GAME_OVER` | Stored game state | Whether groups reach the full value proposition |
| Completion time | Time from creation to final update for completed games | `games.created_at` and `games.updated_at` | Session length and pacing |
| Retry/error rate | Rejected or repeated actions divided by submitted actions | Processed action receipts and route status logs | Reliability and interface clarity |
| Repeat table | A group voluntarily organizes another game | Manual follow-up | Whether the ritual is worth returning to |
| Qualitative connection signal | Players feel the digital version preserved the original social experience | A short post-play conversation | Whether the product protects the reason to play |

Processed action receipts are intentionally bounded for idempotency, so they are suitable for early moderated sessions—not permanent behavioral analytics. Any longer-term analytics system should store only the minimum event data required, avoid invitation or credential material, and receive a separate privacy and security review.

## First playtest protocol

Run three moderated six-player tables before adding major features. Start with the original friend group, then invite a small number of other existing groups.

### Observe

- Time from opening the home page until the sixth player sees a hand.
- The first moment the host or a player asks what to do next.
- Whether the separate-call model feels natural or creates a coordination problem.
- Any mistaken seat link, accidental duplicate action, refresh, or connection interruption.
- Whether the Declaration flow can be completed without verbal interface coaching.
- Whether the deck’s personal references create delight and connection rather than confusion.

### Ask afterward

1. What was the most confusing moment?
2. Did the phone protect the game or get in the way of the group?
3. When did you feel most confident that the game state was correct?
4. Did the digital version still feel like the game you wanted to play together?
5. What is the one change that would make you invite this group to play again?

### Synthesize

Tag each observation as activation, comprehension, trust, pacing, or delight. Prioritize an issue when it blocks a game, repeats across two tables, or materially reduces the group’s shared experience. Keep isolated feature requests in the backlog until the underlying need repeats.

## Rollout

1. Validate migrations and role grants against an isolated loopback-only PostgreSQL instance.
2. Configure separate staging rate-limit and database credentials.
3. Complete one internal six-phone smoke test on a shared network.
4. Observe the original friend group in a remote session and fix repeated launch blockers.
5. Run a small number of invited-group playtests.
6. Open the production URL to a small invited cohort.
7. Publish measured results and the next product decision in this brief.

## Next bets, gated by evidence

- Replace six individual copy actions with a faster seat-distribution flow if activation time is the leading blocker.
- Add lightweight rules guidance if first-action comprehension repeats across tables.
- Add reconnect or seat-transfer support if lost credentials interrupt real sessions.
- Consider richer live transport only if polling latency is noticeable during observed play.
- Consider deck personalization for other friend groups only if the custom deck materially increases connection and repeat play.
- Consider rematch, history, or progression only after groups complete games and ask to return.
