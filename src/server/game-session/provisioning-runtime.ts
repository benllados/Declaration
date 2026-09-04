import "server-only";

import { getProvisioningPostgresClient } from "@/server/db/postgres";

import { PostgresGameProvisioner } from "./provisioning";

let provisioner: PostgresGameProvisioner | undefined;

/** Isolates the more privileged provisioning connection from gameplay runtime. */
export const getGameProvisioningRuntime = (): Readonly<{ provisioner: PostgresGameProvisioner }> => {
  if (provisioner === undefined) provisioner = new PostgresGameProvisioner(getProvisioningPostgresClient());
  return { provisioner };
};
