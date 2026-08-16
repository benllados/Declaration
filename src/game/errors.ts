/** Intentional error type used for invalid game-domain inputs. */
export class GameDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameDomainError";
  }
}
