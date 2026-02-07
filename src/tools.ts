// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { configureWorkItemTools } from "./tools/work-items.js";
import type { AuthScheme } from "./shared/ado-auth.js";
import type { ConnectionProvider, TokenProvider } from "./shared/mcp-context.js";

function configureAllTools(
  server: McpServer,
  tokenProvider: TokenProvider,
  connectionProvider: ConnectionProvider,
  userAgentProvider: () => string,
  _enabledDomains: Set<string>,
  authScheme: AuthScheme
) {
  configureWorkItemTools(server, tokenProvider, connectionProvider, userAgentProvider, authScheme);
}

export { configureAllTools };
