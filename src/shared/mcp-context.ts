// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { WebApi } from "azure-devops-node-api";

export type McpRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
export type TokenProvider = (extra?: McpRequestExtra) => Promise<string>;
export type ConnectionProvider = (extra?: McpRequestExtra) => Promise<WebApi>;
