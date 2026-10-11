/* eslint-disable no-template-curly-in-string */
import { readFileSync } from 'node:fs'
import { createEngine, runCssCustomPropertyRename, writeChanges } from 'ripide-api'
import { createVueExtension } from 'ripide-vue'
import { describe, expect, it } from 'vitest'
import { makeFixture } from './helpers.ts'

const map = new Map([['--foo-a', '--theme-b']])

describe('css custom property rename', () => {
  it.each(['css', 'scss', 'less', 'pcss', 'postcss', 'sass'])('renames declarations and var references in %s without touching other tokens', async (ext) => {
    const source = ext === 'sass'
      ? '.x\n  --foo-a: red\n  color: var(--foo-a)\n  --foo-ab: blue\n  content: "--foo-a"\n  // --foo-a\n'
      : '/* --foo-a */\n.x { --foo-a : red; color: var( /* keep */ --foo-a, var(--foo-ab)); --foo-ab: blue; content: "var(--foo-a)"; }\n@property --foo-a { syntax: "<color>"; }\n'
    const fx = makeFixture({ [`theme.${ext}`]: source }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toBe(source.replace('--foo-a :', '--theme-b :').replace('--foo-a: red', '--theme-b: red').replace('*/ --foo-a,', '*/ --theme-b,').replace('color: var(--foo-a)', 'color: var(--theme-b)').replace('@property --foo-a', '@property --theme-b'))
      expect(result.warnings).toEqual([])
      expect(result.verification).toEqual({ _tag: 'Skipped', reason: 'not-applicable' })
      expect(readFileSync(`${fx.dir}/theme.${ext}`, 'utf8')).toBe(source)
      writeChanges(result.changes)
      expect((await runCssCustomPropertyRename(map, { cwd: fx.dir })).changes).toEqual([])
    }
    finally { fx.cleanup() }
  })

  it('preserves script formatting, exact strings, and complete names beside dynamic values', async () => {
    const source = [
      'export const name = \'--foo-a\';',
      'export const longer = \'--foo-ab\';',
      'export const prose = \'please use --foo-a\';',
      '// var(--foo-a)',
      'export const value = `var(--foo-a, ${fallback})`;',
      'export const embedded = `--foo-a: ${value}; color: var(--foo-a)`;',
      'export const staticName = `--foo-${"a"}`;',
      'export const escaped = \'\\x2d\\x2dfoo-a\';',
    ].join('\n')
    const fx = makeFixture({ 'source.ts': source }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toBe([
        'export const name = \'--theme-b\';',
        'export const longer = \'--foo-ab\';',
        'export const prose = \'please use --foo-a\';',
        '// var(--foo-a)',
        'export const value = `var(--theme-b, ${fallback})`;',
        'export const embedded = `--theme-b: ${value}; color: var(--theme-b)`;',
        'export const staticName = `--theme-b`;',
        'export const escaped = \'--theme-b\';',
      ].join('\n'))
      expect(result.warnings).toEqual([])
    }
    finally { fx.cleanup() }
  })

  it('warns about plausible interpolated names and never rewrites partial names', async () => {
    const source = [
      'const a = `--foo-${bar}`;',
      'const b = `var(--foo-${bar})`;',
      'const c = `--foo-a${suffix}`;',
      'const d = `--other-${bar}`;',
      'const e = css`var(--foo-a)`;',
      'const f = \'--foo-\' + bar;',
      'const g = `--foo-${bar}: red`;',
      'const h = `${prefix}--foo-a`;',
      'const i = `var(${prefix}--foo-a)`;',
    ].join('\n')
    const fx = makeFixture({ 'source.ts': source }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes).toEqual([])
      expect(result.warnings).toHaveLength(8)
      for (const line of [1, 2, 3, 5, 6, 7, 8, 9])
        expect(result.warnings.some(warning => warning.includes(`source.ts:${line}:`) && warning.includes(source.split('\n')[line - 1].slice(10, -1)))).toBe(true)
    }
    finally { fx.cleanup() }
  })

  it('covers both Vue scripts and parsed style blocks through the extension API', async () => {
    const source = '<script>export const name = "--foo-a"</script>\n<script setup lang="ts">const value = `var(--foo-a)`; const uncertain = `--foo-${bar}`</script>\n<template><!-- --foo-a --><p title="--foo-a" /></template>\n<style scoped lang="scss">.x { --foo-a: red; color: var(--foo-a); }</style>'
    const fx = makeFixture({ 'View.vue': source }, false)
    try {
      const engine = createEngine({ extensions: [createVueExtension()] })
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir, engine: engine.services })
      expect(result.changes[0].after).toBe(source.replace('"--foo-a"</script>', '"--theme-b"</script>').replace('`var(--foo-a)`', '`var(--theme-b)`').replace('--foo-a: red', '--theme-b: red').replace('color: var(--foo-a)', 'color: var(--theme-b)'))
      expect(result.warnings[0]).toContain('View.vue:2:')
      expect(result.warnings[0]).toContain('`--foo-${bar}`')
    }
    finally { fx.cleanup() }
  })

  it('applies maps once and rejects invalid names before planning', async () => {
    const fx = makeFixture({ 'theme.css': '.x { --foo-a: var(--theme-b) }' }, false)
    try {
      const result = await runCssCustomPropertyRename(new Map([...map, ['--theme-b', '--final']]), { cwd: fx.dir })
      expect(result.changes[0].after).toBe('.x { --theme-b: var(--final) }')
      await expect(runCssCustomPropertyRename(new Map([['--foo-a', 'bad name']]), { cwd: fx.dir })).rejects.toThrow('custom property')
    }
    finally { fx.cleanup() }
  })

  it('renames proven names across interpolation while preserving unknown values', async () => {
    const fx = makeFixture({ 'source.ts': 'export const css = `var(--foo-${"a"}, ${fallback})`; export const mixed = `var(--foo-a${suffix}) var(--foo-a)`;' }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toBe('export const css = `var(--theme-b, ${fallback})`; export const mixed = `var(--foo-a${suffix}) var(--theme-b)`;')
      expect(result.warnings).toHaveLength(1)
    }
    finally { fx.cleanup() }
  })

  it('proves JavaScript addition before renaming an interpolated name', async () => {
    const fx = makeFixture({ 'source.ts': 'export const key = `--foo-${(1 as number) + 2}`;' }, false)
    try {
      const result = await runCssCustomPropertyRename(new Map([['--foo-12', '--wrong']]), { cwd: fx.dir })
      expect(result.changes).toEqual([])
    }
    finally { fx.cleanup() }
  })

  it.each(['scss', 'less'])('warns about %s property interpolation without rewriting it', async (ext) => {
    const name = ext === 'scss' ? '--foo-#{$suffix}' : '--foo-@{suffix}'
    const fx = makeFixture({ [`theme.${ext}`]: `.x { ${name}: red; color: var(${name}); }` }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes).toEqual([])
      expect(result.warnings).toHaveLength(2)
      expect(result.warnings[0]).toContain(name)
    }
    finally { fx.cleanup() }
  })

  it('leaves module paths, prose, markup, and CSS suffix tokens unchanged', async () => {
    const fx = makeFixture({
      'source.ts': 'import x from "--foo-a"; export { x } from "--foo-a"; const prose = "Please use var(--foo-a)"; const example = "<style>.x { --foo-a: red }</style>";',
      'theme.css': '.x { color: var(--foo-a.suffix); content: "var(--foo-a)"; }',
    }, false)
    try {
      expect((await runCssCustomPropertyRename(map, { cwd: fx.dir })).changes).toEqual([])
    }
    finally { fx.cleanup() }
  })

  it('renames var references in script declaration strings', async () => {
    const fx = makeFixture({ 'source.ts': 'export const cssText = "color: var(--foo-a); background: red";' }, false)
    try {
      expect((await runCssCustomPropertyRename(map, { cwd: fx.dir })).changes[0].after).toBe('export const cssText = "color: var(--theme-b); background: red";')
    }
    finally { fx.cleanup() }
  })

  it('decodes CSS identifier escapes without consuming non-ASCII name characters', async () => {
    const source = `${String.raw`.x { --f\6f o-a: red; color: var(--f\6f o-a); --f\6f`}\u00A0o-a: blue; }`
    const fx = makeFixture({ 'theme.css': source }, false)
    try {
      expect((await runCssCustomPropertyRename(map, { cwd: fx.dir })).changes[0].after).toBe('.x { --theme-b: red; color: var(--theme-b); --f\\6f\u00A0o-a: blue; }')
    }
    finally { fx.cleanup() }
  })

  it('renames complete names in dynamic concatenations and warns about uncertain function prefixes', async () => {
    const fx = makeFixture({
      'source.ts': 'export const css = \'var(--foo-a,\' + fallback + \')\'; export const uncertain = `${prefix}var(--foo-a)`;',
    }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toBe('export const css = \'var(--theme-b,\' + fallback + \')\'; export const uncertain = `${prefix}var(--foo-a)`;')
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain('`${prefix}var(--foo-a)`')
    }
    finally { fx.cleanup() }
  })

  it.each(['scss', 'sass', 'less'])('keeps %s references after an unquoted URL visible', async (ext) => {
    const source = ext === 'sass'
      ? '.x\n  background: url(https://x.invalid/a) var(--foo-a)\n'
      : '.x { background: url(https://x.invalid/a) var(--foo-a); --foo-a: red; }'
    const fx = makeFixture({ [`theme.${ext}`]: source }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toBe(source.replaceAll('--foo-a', '--theme-b'))
      expect(result.warnings).toEqual([])
    }
    finally { fx.cleanup() }
  })

  it('surfaces unsupported CSS query sites and coverage limits for agent review', async () => {
    const fx = makeFixture({ 'theme.css': '@supports (--foo-a: red) { .x { color: var(--foo-a) } }' }, false)
    try {
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir })
      expect(result.changes[0].after).toContain('var(--theme-b)')
      expect(result.warnings[0]).toContain('theme.css:1:12:')
      expect(result.warnings[0]).toContain('--foo-a')
      expect(result.warnings[0]).toContain('query')
      expect(result.limitations.join(' ')).toContain('Variable bindings')
      expect(result.limitations.join(' ')).toContain('glob')
    }
    finally { fx.cleanup() }
  })

  it('surfaces Vue style attributes and JSX quoted style attributes without editing them', async () => {
    const fx = makeFixture({
      'View.vue': '<template><div style="color: var(--foo-a)" :style="{ color: `var(--foo-${suffix})` }" title="--foo-a" /></template>',
      'View.tsx': 'export const View = () => <Box style="color: var(--foo-a)" title="--foo-a" />;',
    }, false)
    try {
      const engine = createEngine({ extensions: [createVueExtension()] })
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir, engine: engine.services })
      expect(result.changes).toEqual([])
      expect(result.warnings).toHaveLength(3)
      expect(result.warnings.some(warning => warning.includes('View.vue:1:') && warning.includes('`var(--foo-${suffix})`'))).toBe(true)
      expect(result.warnings.some(warning => warning.includes('View.tsx:1:') && warning.includes('color: var(--foo-a)'))).toBe(true)
      expect(result.warnings.every(warning => !warning.includes('title='))).toBe(true)
    }
    finally { fx.cleanup() }
  })

  it('reviews encoded Vue style attributes using their decoded values and authored source', async () => {
    const source = '<template><div style="color: var(--foo&#45;a)" :style="{ color: &quot;var(--foo-a)&quot; }" /></template>'
    const fx = makeFixture({ 'View.vue': source }, false)
    try {
      const engine = createEngine({ extensions: [createVueExtension()] })
      const result = await runCssCustomPropertyRename(map, { cwd: fx.dir, engine: engine.services })
      expect(result.changes).toEqual([])
      expect(result.warnings).toHaveLength(2)
      expect(result.warnings[0]).toContain('var(--foo&#45;a)')
      expect(result.warnings[1]).toContain('&quot;var(--foo-a)&quot;')
      expect(fx.read('View.vue')).toBe(source)
    }
    finally { fx.cleanup() }
  })
})
