import "server-only";

import { getPostgresClient } from "@/server/db/postgres";
import { PostgresGameSessionRepository } from "./postgres-repository";

let repository: PostgresGameSessionRepository | undefined;

/** Module-scoped runtime repository; no browser module imports this boundary. */
export const getGameSessionRuntime = (): Readonly<{ repository: PostgresGameSessionRepository }> => {
  if (repository === undefined) repository = new PostgresGameSessionRepository(getPostgresClient());
  return { repository };
};
