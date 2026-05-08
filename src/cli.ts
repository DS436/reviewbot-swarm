#!/usr/bin/env node
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env') });

import { orchestrate } from './agents/orchestrator';

async function main(): Promise<void> {
  const prUrl = process.argv[2];

  if (!prUrl) {
    console.error('Usage: review <PR_URL>');
    console.error('Example: review https://github.com/owner/repo/pull/42');
    process.exit(1);
  }

  if (!prUrl.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)) {
    console.error(`Error: Invalid GitHub PR URL: ${prUrl}`);
    console.error('Expected format: https://github.com/owner/repo/pull/42');
    process.exit(1);
  }

  try {
    await orchestrate(prUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Error: ${message}`);
    process.exit(1);
  }
}

main();
