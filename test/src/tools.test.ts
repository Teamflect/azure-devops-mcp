// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tool registration wiring", () => {
  it("registers wiki tools in the limited toolset", () => {
    const toolsSource = readFileSync(join(process.cwd(), "src/tools.ts"), "utf8");

    expect(toolsSource).toContain('import { configureWikiTools } from "./tools/wiki.js"');
    expect(toolsSource).toContain("enabledDomains.has(Domain.WIKI)");
    expect(toolsSource).toContain("configureWikiTools(server, tokenProvider, connectionProvider, userAgentProvider, authScheme);");
  });

  it("enables wiki alongside work-items in the worker entrypoint", () => {
    const workerSource = readFileSync(join(process.cwd(), "src/worker.ts"), "utf8");

    expect(workerSource).toContain('new Set(["work-items", "wiki"])');
  });
});
