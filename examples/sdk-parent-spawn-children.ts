#!/usr/bin/env bun

import bgrun from '../src/api.ts';

const parentName = process.env.BGR_PROCESS_NAME || 'sdk-parent-demo';
const directory = process.cwd();

const children = [
  'sdk-parent-demo-child-a',
  'sdk-parent-demo-child-b',
];

for (const childName of children) {
  await bgrun.handleRun({
    action: 'run',
    name: childName,
    directory,
    command: `bun run ./examples/sdk-child-worker.ts ${childName}`,
    env: {
      BGR_KEEP_ALIVE: 'false',
      // Optional explicit parent tag. When this script itself is launched by
      // bgrun, handleRun also auto-fills this from BGR_PROCESS_NAME.
      BGR_PARENT_NAME: parentName,
    },
    remoteName: '',
  });
}

console.log(`[sdk-parent] ${parentName} spawned ${children.length} managed children.`);
console.log(`[sdk-parent] Try: bun run src/index.ts --stop ${parentName}`);

setInterval(() => {
  console.log(`[sdk-parent] heartbeat ${new Date().toISOString()}`);
}, 5_000);
