#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AdapterRegistry } from './registry.js';
import { installShutdownHandlers } from './lifecycle.js';
import { createAveriServer } from './tools.js';
import { packageVersion } from '../util/version.js';

// The stdio entry (the package `bin`, and `npm run dev`) and nothing else:
// build the real registry, build the server from it, connect. Every tool
// lives in mcp/tools.ts, which has no import side effects and is tested
// through an in-memory transport (2026-10-03); this file connects stdio at
// import and therefore stays untestable by import — which is why it holds no
// decision a test would need to reach.
const registry = new AdapterRegistry();
const server = createAveriServer({ registry, version: await packageVersion() });

// Installed before connect — but module init above (the tool registrations,
// the version read) still runs ~100 ms with no handler; a signal there kills
// the process the default way, harmlessly, since no adapter exists yet
// (measured 2026-09-18: handled from ~110 ms). mcp/lifecycle.ts has the policy.
installShutdownHandlers({ dispose: () => registry.shutdown(), close: () => server.close() });

await server.connect(new StdioServerTransport());
