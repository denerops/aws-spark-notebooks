import * as esbuild from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
  logLevel: 'info',
  loader: {
    '.css': 'text',
  },
};

/** @type {import('esbuild').BuildOptions} */
const rendererOptions = {
  entryPoints: ['src/renderer/tableRenderer.ts'],
  bundle: true,
  outfile: 'dist/tableRenderer.js',
  format: 'esm',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'info',
  loader: {
    '.css': 'text',
  },
};

async function buildAll() {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(rendererOptions)]);
}

if (watch) {
  const [extensionCtx, rendererCtx] = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(rendererOptions),
  ]);
  await Promise.all([extensionCtx.watch(), rendererCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await buildAll();
}
