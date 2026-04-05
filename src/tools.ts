// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Domain } from "./shared/domains.js";
import { configureWorkItemTools } from "./tools/work-items.js";
import { configureWikiTools } from "./tools/wiki.js";
import type { AuthScheme } from "./shared/ado-auth.js";
import type { ConnectionProvider, TokenProvider } from "./shared/mcp-context.js";

function configureAllTools(
  server: McpServer,
  tokenProvider: TokenProvider,
  connectionProvider: ConnectionProvider,
  userAgentProvider: () => string,
  enabledDomains: Set<string>,
  authScheme: AuthScheme
) {
  if (enabledDomains.has(Domain.WORK_ITEMS)) {
    configureWorkItemTools(server, tokenProvider, connectionProvider, userAgentProvider, authScheme);
  }

  if (enabledDomains.has(Domain.WIKI)) {
    configureWikiTools(server, tokenProvider, connectionProvider, userAgentProvider, authScheme);
  }
}

export { configureAllTools };
