// Vitest executes server modules directly; Next.js enforces this marker during
// application bundling. The alias in vitest.config.ts makes server boundaries
// testable without changing their production guard.
export {};
