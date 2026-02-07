#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getBearerHandler, getPersonalAccessTokenHandler, WebApi } from "azure-devops-node-api";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { createAuthenticator } from "./auth.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
//import { configurePrompts } from "./prompts.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";
import { resolveAuthScheme } from "./shared/ado-auth.js";
import type { ConnectionProvider, McpRequestExtra, TokenProvider } from "./shared/mcp-context.js";

function isGitHubCodespaceEnv(): boolean {
  return process.env.CODESPACES === "true" && !!process.env.CODESPACE_NAME;
}

const defaultAuthenticationType = isGitHubCodespaceEnv() ? "azcli" : "interactive";

const envAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const envAllowedHosts = process.env.ALLOWED_HOSTS?.split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const envPortValue = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined;
const defaultHttpPort = Number.isFinite(envPortValue) ? envPortValue! : 3000;

// Parse command line arguments using yargs
const argv = yargs(hideBin(process.argv))
  .scriptName("mcp-server-azuredevops")
  .usage("Usage: $0 <organization> [options]")
  .version(packageVersion)
  .command("$0 <organization> [options]", "Azure DevOps MCP Server", (yargs) => {
    yargs.positional("organization", {
      describe: "Azure DevOps organization name",
      type: "string",
      demandOption: true,
    });
  })
  .option("domains", {
    alias: "d",
    describe: "Domain(s) to enable: 'all' for everything, or specific domains like 'repositories builds work'. Defaults to 'all'.",
    type: "string",
    array: true,
    default: "all",
  })
  .option("authentication", {
    alias: "a",
    describe: "Type of authentication to use",
    type: "string",
    choices: ["interactive", "azcli", "env", "envvar", "pat", "clientsecret"],
    default: defaultAuthenticationType,
  })
  .option("tenant", {
    alias: "t",
    describe: "Azure tenant ID (optional; used by interactive/azcli and as fallback for clientsecret auth)",
    type: "string",
  })
  .option("transport", {
    describe: "Transport type to use",
    type: "string",
    choices: ["stdio", "http"],
    default: "stdio",
  })
  .option("http-port", {
    describe: "Port to bind when using HTTP transport",
    type: "number",
    default: defaultHttpPort,
  })
  .option("http-host", {
    describe: "Host interface to bind when using HTTP transport",
    type: "string",
    default: "0.0.0.0",
  })
  .option("http-path", {
    describe: "Path to serve Streamable HTTP requests on",
    type: "string",
    default: "/mcp",
  })
  .option("http-stateless", {
    describe: "Disable session management for Streamable HTTP",
    type: "boolean",
    default: false,
  })
  .option("http-enable-json-response", {
    describe: "Enable JSON (non-SSE) responses for Streamable HTTP",
    type: "boolean",
    default: false,
  })
  .option("http-allowed-origins", {
    describe: "Allowed Origin header values for DNS rebinding protection",
    type: "string",
    array: true,
    default: envAllowedOrigins ?? [],
  })
  .option("http-allowed-hosts", {
    describe: "Allowed Host header values for DNS rebinding protection",
    type: "string",
    array: true,
    default: envAllowedHosts ?? [],
  })
  .option("http-enable-dns-rebinding-protection", {
    describe: "Enable DNS rebinding protection for Streamable HTTP",
    type: "boolean",
    default: false,
  })
  .help()
  .parseSync();

export const orgName = argv.organization as string;
const orgUrl = "https://dev.azure.com/" + orgName;

const domainsManager = new DomainsManager(argv.domains);
export const enabledDomains = domainsManager.getEnabledDomains();

function getAzureDevOpsClient(getAzureDevOpsToken: TokenProvider, userAgentComposer: UserAgentComposer, authScheme: "bearer" | "pat"): ConnectionProvider {
  return async (extra?: McpRequestExtra) => {
    const accessToken = await getAzureDevOpsToken(extra);
    const authHandler = authScheme === "pat" ? getPersonalAccessTokenHandler(accessToken) : getBearerHandler(accessToken);
    const connection = new WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

async function main() {
  logger.info("Starting Azure DevOps MCP Server", {
    organization: orgName,
    organizationUrl: orgUrl,
    authentication: argv.authentication,
    tenant: argv.tenant,
    domains: argv.domains,
    enabledDomains: Array.from(enabledDomains),
    version: packageVersion,
    isCodespace: isGitHubCodespaceEnv(),
  });

  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };
  const tenantId = (await getOrgTenant(orgName)) ?? argv.tenant;
  const authenticator = createAuthenticator(argv.authentication, tenantId);
  const authScheme = resolveAuthScheme(argv.authentication);

  // removing prompts untill further notice
  // configurePrompts(server);

  const tokenProvider: TokenProvider = async (extra?: McpRequestExtra) => {
    const tokenFromRequest = extra?.authInfo?.token;
    if (tokenFromRequest) {
      return tokenFromRequest;
    }
    if (argv.authentication === "pat") {
      const token = process.env["ADO_MCP_AUTH_TOKEN"];
      if (token) {
        return token;
      }
      throw new Error("Missing Authorization header for PAT authentication and ADO_MCP_AUTH_TOKEN env var.");
    }
    return authenticator();
  };

  const connectionProvider = getAzureDevOpsClient(tokenProvider, userAgentComposer, authScheme);

  configureAllTools(server, tokenProvider, connectionProvider, () => userAgentComposer.userAgent, enabledDomains, authScheme);

  if (argv.transport === "http") {
    const allowedOrigins = argv.httpAllowedOrigins.length > 0 ? argv.httpAllowedOrigins : undefined;
    const allowedHosts = argv.httpAllowedHosts.length > 0 ? argv.httpAllowedHosts : undefined;
    const enableDnsRebindingProtection = argv.httpEnableDnsRebindingProtection || !!allowedOrigins || !!allowedHosts;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: argv.httpStateless ? undefined : () => randomUUID(),
      enableJsonResponse: argv.httpEnableJsonResponse,
      allowedHosts,
      allowedOrigins,
      enableDnsRebindingProtection,
    });
    await server.connect(transport);

    const serverInstance = createServer(async (req, res) => {
      try {
        const url = req.url ? new URL(req.url, `http://${req.headers.host ?? "localhost"}`) : null;
        if (!url || url.pathname !== argv.httpPath) {
          res.writeHead(404).end("Not Found");
          return;
        }
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error("HTTP transport error", error);
        res.writeHead(500).end("Internal Server Error");
      }
    });

    serverInstance.listen(argv.httpPort, argv.httpHost, () => {
      logger.info("Streamable HTTP transport listening", {
        host: argv.httpHost,
        port: argv.httpPort,
        path: argv.httpPath,
        auth: argv.authentication,
      });
    });

    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  logger.error("Fatal error in main():", error);
  process.exit(1);
});
