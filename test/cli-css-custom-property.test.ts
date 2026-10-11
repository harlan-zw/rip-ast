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
  const bindings = 'export const key = "--foo-a"; export const style = { "--foo-a": "red", color: "var(--foo-a)" };'
  const source = vue ? '<script setup>const key = "--foo-a"</script><style>.x { --foo-a: red; color: var(--foo-a) }</style>' : framework === 'Octane' ? `${bindings}\nexport function View() @{ <div style={style} /> }` : framework === 'TypeScript' ? bindings : `${bindings}\nexport const View = () => <div style={{ "--foo-a": "red", color: "var(--foo-a)" }} />;`
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
      expect(readFileSync(`${fx.dir}/${filename}`, 'utf8')).toBe(apply ? source.replaceAll('--foo-a', '--theme-b') : source)
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
    const artifact = JSON.parse(readFileSync(`${fx.dir}/evidence.json`, 'utf8'))
    expect(JSON.stringify(artifact)).toContain('source.ts:60:')
    expect(readFileSync(`${fx.dir}/source.ts`, 'utf8')).toBe(source)
  }
  finally { fx.cleanup() }
})
