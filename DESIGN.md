# Declaration Design Principles

Declaration is mobile-first. Its primary design viewport is approximately 390px wide.

The application is primarily designed for six people physically together, each using their own phone. Its visual direction should feel like premium playing cards × a traditional card room × a modern mobile application—not a SaaS dashboard.

## Product principles

- Do not use decorative gradients or glassmorphism.
- Avoid excessive rounded rectangles, pill-shaped controls, unnecessary containers, and nested cards or panels.
- Use whitespace and typography to establish hierarchy.
- Provide one obvious primary action per state.
- Keep playing-card components visually consistent throughout the product.
- Use animation to communicate game-state changes, not as decoration.
- Give Declaration interactions stronger visual treatment than ordinary game actions.
- Prioritize gameplay information over branding.
- Make primary gameplay interactions comfortable on a phone with appropriately sized touch targets.
- Ensure every interactive component eventually accounts for pressed, disabled, loading, and error states.
- Avoid browser-native-looking selects for primary gameplay interactions.
- Build reusable primitives instead of styling each screen independently.
- Avoid generic AI-generated landing-page aesthetics.

## Guidance for contributors

Future contributors and coding agents must read this document before implementing or changing any user-facing interface.

## Design-system phase

Final colors, typography, shadows, border radii, and other design tokens are intentionally undecided. They belong to a dedicated design-system phase.
