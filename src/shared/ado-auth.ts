// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Buffer } from "node:buffer";

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
