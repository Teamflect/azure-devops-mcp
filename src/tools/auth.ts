// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { apiVersion } from "../utils.js";
import { IdentityBase } from "azure-devops-node-api/interfaces/IdentitiesInterfaces.js";
import { formatAuthorizationHeader } from "../shared/ado-auth.js";
import type { AuthScheme } from "../shared/ado-auth.js";
import type { ConnectionProvider, McpRequestExtra, TokenProvider } from "../shared/mcp-context.js";

interface IdentitiesResponse {
  value: IdentityBase[];
}

async function getCurrentUserDetails(tokenProvider: TokenProvider, connectionProvider: ConnectionProvider, userAgentProvider: () => string, authScheme: AuthScheme, extra?: McpRequestExtra) {
  const connection = await connectionProvider(extra);
  const url = `${connection.serverUrl}/_apis/connectionData`;
  const token = await tokenProvider(extra);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": formatAuthorizationHeader(token, authScheme),
      "Content-Type": "application/json",
      "User-Agent": userAgentProvider(),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error fetching user details: ${data.message}`);
  }
  return data;
}

/**
 * Searches for identities using Azure DevOps Identity API
 */
async function searchIdentities(
  identity: string,
  tokenProvider: TokenProvider,
  connectionProvider: ConnectionProvider,
  userAgentProvider: () => string,
  authScheme: AuthScheme,
  extra?: McpRequestExtra
): Promise<IdentitiesResponse> {
  const token = await tokenProvider(extra);
  const connection = await connectionProvider(extra);
  const orgName = connection.serverUrl.split("/")[3];
  const baseUrl = `https://vssps.dev.azure.com/${orgName}/_apis/identities`;

  const params = new URLSearchParams({
    "api-version": apiVersion,
    "searchFilter": "General",
    "filterValue": identity,
  });

  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      "Authorization": formatAuthorizationHeader(token, authScheme),
      "Content-Type": "application/json",
      "User-Agent": userAgentProvider(),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Gets the user ID from email or unique name using Azure DevOps Identity API
 */
async function getUserIdFromEmail(
  userEmail: string,
  tokenProvider: TokenProvider,
  connectionProvider: ConnectionProvider,
  userAgentProvider: () => string,
  authScheme: AuthScheme,
  extra?: McpRequestExtra
): Promise<string> {
  const identities = await searchIdentities(userEmail, tokenProvider, connectionProvider, userAgentProvider, authScheme, extra);

  if (!identities || identities.value?.length === 0) {
    throw new Error(`No user found with email/unique name: ${userEmail}`);
  }

  const firstIdentity = identities.value[0];
  if (!firstIdentity.id) {
    throw new Error(`No ID found for user with email/unique name: ${userEmail}`);
  }

  return firstIdentity.id;
}

export { getCurrentUserDetails, getUserIdFromEmail, searchIdentities };
