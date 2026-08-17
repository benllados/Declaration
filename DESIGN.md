# Declaration Production Design System

Declaration is a mobile-first, physical-feeling card game for six friends playing together in person. The primary design viewport is approximately 390 × 844 pixels. Build 09 establishes the visual foundation and reusable presentation primitives; it does not implement gameplay screens or move rules into React.

## Product direction

Declaration should feel light, playful, social, tactile, personal, and polished. The custom friend-group card faces are the visual soul of the product. Composition, whitespace, typography, and gentle physical depth should make the product memorable without competing with those cards.

It should not feel like a casino, dark fantasy product, sci-fi interface, esports product, corporate dashboard, generic SaaS application, or a childish toy. Avoid decorative gradients, glassmorphism, excessive pills, dense grids of containers, and arbitrary status chips. Rounded forms are used for physical pieces, controls, or surfaces with a clear functional purpose.

The Google AI Studio prototype is an exploratory design reference and is not production source code or a game-rules authority. It usefully informed the mobile tabletop composition, card fan, portrait-token treatment, compact score hierarchy, and tactile motion direction. Its mock data, controls, deck management, prototype state, and product assumptions are not part of this application.

`public/cards/` contains the original production v1 card faces. Each WebP is a complete, intentionally composed card face, including rank, suit, illustration, border, and suit-specific styling. The UI uses the non-destructive full-bleed derivatives in `public/cards/trimmed/`, created by `scripts/standardize-card-faces.py`; their source art is otherwise unchanged. Never draw an additional rank/suit overlay, recolour, regenerate, or collapse those assets into rank-only artwork.

## Tokens

Tokens are defined as CSS custom properties in `src/app/globals.css`. Components use semantic tokens rather than scattering literal color values.

| Token | Value | Purpose |
| --- | --- | --- |
| `--color-canvas` | `#f4f0e7` | Warm ivory app canvas |
| `--color-surface` | `#fffdf8` | Main raised and card-adjacent surfaces |
| `--color-surface-muted` | `#ebe4d7` | Quiet separation |
| `--color-ink` | `#202536` | Primary deep-navy text |
| `--color-ink-soft` | `#665f52` | Supporting text |
| `--color-primary` | `#315cdd` | Normal gameplay action, focus, selection |
| `--color-primary-deep` | `#2349bc` | Primary pressed/strong emphasis |
| `--color-declaration` | `#cf2849` | Declaration and high-stakes moments |
| `--color-declaration-deep` | `#a91d39` | Declaration pressed state |
| `--color-success` | `#3d9651` | Friendly success feedback |
| `--color-highlight` | `#d9882b` | Restrained warm highlight/opponent marker |
| `--color-border` | `#ddd3c2` | Soft physical edges |
| `--color-table` | `#f1eddf` | Quiet tabletop field |

Blue is the normal functional colour. Red is deliberately reserved for Declaration, so normal actions do not inherit the visual urgency of a declaration.

## Typography

The system does not add remote font dependencies. It uses a carefully ordered system stack so the app loads reliably:

- `--font-display`: `Iowan Old Style`, `Baskerville`, `Georgia`, serif. Used sparingly for the wordmark, display headings, and major tabletop moments. It has editorial playing-card character without becoming gothic.
- `--font-interface`: `Avenir Next`, `Avenir`, `Nunito Sans`, `Trebuchet MS`, sans-serif. Used for names, controls, score, counts, and gameplay labels. It prioritizes mobile readability.

Avoid all-caps except the wordmark and small eyebrow labels. Interface labels should be direct and comfortably readable rather than technical or tiny.

## Spacing, shape, and depth

The spacing scale is `--space-1` through `--space-7`: 4, 8, 12, 16, 24, 32, and 48 pixels. It creates a clear rhythm without resorting to nested card containers.

Radii are intentionally limited:

- `--radius-small` (12px) for buttons and the brand mark.
- `--radius-medium` (18px) for compact score surfaces.
- `--radius-large` (28px) for the hand tray and substantial tactile surfaces.

There are three surface shadows: `--shadow-surface`, `--shadow-elevated`, and `--shadow-card`/`--shadow-card-selected`. They are warm, short, and directional enough to suggest physical objects resting on a table—not floaty overlays or neon glow. Base layers are canvas, tabletop, surface, elevated controls/tokens, then selected cards. Components should establish a local stacking context instead of growing a global z-index scale.

## Motion

`--motion-quick` is 140ms for button press/hover, and `--motion-standard` is 220ms for card and token selection. `--motion-settle` is a restrained settling curve used for lift and re-placement.

Motion exists to communicate weight, lift, press, selection, and the arrival of a surface. It should not continuously float, pulse, shower particles, or act as decoration. The global reduced-motion query removes transitions and animations for users who request it.

## Production primitives

### PlayingCard

`src/components/cards/PlayingCard.tsx` accepts an engine `CardId`, never a duplicate UI card model. `src/components/cards/card-assets.ts` is the only CardId-to-asset mapping. It derives standard-card paths from the frozen canonical deck and explicitly handles the red and black Jokers. The mapping targets the standardized full-bleed derivatives, while the original supplied files remain available as a rollback source.

The component preserves the 2:3 physical card ratio and uses `object-fit: contain`, ensuring that the full artwork remains visible. Normal cards use a gentle physical shadow. Selected cards lift and receive a blue external treatment without obscuring art. Disabled cards remain recognisable but have lowered saturation, opacity, and elevation. When interactive, cards are semantic buttons with pressed and disabled state; every face has a domain-derived accessible name such as “Seven of Hearts” or “Red Joker.”

### CardHand

`CardHand` is a presentation-only hand/fan primitive. It accepts ordered `CardId`s, returns the same order deterministically, overlaps cards so their upper-left identity has space to show, and uses a small symmetric rotation around the centre. A selected card rises above its neighbours. On narrow screens the hand has its own horizontal overflow rather than causing page overflow. It does not know or enforce asking/declaration legality.

### PlayerToken

`PlayerToken` accepts a name, optional portrait URL, public card count, relationship (`team`, `opponent`, or `neutral`), and selected/active state. It represents a friendly physical portrait piece: circular image or dignified initials fallback, small card-count badge, and name below. Selection produces a blue edge and a small lift. If made interactive, it is a semantic button with a visible focus state.

### Buttons

`Button` deliberately has only three variants:

- `primary` is blue for normal gameplay actions such as a future Ask.
- `declaration` is red for Declaration.
- `secondary` is a warm neutral surface for quiet supporting actions.

Each has visible focus, tactile press, hover where available, and disabled states. Do not add a generic component-library taxonomy until a product need proves it necessary.

### ScoreDisplay

`ScoreDisplay` is a generic compact presentation of two team labels and two scores: `Your Team 2 — 1 Opponents`. It does not imply progress-to-five, another invented win condition, or any game completion logic.

## Mobile-first constraints

Mobile remains authoritative. Design first at about 390px wide, keep touch controls at least 46px high where possible, respect safe-area insets, preserve card readability, and never create horizontal page overflow. Local horizontal scrolling is appropriate for dense physical card arrangements when it preserves legibility. Desktop can expose more of the same system but should not turn the product into a dashboard.

## Accessibility

- Use real `button` elements for interactive buttons, cards, and tokens.
- Keep keyboard focus visibly blue and offset from the control.
- Provide meaningful card names from the canonical game model and public card counts on tokens.
- Pair colour state with elevation, opacity, selected/pressed semantics, or a text equivalent; do not communicate selection or availability by colour alone.
- Maintain strong navy-on-light text contrast and avoid tiny primary information.
- Respect `prefers-reduced-motion` globally.
- Treat custom artwork as visual expression, not the only accessible representation of a card’s identity.

## Guidance for contributors

Read this file before changing user-facing UI. Keep rule logic and authoritative state in `src/game/`; interface components may consume stable domain types but must not recreate rule validation or hidden ownership models. Future gameplay, networking, animation, sound, authentication, and multiplayer work should compose these primitives instead of replacing the frozen engine or importing Google prototype code.
