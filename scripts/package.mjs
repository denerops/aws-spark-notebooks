#!/usr/bin/env node
/**
 * Build and package the extension as a .vsix for sharing.
 *
 * Usage:
 *   npm run package
 *   npm run package -- --out ./releases
 *   node scripts/package.mjs [--out DIR] [--pre-release] [--skip-build]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 ? resolve(argv[outIndex + 1]) : join(root, 'releases');
  return {
    outDir,
    preRelease: argv.includes('--pre-release'),
    skipBuild: argv.includes('--skip-build'),
  };
}

function ensureExtensionIcon() {
  const svgPath = join(root, 'media', 'icon.svg');
  const pngPath = join(root, 'media', 'icon.png');
  if (!existsSync(svgPath)) {
    return;
  }

  const needsPng = !existsSync(pngPath);

  if (!needsPng) {
    return;
  }

  const rsvg = process.platform === 'win32' ? 'rsvg-convert.exe' : 'rsvg-convert';
  const which = spawnSync(rsvg, ['--version'], { stdio: 'ignore' });
  if (which.status !== 0) {
    if (!existsSync(pngPath)) {
      console.error(
        'Missing media/icon.png and rsvg-convert is not installed.\n' +
          'Install librsvg (macOS: brew install librsvg) or commit media/icon.png.'
      );
      process.exit(1);
    }
    console.warn('→ Skipping icon.png refresh (rsvg-convert not found).');
    return;
  }

  console.log('→ Generating media/icon.png from icon.svg…');
  run(rsvg, ['-w', '128', '-h', '128', svgPath, '-o', pngPath]);
}

function main() {
  const { outDir, preRelease, skipBuild } = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const vsixPath = join(outDir, `${pkg.name}-${pkg.version}.vsix`);

  console.log(`\nPackaging ${pkg.displayName} v${pkg.version}\n`);

  if (!skipBuild) {
    console.log('→ Building…');
    run('npm', ['run', 'build']);
  }

  ensureExtensionIcon();

  mkdirSync(outDir, { recursive: true });

  const vsceArgs = [
    'package',
    '--out',
    vsixPath,
    '--no-dependencies',
  ];
  if (preRelease) {
    vsceArgs.push('--pre-release');
  }

  console.log(`→ Creating ${vsixPath}…`);
  run('npx', ['@vscode/vsce', ...vsceArgs], {
    env: { ...process.env, UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? '4' },
  });

  console.log(`\nDone: ${vsixPath}\n`);
  console.log('Install on another machine:');
  console.log(`  code --install-extension "${vsixPath}"`);
  console.log('  cursor --install-extension "' + vsixPath + '"');
  console.log('  Or: Extensions sidebar → ⋯ → Install from VSIX…\n');
}

main();
