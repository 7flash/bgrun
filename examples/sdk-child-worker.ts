#!/usr/bin/env bun

const childName = process.argv[2] || process.env.BGR_PROCESS_NAME || 'sdk-child-worker';

console.log(
  `[sdk-child-worker] ${childName} started. parent=${process.env.BGR_PARENT_NAME || '(none)'}`,
);

setInterval(() => {
  console.log(`[sdk-child-worker] ${childName} heartbeat ${new Date().toISOString()}`);
}, 5_000);
