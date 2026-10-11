/* eslint-disable no-template-curly-in-string */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { expect, it } from 'vitest'
import { makeFixture } from './helpers.ts'

const cli = resolve('packages/cli/src/cli.ts')
function run(cwd: string, args: string[]) {
  return spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, 'css-custom-property-rename', ...args], { cwd, encoding: 'utf8', env: { ...process.env, RIPIDE_RUN_EXTERNAL_CODE: '1' } })
}

it.each(['TypeScript', 'React', 'Next', 'Solid', 'Vue', 'Nuxt', 'Octane'])('previews and applies custom properties through the CLI in %s', (framework) => {
  const vue = ['Vue', 'Nuxt'].includes(framework)
  const filename = vue ? 'View.vue' : framework === 'Octane' ? 'View.tsrx' : framework === 'TypeScript' ? 'view.ts' : 'view.tsx'
  const templates = 'const template = `--foo-${"a"}`; const uncertain = `--foo-${suffix}`;'
  const bindings = `export const key = "--foo-a"; export const style = { "--foo-a": "red", color: "var(--foo-a)" }; ${templates}`
  const source = vue ? `<script setup>const key = "--foo-a"; ${templates}</script><style>.x { --foo-a: red; color: var(--foo-a) }</style>` : framework === 'Octane' ? `${bindings}\nexport function View() @{ <div style={style} /> }` : framework === 'TypeScript' ? bindings : `${bindings}\nexport const View = () => <div style={{ "--foo-a": "red", color: "var(--foo-a)" }} />;`
  const dependency = { TypeScript: 'typescript', React: 'react', Next: 'next', Solid: 'solid-js', Vue: 'vue', Nuxt: 'nuxt', Octane: 'octane' }[framework]!
  const fx = makeFixture({ [filename]: source, 'package.json': JSON.stringify({ dependencies: { [dependency]: '*' } }) }, false)
  try {
    if (framework === 'Octane') {
      mkdirSync(join(fx.dir, 'node_modules'), { recursive: true })
      symlinkSync(resolve('node_modules/octane'), join(fx.dir, 'node_modules/octane'), 'junction')
    }
    for (const apply of [false, true]) {
      const result = run(fx.dir, ['--json', ...apply ? ['--apply'] : [], '--', '--foo-a', '--theme-b'])
      expect(result.status, result.stderr).toBe(0)
      const payload = JSON.parse(result.stdout)
      expect(payload._tag).toBe(apply ? 'Applied' : 'Preview')
      expect(payload.data.verification).toBeDefined()
      expect(payload.data.warnings).toHaveLength(1)
      expect(payload.data.warnings[0]).toContain('`--foo-${suffix}`')
      expect(payload.data.limitations).toBeDefined()
      expect(readFileSync(`${fx.dir}/${filename}`, 'utf8')).toBe(apply ? source.replaceAll('--foo-a', '--theme-b').replace('`--foo-${"a"}`', '`--theme-b`') : source)
    }
  }
  finally { fx.cleanup() }
})

it('documents the separator and refuses invalid custom property names before apply', () => {
  const fx = makeFixture({ 'theme.css': '.x { --foo-a: red }' }, false)
  try {
    const help = run(fx.dir, ['--help'])
    expect(help.status, help.stderr).toBe(0)
    expect(help.stdout).toContain('Place names after --')
    const invalid = run(fx.dir, ['--apply', '--', '--foo-a', 'invalid'])
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('CSS custom property')
    expect(fx.read('theme.css')).toBe('.x { --foo-a: red }')
  }
  finally { fx.cleanup() }
})

it('keeps dynamic warnings in bounded JSON and complete artifacts', () => {
  const source = Array.from({ length: 60 }, (_, index) => `const p${index} = \`--foo-\${bar${index}}\`;`).join('\n')
  const fx = makeFixture({ 'source.ts': source }, false)
  try {
    const result = run(fx.dir, ['--json', '--max-bytes', '2048', '--artifact', 'evidence.json', '--', '--foo-a', '--theme-b'])
    expect(result.status, result.stderr).toBe(0)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(2048)
    expect(result.stdout).toContain('source.ts:1:')
    expect(result.stdout).toContain('limitations')
    expect(result.stdout).toContain('Variable bindings')
    const artifact = JSON.parse(readFileSync(`${fx.dir}/evidence.json`, 'utf8'))
    expect(JSON.stringify(artifact)).toContain('source.ts:60:')
    expect(JSON.stringify(artifact)).toContain('Variable bindings')
    const page = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, 'page', '--input', 'evidence.json', '--path', '/warnings', '--offset', '59', '--limit', '1'], { cwd: fx.dir, encoding: 'utf8' })
    expect(page.status, page.stderr).toBe(0)
    expect(page.stdout).toContain('source.ts:60:')
    expect(readFileSync(`${fx.dir}/source.ts`, 'utf8')).toBe(source)
  }
  finally { fx.cleanup() }
})

it('surfaces coverage limits and source warnings in bounded agent text', () => {
  const fx = makeFixture({ 'source.ts': 'export const name = `--foo-${suffix}`;' }, false)
  try {
    const result = run(fx.dir, ['--profile', 'agent', '--max-bytes', '2048', '--', '--foo-a', '--theme-b'])
    expect(result.status, result.stderr).toBe(0)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(2048)
    expect(result.stdout).toContain('limitation: Variable bindings')
    expect(result.stdout).toContain('source.ts:1:')
    expect(result.stdout).toContain('`--foo-${suffix}`')
  }
  finally { fx.cleanup() }
})
