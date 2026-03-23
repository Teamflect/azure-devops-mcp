// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Buffer } from "node:buffer";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export type AuthScheme = "bearer" | "pat";

const PAT_AUTH_TYPES = new Set(["envvar", "pat"]);

export function resolveAuthScheme(authenticationType: string): AuthScheme {
  return PAT_AUTH_TYPES.has(authenticationType) ? "pat" : "bearer";
}

export function formatAuthorizationHeader(token: string, scheme: AuthScheme): string {
  if (scheme === "pat") {
    const encoded = Buffer.from(`:${token}`, "utf8").toString("base64");
    return `Basic ${encoded}`;
  }
  return `Bearer ${token}`;
}

export function resolvePatToken(...candidates: Array<string | null | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return undefined;
}

export function getPatTokenFromUrl(url: URL): string | undefined {
  return resolvePatToken(url.searchParams.get("pat"), url.searchParams.get("ado_pat"));
}

export function createPatAuthInfo(token: string, clientId = "query-param"): AuthInfo {
  return {
    token,
    clientId,
    scopes: [],
  };
}

export function parseAuthorizationHeader(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  const [rawScheme, rawToken] = headerValue.split(" ");
  if (!rawScheme || !rawToken) {
    return undefined;
  }
  const scheme = rawScheme.toLowerCase();
  if (scheme === "bearer" || scheme === "pat") {
    return rawToken.trim();
  }
  if (scheme === "basic") {
    try {
      const decoded = Buffer.from(rawToken, "base64").toString("utf8");
      const parts = decoded.split(":", 2);
      return parts.length === 2 ? parts[1] : decoded;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function parseBearerAuthorizationToken(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  const [rawScheme, rawToken] = headerValue.split(" ");
  if (!rawScheme || !rawToken) {
    return undefined;
  }
  const scheme = rawScheme.toLowerCase();
  if (scheme === "bearer" || scheme === "pat") {
    return rawToken.trim();
  }
  return undefined;
}

export function parseBasicAuthCredentials(headerValue: string | null | undefined): { username: string; password: string } | undefined {
  if (!headerValue) {
    return undefined;
  }
  const [rawScheme, rawToken] = headerValue.split(" ");
  if (!rawScheme || !rawToken || rawScheme.toLowerCase() !== "basic") {
    return undefined;
  }
  try {
    const decoded = Buffer.from(rawToken, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return undefined;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return undefined;
  }
}
