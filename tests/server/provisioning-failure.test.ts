import postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  classifyProvisioningFailure,
  toProvisioningFailure,
} from "../../src/server/game-session/provisioning-failure";

const postgresError = (code: string): Error => {
  const PostgresError = (postgres as typeof postgres & {
    PostgresError: new (fields: Readonly<{ message: string; code: string }>) => Error;
  }).PostgresError;
  return new PostgresError({ message: "synthetic Postgres.js failure", code });
};

describe("provisioning failure classification", () => {
  it.each([
    [Object.assign(new Error("synthetic authentication failure"), { code: "28P01" }), "provisioning_database_authentication"],
    [postgresError("42501"), "provisioning_database_permission"],
    [Object.assign(new Error("synthetic schema failure"), { code: "42P01" }), "provisioning_database_schema"],
    [Object.assign(new Error("synthetic connection failure"), { code: "ECONNREFUSED" }), "provisioning_database_connection"],
  ] as const)("reads code from Error and Postgres.js-shaped error instances", (error, category) => {
    expect(classifyProvisioningFailure(error)).toBe(category);
  });

  it("reads a known database code from a bounded Error cause chain", () => {
    const error = new Error("synthetic wrapper", {
      cause: new Error("synthetic inner wrapper", { cause: postgresError("42501") }),
    });

    expect(classifyProvisioningFailure(error)).toBe("provisioning_database_permission");
  });

  it("replaces an unknown error with a stage category without retaining it", () => {
    const original = new Error("synthetic application failure");
    const failure = toProvisioningFailure(original, "provisioning_result_decoding");

    expect(failure.category).toBe("provisioning_result_decoding");
    expect(Object.values(failure)).not.toContain(original);
    expect(Reflect.get(failure, "cause")).toBeUndefined();
  });
});
