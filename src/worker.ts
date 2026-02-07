// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { logger } from "./logger.js";
import { parseAuthorizationHeader, resolveAuthScheme } from "./shared/ado-auth.js";
import type { ConnectionProvider, McpRequestExtra, TokenProvider } from "./shared/mcp-context.js";
import { StreamableHttpFetchTransport } from "./transport/streamable-http-fetch.js";

export interface Env {
  ADO_ORG: string;
  ADO_AUTH_TYPE?: string;
  ADO_MCP_AUTH_TOKEN?: string;
  ADO_PAT?: string;
  MCP_HTTP_PATH?: string;
  MCP_ENABLE_JSON_RESPONSE?: string;
  MCP_STATEFUL?: string;
  MCP_ALLOWED_ORIGINS?: string;
  MCP_ALLOWED_HOSTS?: string;
  MCP_ENABLE_DNS_REBINDING_PROTECTION?: string;
}

type WorkerState = {
  transport: StreamableHttpFetchTransport;
  authScheme: "bearer" | "pat";
  authenticationType: string;
  path: string;
};

let cachedState: WorkerState | undefined;

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getEnvValue(env: Env, key: keyof Env): string | undefined {
  return env[key];
}

async function initWorker(env: Env): Promise<WorkerState> {
  if (cachedState) {
    return cachedState;
  }

  const orgName = getEnvValue(env, "ADO_ORG");
  if (!orgName) {
    throw new Error("Missing required env var ADO_ORG.");
  }

  const authenticationType = getEnvValue(env, "ADO_AUTH_TYPE") ?? (getEnvValue(env, "ADO_MCP_AUTH_TOKEN") || getEnvValue(env, "ADO_PAT") ? "envvar" : "pat");
  const authScheme = resolveAuthScheme(authenticationType);

  const tokenProvider: TokenProvider = async (extra?: McpRequestExtra) => {
    const tokenFromRequest = extra?.authInfo?.token;
    if (tokenFromRequest) {
      return tokenFromRequest;
    }
    if (authenticationType === "envvar") {
      const token = getEnvValue(env, "ADO_MCP_AUTH_TOKEN") ?? getEnvValue(env, "ADO_PAT");
      if (!token) {
        throw new Error("Missing ADO_MCP_AUTH_TOKEN/ADO_PAT for envvar authentication.");
      }
      return token;
    }
    throw new Error("Missing Authorization header for PAT authentication.");
  };

  const userAgentComposer = new UserAgentComposer(packageVersion);
  const connectionProvider: ConnectionProvider = async (extra?: McpRequestExtra) => {
    const accessToken = await tokenProvider(extra);
    const authHandler = authScheme === "pat" ? getPersonalAccessTokenHandler(accessToken) : getBearerHandler(accessToken);
    return new WebApi(`https://dev.azure.com/${orgName}`, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
  };

  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  configureAllTools(server, tokenProvider, connectionProvider, () => userAgentComposer.userAgent, new Set(["work-items"]), authScheme);

  const transport = new StreamableHttpFetchTransport({
    sessionIdGenerator: getEnvValue(env, "MCP_STATEFUL") === "true" ? () => crypto.randomUUID() : undefined,
    enableJsonResponse: getEnvValue(env, "MCP_ENABLE_JSON_RESPONSE") === "true",
    allowedOrigins: parseCsv(getEnvValue(env, "MCP_ALLOWED_ORIGINS")),
    allowedHosts: parseCsv(getEnvValue(env, "MCP_ALLOWED_HOSTS")),
    enableDnsRebindingProtection: getEnvValue(env, "MCP_ENABLE_DNS_REBINDING_PROTECTION") === "true",
  });

  await server.connect(transport);

  const path = getEnvValue(env, "MCP_HTTP_PATH") ?? "/mcp";

  cachedState = { transport, authScheme, authenticationType, path };
  logger.info("Cloudflare MCP worker initialized", {
    organization: orgName,
    auth: authenticationType,
    path,
  });
  return cachedState;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const state = await initWorker(env);
    const url = new URL(request.url);
    if (url.pathname !== state.path) {
      return new Response("Not Found", { status: 404 });
    }

    const token = parseAuthorizationHeader(request.headers.get("authorization"));
    if (state.authenticationType === "pat" && !token) {
      return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }

    let authInfo: AuthInfo | undefined;
    if (token) {
      authInfo = {
        token,
        clientId: "http",
        scopes: [],
        extra: { scheme: state.authScheme },
      };
    }

    try {
      return await state.transport.handleRequest(request, authInfo);
    } catch (error) {
      logger.error("HTTP transport error", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};
