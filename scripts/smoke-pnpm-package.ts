import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'

assert.ok(process.argv[2], 'Pass the directory containing the package tarballs.')
const packageDirectory = resolve(process.argv[2])
const tarballs = readdirSync(packageDirectory).filter(path => path.endsWith('.tgz') && !path.includes('ripide-tsrx-')).map(path => join(packageDirectory, path))
assert.equal(tarballs.length, 3, 'Pass the core, CLI, and Vue package tarballs.')
const manager = process.env.npm_execpath ?? ''
assert.ok(manager.includes('pnpm'), 'Run this smoke check with pnpm smoke:pnpm-package.')
const cwd = mkdtempSync(join(tmpdir(), 'ripide-pnpm-package-'))
function run(args: string[]) {
  return execFileSync(/\.[cm]?js$/.test(manager) ? process.execPath : manager, [
    ...(/\.[cm]?js$/.test(manager) ? [manager] : []),
    ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

try {
  writeFileSync(join(cwd, 'package.json'), '{"type":"module","private":true}')
  // Resolve only our local release artifacts here. Third-party dependencies
  // retain their published metadata and the unchanged trust policy.
  writeFileSync(join(cwd, 'pnpm-workspace.yaml'), JSON.stringify({
    trustPolicy: 'no-downgrade',
    overrides: Object.fromEntries(tarballs.map(path => [basename(path).replace(/-\d.*$/, ''), path])),
  }))
  run(['add', '--ignore-scripts', '--ignore-pnpmfile', '--reporter=append-only', ...tarballs, 'vue@3.5.44'])
  writeFileSync(join(cwd, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler","allowImportingTsExtensions":true,"skipLibCheck":true},"include":["*.ts","*.vue"]}')
  writeFileSync(join(cwd, 'source.ts'), 'export const shared = 2\n')
  const consumer = 'import { shared } from "./source.ts"\nconsole.log(shared)\n'
  writeFileSync(join(cwd, 'consumer.ts'), consumer)
  writeFileSync(join(cwd, 'View.vue'), '<script setup lang="ts">import { shared } from "./source.ts"</script><template>{{ shared }}</template>\n')
  mkdirSync(join(cwd, 'scripts'))
  writeFileSync(join(cwd, 'scripts/helper.py'), 'import json\nprint(json.dumps({"value": 1}))\n')
  writeFileSync(join(cwd, 'change.patch'), '--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n export const shared = 1\n')
  const preview = JSON.parse(run(['exec', 'ripide', 'rename-file', 'source.ts', 'renamed.ts', '--verify-mode', 'project', '--json', '--profile', 'agent']))
  assert.equal(preview._tag, 'Preview')
  assert.deepEqual(preview.data.changes.map((change: string[]) => change[0]).sort(), ['View.vue', 'consumer.ts'])
  assert.ok(preview.data.verification.some((check: unknown[]) => check[0] === 'vue' && check[1] === 'project' && check[3] === 0))
  assert.ok(preview.data.verification.some((check: unknown[]) => check[0] === 'typescript' && check[1] === 'project' && check[3] === 0))
  assert.equal(readFileSync(join(cwd, 'consumer.ts'), 'utf8'), consumer)
  process.stdout.write('Packed pnpm consumer passed trust checks and verified TypeScript/Vue import preview.\n')
}
finally {
  rmSync(cwd, { recursive: true, force: true })
}
