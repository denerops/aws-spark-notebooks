/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      { preset: 'conventionalcommits' },
    ],
    ['@semantic-release/npm', { npmPublish: false }],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'npm run build && npm run package -- --skip-build',
        publishCmd:
          '[ -n "$VSCE_PAT" ] && npx @vscode/vsce publish --no-dependencies --packagePath releases/emr-serverless-pyspark-${nextRelease.version}.vsix || echo "Skipping VS Code Marketplace publish: VSCE_PAT not set"',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message:
          'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          {
            path: 'releases/*.vsix',
            label: 'VSIX (Install in VS Code / Cursor)',
          },
        ],
      },
    ],
  ],
};
