import "server-only";

import postgres, { type Sql } from "postgres";

import { getDatabaseUrl, getProvisioningDatabaseUrl } from "@/server/config/environment";

let client: Sql | undefined;
let provisioningClient: Sql | undefined;

/**
 * The runtime connection uses Supabase's transaction pooler. Prepared
 * statements are deliberately disabled because pooled connections are shared
 * between short-lived server instances.
 */
export const getPostgresClient = (): Sql => {
  if (client !== undefined) return client;
  client = postgres(getDatabaseUrl(), {
    // Supabase pooler connections must be encrypted. Certificate verification
    // requires an explicitly configured CA, which this runtime does not hold.
    ssl: "require",
    prepare: false,
    max: 3,
    idle_timeout: 10,
    connect_timeout: 5,
  });
  return client;
};

/** A separate, least-privileged connection for provisioning only. */
export const getProvisioningPostgresClient = (): Sql => {
  if (provisioningClient !== undefined) return provisioningClient;
  provisioningClient = postgres(getProvisioningDatabaseUrl(), {
    // Keep the separately scoped credential encrypted without requiring a CA
    // that is not configured in this Vercel runtime.
    ssl: "require",
    prepare: false,
    max: 1,
    idle_timeout: 10,
    connect_timeout: 5,
  });
  return provisioningClient;
};
