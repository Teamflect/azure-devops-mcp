// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import winston from "winston";
import { setLogLevel, AzureLogLevel } from "@azure/logger";

const logLevel = process.env.LOG_LEVEL?.toLowerCase();
if (logLevel && ["verbose", "debug", "info", "warning", "error"].includes(logLevel)) {
  // Map Winston log levels to Azure log levels
  const logLevelMap: Record<string, AzureLogLevel> = {
    verbose: "verbose",
    debug: "info",
    info: "info",
    warning: "warning",
    error: "error",
  };

  const azureLogLevel: AzureLogLevel = logLevelMap[logLevel];
  setLogLevel(azureLogLevel);
}

/**
 * Logger utility for MCP server
 *
 * Since MCP servers use stdio transport for communication on stdout,
 * we log to stderr to avoid interfering with the MCP protocol.
 */

export const logger = winston.createLogger({
  level: (typeof process !== "undefined" && process.env?.LOG_LEVEL) || "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports: [
    // Keep MCP stdout clean by routing all logs to stderr.
    new winston.transports.Console({
      stderrLevels: ["error", "warn", "info", "http", "verbose", "debug", "silly"],
    }),
  ],
  // Prevent Winston from exiting on error
  exitOnError: false,
});
