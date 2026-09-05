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
    [postgresError("28P01"), "provisioning_authentication"],
    [postgresError("42501"), "provisioning_database_authorization"],
    [Object.assign(new Error("synthetic TLS failure"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }), "provisioning_tls"],
    [Object.assign(new Error("synthetic DNS failure"), { code: "ENOTFOUND" }), "provisioning_dns"],
    [Object.assign(new Error("synthetic connection refusal"), { code: "ECONNREFUSED" }), "provisioning_connection_refused"],
    [Object.assign(new Error("synthetic timeout"), { code: "CONNECT_TIMEOUT" }), "provisioning_timeout"],
  ] as const)("reads code from Error and Postgres.js-shaped error instances", (error, category) => {
    expect(classifyProvisioningFailure(error)).toBe(category);
  });

  it("reads a known database code from a bounded Error cause chain", () => {
    const error = new Error("synthetic wrapper", {
      cause: new Error("synthetic inner wrapper", { cause: postgresError("42501") }),
    });

    expect(classifyProvisioningFailure(error)).toBe("provisioning_database_authorization");
  });

  it("reads a connection code from AggregateError errors", () => {
    const error = new AggregateError([
      Object.assign(new Error("synthetic connection refusal"), { code: "ECONNREFUSED" }),
    ], "synthetic aggregate");

    expect(classifyProvisioningFailure(error)).toBe("provisioning_connection_refused");
  });

  it("reads a nested errors array without serializing the nested values", () => {
    const error = Object.assign(new Error("synthetic nested aggregate"), {
      errors: [new AggregateError([
        Object.assign(new Error("synthetic DNS failure"), { code: "EAI_AGAIN" }),
      ], "synthetic nested aggregate")],
    });

    expect(classifyProvisioningFailure(error)).toBe("provisioning_dns");
  });

  it("replaces an unknown error with a stage category without retaining it", () => {
    const original = new Error("synthetic application failure");
    const failure = toProvisioningFailure(original, "provisioning_result_decoding");

    expect(failure.category).toBe("provisioning_result_decoding");
    expect(Object.values(failure)).not.toContain(original);
    expect(Reflect.get(failure, "cause")).toBeUndefined();
  });
});
