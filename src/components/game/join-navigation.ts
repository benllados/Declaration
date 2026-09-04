"use client";

/** Keeps the fragment-only invitation token out of the post-redemption URL. */
export const redirectToJoinedGame = (gameId: string): void => {
  window.location.replace(`/games/${gameId}`);
};
