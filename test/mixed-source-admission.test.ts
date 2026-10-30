import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { createEngine } from '../packages/core/src/index.ts'
import { createVueExtension } from '../packages/vue/src/index.ts'

const directories: string[] = []
const foreignSources = {
  'script.py': 'import json\nprint(json.dumps({"value": 1}))\n',
  'change.patch': 'diff --git a/source.ts b/source.ts\n--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n import { shared } from "./source.ts"\n',
  'change.diff': '--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n export const shared = 1\n',
}

function fixture(extra: Record<string, string>) {
  const cwd = mkdtempSync(join(tmpdir(), 'ripide-mixed-source-'))
  directories.push(cwd)
  for (const [path, source] of Object.entries({
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{"compilerOptions":{"noEmit":true,"target":"ES2022","module":"ESNext","moduleResolution":"bundler","allowImportingTsExtensions":true,"skipLibCheck":true},"include":["*.ts","*.vue"]}',
    'source.ts': 'export const shared = 2\nexport function unusedHelper() { return 1 }\n',
    ...extra,
  }))
    writeFileSync(join(cwd, path), source)
  return cwd
}

afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

it.each(Object.entries(foreignSources))('deletes unused TypeScript beside %s without treating its imports as JavaScript', async (path, source) => {
  const cwd = fixture({ [path]: source })
  const engine = createEngine()
  const plan = await engine.delete('unusedHelper', 'source.ts', { cwd, verifyMode: 'project' })
  expect(plan.changes.map(change => change.rel)).toEqual(['source.ts'])
  expect(plan.regressions).toEqual([])
  engine.commit(plan)
  expect(readFileSync(join(cwd, path), 'utf8')).toBe(source)
})

it.each(['.git/metadata.custom', 'ignored/generated.custom'])('omits non-project source %s from extension admission', async (path) => {
  const cwd = fixture({ '.gitignore': 'ignored/\n' })
  execFileSync('git', ['init', '--quiet'], { cwd })
  mkdirSync(join(cwd, path, '..'), { recursive: true })
  const source = 'export const generated = 1\n'
  writeFileSync(join(cwd, path), source)
  const engine = createEngine()
  const plan = await engine.delete('unusedHelper', 'source.ts', { cwd, verifyMode: 'project' })
  expect(plan.changes.map(change => change.rel)).toEqual(['source.ts'])
  expect(plan.regressions).toEqual([])
  engine.commit(plan)
  expect(readFileSync(join(cwd, path), 'utf8')).toBe(source)
})

it('keeps Git internals outside script discovery and verified edits', async () => {
  const cwd = fixture({})
  execFileSync('git', ['init', '--quiet'], { cwd })
  const internal = 'import { shared } from "../source.ts"\nconsole.log(shared)\n'
  writeFileSync(join(cwd, '.git/internal.ts'), internal)
  const engine = createEngine()
  const plan = await engine.rename('shared', 'next', { cwd, scope: 'source.ts', verifyMode: 'project' })
  expect(plan.changes.map(change => change.rel)).toEqual(['source.ts'])
  expect(plan.regressions).toEqual([])
  engine.commit(plan)
  expect(readFileSync(join(cwd, '.git/internal.ts'), 'utf8')).toBe(internal)
})

it('updates TypeScript and Vue imports in a mixed-language project with verification enabled', async () => {
  const cwd = fixture({
    ...foreignSources,
    'consumer.ts': 'import { shared } from "./source.ts"\nconsole.log(shared)\n',
    'View.vue': '<script setup lang="ts">import { shared } from "./source.ts"</script><template>{{ shared }}</template>\n',
  })
  const engine = createEngine({ extensions: [createVueExtension()] })
  const plan = await engine.renameFile('source.ts', 'renamed.ts', { cwd, verifyMode: 'project' })
  expect(plan.regressions).toEqual([])
  expect(plan.changes.map(change => change.rel)).toContain('View.vue')
  engine.commit(plan)
  expect(execFileSync(process.execPath, ['--experimental-strip-types', 'consumer.ts'], { cwd, encoding: 'utf8' })).toBe('2\n')
  const check = await engine.rename('shared', 'next', { cwd, scope: 'renamed.ts', verifyMode: 'project' })
  expect(check.regressions).toEqual([])
  expect(check.changes.map(change => change.rel)).toContain('View.vue')
})

it.each([
  ['View.vue', '<script setup lang="ts">import { shared } from "./source.ts"</script><template>{{ shared }}</template>'],
  ['View.custom', 'import { shared } from "./source.ts"\nexport const value = shared'],
])('still refuses unregistered authored source in %s', async (path, source) => {
  const cwd = fixture({ [path]: source })
  const engine = createEngine()
  await expect(engine.delete('unusedHelper', 'source.ts', { cwd, verifyMode: 'project' })).rejects.toThrow(/Required extension missing/)
  expect(readFileSync(join(cwd, 'source.ts'), 'utf8')).toBe('export const shared = 2\nexport function unusedHelper() { return 1 }\n')
})
