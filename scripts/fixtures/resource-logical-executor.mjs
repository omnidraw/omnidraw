#!/usr/bin/env node

/**
 * Test executor with no filesystem permission. The physical path is supplied
 * only as an adversarial probe; its usable resource channel carries logical
 * calls and results over stdio.
 */

import { closeSync, openSync } from 'node:fs';
import { createInterface } from 'node:readline';

const dataPath = process.argv[2];
let physicalOpen;
try {
  const descriptor = openSync(dataPath, 'r');
  closeSync(descriptor);
  physicalOpen = { allowed: true, code: null };
} catch (error) {
  physicalOpen = {
    allowed: false,
    code: error && typeof error === 'object' && 'code' in error ? error.code : null,
  };
}

process.stdout.write(`${JSON.stringify({
  type: 'ready',
  pid: process.pid,
  physicalOpen,
})}\n`);

const lines = createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  if (line.length === 0) continue;
  const message = JSON.parse(line);
  if (message.type === 'invoke') {
    process.stdout.write(`${JSON.stringify({
      type: 'resource-call',
      id: message.id,
      call: message.call,
    })}\n`);
    continue;
  }
  if (message.type === 'resource-result') {
    process.stdout.write(`${JSON.stringify({
      type: 'logical-result',
      id: message.id,
      output: message.output,
    })}\n`);
  }
}
