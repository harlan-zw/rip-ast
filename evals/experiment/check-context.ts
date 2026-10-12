import type { CheckCase } from './check-cases.ts'

export function checkPrompt(scenario: CheckCase): string {
  return `${scenario.prompt}\nRepair source: ${scenario.file}.\nSelected export: ${scenario.symbol}. Source: ${scenario.from}.`
}

export function projectContext(id: string) {
  if (id === 'link-checker-concurrency') {
    return {
      args: ['--project', 'unit'],
      testPath: 'test/unit/transient-eval.test.ts',
      prepare: [['pnpm', 'exec', 'nuxt-module-build', 'build', '--stub'], ['pnpm', 'exec', 'nuxt-module-build', 'prepare']],
      checks: [['pnpm', 'build'], ['pnpm', 'typecheck']],
      generated: ['dist', 'playground/.nuxt', 'playground/node_modules', '.nuxt'],
    }
  }
  if (id === 'unhead-real-caller') {
    const typecheck = ['pnpm', 'typecheck', '--incremental', '--tsBuildInfoFile', '.checks/types.tsbuildinfo']
    return {
      args: ['--config', 'packages/unhead/vitest.config.ts'],
      testPath: 'packages/unhead/test/transient-eval.test.ts',
      prepare: [],
      checks: [['pnpm', 'build'], typecheck],
      generated: [...['angular', 'bundler', 'cli', 'devtools', 'dom', 'eslint-plugin', 'react', 'schema-org', 'shared', 'solid-js', 'ssr', 'svelte', 'unhead', 'vue', 'devtools-app'].map(name => `packages/${name}/dist`), 'packages/angular/.angular/cache'],
    }
  }
  throw new Error('Choose a registered check case.')
}

export function workflowInstructions(mode: string, scenario: CheckCase, scope: string, variant: string): string {
  if (variant === 'guided') {
    if (mode === 'hybrid')
      return 'Run check-workflow vitest or check-workflow ripide. Select one runner before writing assertions. Follow only the returned recipe.'
    const context = scope === 'projects' ? projectContext(scenario.id) : { args: [], testPath: '.checks/proof.test.ts' }
    const args = context.args.join(' ')
    const recipe = mode === 'direct'
      ? `Write ${context.testPath} with explicit imports. Run vitest run ${context.testPath} ${args} --reporter=json --outputFile=.checks/red.json. Repeat with .checks/green.json after repair. Delete the temporary module.`
      : `Run ripide check ${scenario.symbol} --from ${scenario.from} ${args} --json --artifact .checks/red.json with TypeScript on stdin. Wrap assertions in test(). The CLI imports missing ${scenario.symbol}, test, expect, and vi bindings. Relative imports resolve beside ${scenario.from}. Repeat with --base HEAD --artifact .checks/green.json after repair. Do not create test modules.`
    const fixtures = scenario.id === 'unhead-real-caller'
      ? 'Use walkResolver({ prototype: "unsafe", safe: 2 }) and expect { safe: 2 }. Use JSON.parse(\'{"__proto__":{"polluted":true},"safe":2}\') for an own __proto__ key. Test constructor directly with isUnsafeKey("constructor"). Import isUnsafeKey from its source for this check. A constructor property excludes an object from caller traversal.'
      : 'Use deterministic promise gates to check worker overlap. Mock console.error when checking callback errors.'
    return `${recipe}\nRead the selected function and real caller. ${fixtures}\nKeep identical assertions for red and green. Correct collection errors before editing source. If assertions change, repeat red against the seed. Each execution captures assertions and a fresh report outside the project. Retry the same command after correction. Keep red.json and green.json. Remove authored code helpers before final green. Finish with check-behavior without flags. Preserve unrelated files and existing tests. Do not read external repositories or harness files.`
  }
  const context = scope === 'projects' ? projectContext(scenario.id) : { args: [], testPath: '.checks/proof.test.ts' }
  const args = context.args.join(' ')
  const direct = `Use the supplied vitest executable. Write ${context.testPath} with explicit imports. Run vitest run ${context.testPath} ${args} --reporter=json --outputFile=.checks/red.json. Save green.json after repair. Delete your test module. Preserve existing tests.`
  const forced = `Use ripide check ${scenario.symbol} --from ${scenario.from} ${args} --base HEAD --json --artifact .checks/red.json with TypeScript on stdin. Save green.json after repair. The CLI imports missing ${scenario.symbol}, test, expect, and vi bindings. Wrap assertions in test(). Relative imports and mocks resolve beside the selected source file. Remove existing artifacts before reusing paths. Do not create test modules.`
  const choice = mode === 'direct' ? `${direct} Do not use ripide.` : mode === 'forced' ? forced : `Choose one workflow. ${direct} Or: ${forced}`
  const guide = variant === 'guided' ? 'Read the selected function and real caller first. Choose assertions from the requested behavior. Keep one assertion source in .checks/assertions.txt. Reuse it unchanged for red and green. A collection error is not a failing assertion. Fix collection errors before changing source. If assertions are wrong, correct them and repeat red before repairing. Run only your temporary module. For ripide, omit automatic imports unless another symbol is needed. Use the full artifact only when short errors lack detail.' : 'Use identical assertions for the failing and passing runs.'
  const summary = variant === 'guided' && mode !== 'direct' ? 'If you used ripide, finish with ripide check --base HEAD --json. Report executed counts separately from pending API and integration review.' : ''
  return `${choice}\n${guide}\n${summary}\nRemove existing artifacts before reusing paths. Keep assertions in .checks/assertions.txt. Only .checks may hold other temporary helpers. Remove every authored code helper before the final green run. Reuse assertions.txt for that run. For Vitest, recreate only the required temporary test module, then delete it after green. Finish by running check-behavior. Do not read external repositories or harness files. Give a brief result.`
}
