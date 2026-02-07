// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { setLogLevel, AzureLogLevel } from "@azure/logger";

type Level = "error" | "warning" | "info" | "debug" | "verbose";

const ORDER: Record<Level, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

function normalizeLevel(input?: string): Level {
  const level = input?.toLowerCase();
  if (level === "error" || level === "warning" || level === "info" || level === "debug" || level === "verbose") {
    return level;
  }
  if (level === "warn") {
    return "warning";
  }
  return "info";
}

const configuredLevel = normalizeLevel(typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined);
setLogLevel((configuredLevel === "debug" ? "info" : configuredLevel) as AzureLogLevel);

function normalizeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  return arg;
}

function write(level: Level, message: string, args: unknown[]): void {
  if (ORDER[level] > ORDER[configuredLevel]) {
    return;
  }

  const payload: Record<string, unknown> = {
    level,
    timestamp: new Date().toISOString(),
    message,
  };

  const normalized = args.map(normalizeArg);
  const objectArgs = normalized.filter((item) => typeof item === "object" && item !== null && !Array.isArray(item));
  for (const item of objectArgs) {
    Object.assign(payload, item as Record<string, unknown>);
  }

  const scalarArgs = normalized.filter((item) => typeof item !== "object" || item === null || Array.isArray(item));
  if (scalarArgs.length > 0) {
    payload.extra = scalarArgs;
  }

  // Always route logs to stderr to keep stdio MCP output clean in CLI mode.
  console.error(JSON.stringify(payload));
}

export const logger = {
  error(message: string, ...args: unknown[]): void {
    write("error", message, args);
  },
  warn(message: string, ...args: unknown[]): void {
    write("warning", message, args);
  },
  info(message: string, ...args: unknown[]): void {
    write("info", message, args);
  },
  debug(message: string, ...args: unknown[]): void {
    write("debug", message, args);
  },
  verbose(message: string, ...args: unknown[]): void {
    write("verbose", message, args);
  },
};
