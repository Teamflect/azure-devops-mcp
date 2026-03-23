// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createPatAuthInfo, getPatTokenFromUrl, resolvePatToken } from "../../src/shared/ado-auth";

describe("resolvePatToken", () => {
  it("prefers the request token over environment tokens", () => {
    expect(resolvePatToken("request-token", "mcp-env-token", "pat-env-token")).toBe("request-token");
  });

  it("falls back from ADO_MCP_AUTH_TOKEN to ADO_PAT", () => {
    expect(resolvePatToken(undefined, "mcp-env-token", "pat-env-token")).toBe("mcp-env-token");
    expect(resolvePatToken(undefined, "", "pat-env-token")).toBe("pat-env-token");
  });

  it("returns undefined when all candidates are missing or empty", () => {
    expect(resolvePatToken(undefined, "", "   ")).toBeUndefined();
  });
});

describe("getPatTokenFromUrl", () => {
  it("reads the pat query parameter", () => {
    expect(getPatTokenFromUrl(new URL("https://example.com/mcp?pat=test-token"))).toBe("test-token");
  });

  it("falls back to ado_pat", () => {
    expect(getPatTokenFromUrl(new URL("https://example.com/mcp?ado_pat=test-token"))).toBe("test-token");
  });

  it("returns undefined when no supported query parameter is present", () => {
    expect(getPatTokenFromUrl(new URL("https://example.com/mcp?token=test-token"))).toBeUndefined();
  });
});

describe("createPatAuthInfo", () => {
  it("builds request auth info for query-param PATs", () => {
    expect(createPatAuthInfo("test-token")).toEqual({
      token: "test-token",
      clientId: "query-param",
      scopes: [],
    });
  });
});
