# Declaration v1.0 Rules

This document is the authoritative Declaration v1.0 game specification. Future game-engine behavior must conform to these rules. When implementation behavior conflicts with assumptions elsewhere in the codebase, this document takes precedence.

## 1. Game overview

Declaration is played by exactly six Players, divided into exactly two Teams of three Players.

The game uses 54 cards: a standard 52-card deck, one Red Joker, and one Black Joker. The cards are shuffled randomly and dealt evenly, so every Player begins with exactly nine cards.

The deck is divided into exactly nine Sets of six cards. Teams compete to win more correctly resolved Sets than the other Team. Resolving each Set awards exactly one point to one Team. All nine Sets are eventually resolved, so exactly nine points are awarded and a tie is impossible. The Team with more points wins.

## 2. The nine Sets

Every card belongs to exactly one Set. The low and high groups of the same suit are separate Sets.

| Set | Cards |
| --- | --- |
| Low Hearts | 2♥, 3♥, 4♥, 5♥, 6♥, 7♥ |
| Low Diamonds | 2♦, 3♦, 4♦, 5♦, 6♦, 7♦ |
| Low Clubs | 2♣, 3♣, 4♣, 5♣, 6♣, 7♣ |
| Low Spades | 2♠, 3♠, 4♠, 5♠, 6♠, 7♠ |
| High Hearts | 9♥, 10♥, J♥, Q♥, K♥, A♥ |
| High Diamonds | 9♦, 10♦, J♦, Q♦, K♦, A♦ |
| High Clubs | 9♣, 10♣, J♣, Q♣, K♣, A♣ |
| High Spades | 9♠, 10♠, J♠, Q♠, K♠, A♠ |
| Eights + Jokers | 8♥, 8♦, 8♣, 8♠, Red Joker, Black Joker |

For example, possessing 3♥ gives a Player access to Low Hearts for asking purposes; it does not give access to High Hearts. Possessing any member of Eights + Jokers, including either Joker, establishes possession of that Set for asking purposes.

## 3. Information visibility

A Player's exact Hand is private. Players may see their own cards, but may not see the exact cards held by teammates or opponents unless a game action reveals or transfers a card under these rules.

Public information is:

- Player names
- Profile photos, when available
- Team membership
- Current Turn owner
- Current score
- Completed or Resolved sets
- Current Declaration state
- Declaration timer
- Game status
- Exact number of cards held by each Player

For v1.0, exact Hand counts are public. Future clients must not receive hidden card information belonging to other Players merely so that the UI can hide it. Authoritative game state determines card ownership.

## 4. Normal play and Turns

During normal play, exactly one Player owns the Turn. On their Turn, the Turn owner may Ask one eligible member of the opposing Team for one specific card.

The Target of a normal Ask must belong to the opposing Team, hold at least one card, and be active for normal asking. A Player with zero cards cannot be the Target of a normal Ask.

## 5. Legal Asks

An Ask is legal only when all of the following are true:

1. The Asker owns the current Turn.
2. The Target belongs to the opposing Team.
3. The Target has at least one card and is eligible to be asked.
4. The requested card belongs to an unresolved Set.
5. The Asker does not already possess the requested card.
6. The Asker possesses at least one other card in the same six-card Set as the requested card.
7. The game is in normal play and is not paused by a Declaration.

For example, a Player holding 3♥ may Ask for 2♥, 4♥, 5♥, 6♥, or 7♥. They may not Ask for 3♥ because they already possess it; 2♠ because Low Spades is a different Set; or Q♥ because High Hearts is a different Set.

A Player holding 8♥ may Ask for 8♦, 8♣, 8♠, Red Joker, or Black Joker. A Player holding Red Joker may Ask for any of the other five members of Eights + Jokers.

### Successful Ask

An Ask succeeds when the Target possesses the requested card. The requested card transfers from the Target to the Asker, and the Asker keeps the Turn and may make another legal Ask. There is no fixed limit on consecutive successful Asks.

### Unsuccessful Ask

An Ask fails when the Target does not possess the requested card. No card transfers, and the Target immediately receives the Turn.

### Illegal Ask

The authoritative game engine or server validates every Ask. When an illegal Ask is attempted, no card transfers and the Target receives the Turn. A future UI should prevent obvious illegal Asks, but client-side validation is never authoritative.

## 6. Declaration

Any Player may call **Declaration** at any moment during normal play, including by interrupting another Player's Turn. Browsing or opening an interface to choose a Set does not start an authoritative Declaration. The Player first selects an unresolved Set and the Declaration becomes official only when the server accepts the Player's confirmed selected Set. Once the server accepts that Declaration request:

1. Normal gameplay immediately freezes.
2. No Asks may resolve while the Declaration is active.
3. A server-authoritative 90-second Declaration timer begins.
4. The selected unresolved Set is locked and cannot be changed.
5. The Declarer assigns all six cards in that Set to Players on their own Team.
6. Every card must be assigned to exactly one member of the Declarer's three-Player Team.
7. Teammates may not communicate, advise, confirm, correct, or otherwise assist the Declarer.
8. The Declarer receives no correctness feedback before submission.

A Declaration is evaluated as one complete submission. It is correct only when all six card-to-Player assignments exactly match authoritative card ownership at the moment the Declaration began.

### Correct, incorrect, and timed-out Declarations

If all six assignments are correct, the Declarer's Team receives one point. If any assignment is incorrect, the opposing Team receives one point. A Declaration is never partially correct: one incorrect assignment causes the complete Declaration to fail.

The Declaration timer lasts exactly 90 seconds and must ultimately use authoritative server time rather than a client countdown. A complete submission at the exact deadline is timely; one after the deadline is timed out. For v1.0, a Declarer who does not submit a complete Declaration before the deadline makes an incorrect Declaration, and the opposing Team receives the point for the already locked Set.

### Resolving a Set

After a Declaration resolves, regardless of which Team receives the point:

1. The Set is marked resolved or completed.
2. All six cards in that Set are removed from active Player Hands.
3. Those cards can no longer be asked for.
4. That Set cannot be declared again.
5. The score is updated.

Each Set awards exactly one point.

### Resuming normal play

After a normal Declaration resolves and normal play can continue, the Player who owned the Turn immediately before the Declaration was called retains or receives the Turn. A Declaration does not transfer normal Turn ownership.

If resolution enters Blind Declaration Mode or ends the game, normal Turn ownership no longer matters.

## 7. Zero-card Players

When an individual Player reaches zero cards, they remain a member of their Team and remain relevant for scoring and history. They cannot be the Target of normal Asks while they have zero cards. Normal play may continue through Players who still possess cards.

A zero-card Player may later receive cards only when permitted by future authoritative game mechanics. This specification does not define any additional transfer mechanics.

## 8. Blind Declaration Mode

If all three Players on one Team collectively hold zero active cards, normal asking ends and the opposing Team enters Blind Declaration Mode. That Team selects exactly one of its three Players as the Blind Declarer.

From that point:

- Normal Asks no longer occur.
- The selected Blind Declarer is responsible for all remaining Declarations.
- Teammates may not communicate or assist.
- Remaining unresolved Sets are declared one at a time.
- Normal Declaration correctness rules apply.
- A correct Declaration awards one point to the Blind Declarer's Team.
- An incorrect or timed-out Declaration awards one point to the opposing Team.
- Play continues until every Set is resolved.

The Blind Declarer remains the sole Declarer for the rest of that game.

## 9. Game end

The game ends when all nine Sets have been resolved. Exactly nine points have then been awarded. The Team with more points wins; because nine points are awarded, a tie is impossible.

## 10. Communication

Declaration is intentionally a no-communication Team game. Players may not communicate information intended to reveal their cards, likely card locations, desired Asks, Declaration assignments, or strategic information derived from private Hands.

The application is designed primarily for six people physically together. The software need not police real-world speech for the MVP, but it must not provide built-in functionality that helps teammates communicate hidden game information. Team chat, card-sharing hints, Declaration assistance, and similar mechanics must not be added.

## 11. Authoritative implementation requirements

The following are normative requirements for all future implementations:

- Game state is authoritative outside the client UI.
- A client sends an intended action; it does not dictate the result.
- The engine or server validates every Ask and Declaration.
- Hidden opponent and teammate cards are not exposed to unauthorized clients.
- Declaration timing ultimately uses authoritative timestamps.
- State transitions are deterministic.
- React components are not the source of truth for game rules.
- This document is authoritative when implementation behavior conflicts with assumptions elsewhere in the codebase.

## 12. Conceptual game states

These states describe the game lifecycle. They are a product model, not a v1.0 implementation of a state machine.

| State | Meaning |
| --- | --- |
| `LOBBY` | Players are assembling before a game begins. |
| `DEALING` | The deck is being shuffled and dealt to the six Players. |
| `PLAYING` | Normal play is active; the Turn owner may make Asks and any Player may call Declaration. |
| `DECLARING` | Normal play is frozen while a Declarer prepares a Declaration under the 90-second timer. |
| `DECLARATION_RESOLUTION` | A submitted or timed-out Declaration is evaluated, scored, and its Set is resolved. |
| `BLIND_DECLARATION` | Normal Asks have ended; the selected Blind Declarer resolves each remaining Set. |
| `GAME_OVER` | All nine Sets are resolved and the winning Team is known. |

## 13. Terminology

- **Player:** One of the six participants.
- **Team:** One of the two groups of three Players.
- **Hand:** The cards currently held by a Player.
- **Set:** One defined six-card group in the deck.
- **Active card:** A card in an active Player Hand that belongs to an unresolved Set.
- **Ask:** A Turn owner's request that an opposing Player transfer one specific card.
- **Asker:** The Player making an Ask.
- **Target:** The opposing Player asked for a card.
- **Turn owner:** The Player currently entitled to make a normal Ask.
- **Declaration:** The complete process of choosing an unresolved Set and assigning each of its six cards to a Team member for evaluation.
- **Declarer:** The Player making a Declaration.
- **Blind Declarer:** The single Player selected by the eligible Team to make all remaining Declarations in Blind Declaration Mode.
- **Resolved set:** A Set that has awarded its one point and whose cards have been removed from active Hands.
- **Normal play:** Play in which a Turn owner can make normal Asks; it excludes active Declarations and Blind Declaration Mode.

## 14. Deferred implementation details

The rules above define product behavior. The following are implementation or product-delivery details deliberately not decided in this build and must not be inferred from this specification:

- Exact database schema
- Room-code format
- Reconnect behavior
- Concurrency implementation
- Network retry behavior
- Selfie storage
- QR-code implementation
- Animations
- Sound or haptics
- Analytics
- Final visual design
- Final method for choosing the first Player
- Final method for selecting or assigning Teams in the Lobby

## 15. Consistency checks

This specification defines a 54-card deck: 52 standard cards plus two Jokers. It defines nine Sets of six cards, accounting for all 54 cards exactly once. Six Players receiving nine cards each also accounts for all 54 cards.

Every resolved Set awards one point, so completing all nine Sets awards exactly nine points. Ask success, Ask failure, illegal Ask handling, Declaration correctness, Declaration failure, Declaration timeout, and normal-play Turn resumption are defined deterministically. Blind Declaration Mode continues through the resolution of every remaining Set, giving it a deterministic endpoint. No game truth depends on React or UI state.
