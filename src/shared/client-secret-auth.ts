// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const scopes = ["499b84ac-1321-427f-aa17-267ca6975798/.default"];
const expiresEarlyMs = 2 * 60 * 1000;

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

export function createClientSecretTokenProvider(tenantId: string, clientId: string, clientSecret: string): () => Promise<string> {
  let cache: TokenCache | undefined;

  return async () => {
    if (cache && Date.now() < cache.expiresAtMs - expiresEarlyMs) {
      return cache.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: scopes[0],
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const payload = await response.json();
    if (!response.ok || !payload?.access_token) {
      const errorMessage = payload?.error_description ?? payload?.error ?? `HTTP ${response.status}`;
      throw new Error(`Failed to acquire OAuth access token via client credentials: ${errorMessage}`);
    }

    const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : Number.parseInt(String(payload.expires_in ?? "3600"), 10);
    const safeExpiresInSeconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
    cache = {
      accessToken: payload.access_token,
      expiresAtMs: Date.now() + safeExpiresInSeconds * 1000,
    };

    return cache.accessToken;
  };
}
