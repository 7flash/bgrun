console.log("Starting build process for bgrun...");

const entrypoints = [
  './src/index.ts',
  './src/api.ts',
  './src/server.ts',
  './src/deploy.ts',
  './src/deps.ts',
  './src/log-rotation.ts',
];
const result = await Bun.build({
  entrypoints,
  outdir: './dist',
  target: 'bun',
  format: 'esm',
  minify: false,
  // Mark all packages as external to rely on node_modules
  // This avoids bundling native modules or mismatched React versions
  packages: "external",
});

if (!result.success) {
  console.error("Build failed");
  for (const message of result.logs) {
    console.error(message);
  }
  process.exit(1);
}

const builtFiles = result.outputs.map((output) => output.path.split(/[\\/]/).pop()).filter(Boolean);
console.log(`Build successful! Artifacts: ${builtFiles.join(', ')}`);