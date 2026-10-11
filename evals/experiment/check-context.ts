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
  const context = scope === 'projects' ? projectContext(scenario.id) : { args: [], testPath: '.checks/proof.test.ts' }
  const args = context.args.join(' ')
  if (variant === 'guided') {
    const direct = `Use vitest. Write ${context.testPath} with explicit imports. Run vitest run ${context.testPath} ${args} --reporter=json --outputFile=.checks/red.json. After repair, save green.json. Delete the temporary module. Preserve existing tests.`
    const forced = `Pipe TypeScript assertions to ripide check ${scenario.symbol} --from ${scenario.from} ${args} --json --artifact .checks/red.json. For green, add --base HEAD and save .checks/green.json. Missing ${scenario.symbol}, test, expect, and vi imports are automatic. Wrap assertions in test(). Relative imports and mocks resolve beside ${scenario.from}.`
    const choice = mode === 'direct' ? `${direct} Do not use ripide.` : mode === 'forced' ? `${forced} Do not create test modules.` : `Choose Vitest or Ripide. ${direct} ${forced}`
    const evidence = mode === 'direct' ? '' : 'If you use Ripide, inspect artifacts with ripide page --input .checks/green.json. Select fields from its root menu. Artifact and stdout JSON can have different roots. Green records repaired-function execution. API and integration obligations still need assertion review.'
    const caller = scenario.file === scenario.from ? `Read ${scenario.file}.` : `Read ${scenario.file} and its caller ${scenario.symbol} in ${scenario.from}.`
    return `${choice}\n${caller} Build fixtures from these functions. Save assertions in .checks/assertions.txt. Run failing assertions before editing. Fix collection errors first. If assertions change, repeat red against the seed. Reuse identical assertions for green.\n${evidence}\nUse fresh artifact paths. Keep other temporary helpers in .checks. Remove authored code helpers before final green. For Vitest, recreate the temporary module, run green, then delete it. Retain assertions.txt, red.json, and green.json for controller evidence validation. Finish with check-behavior, without flags. If it fails, fix the reported behavior or rerun genuine missing evidence. Never edit receipts. Preserve source signatures and unrelated files. Do not read external repositories or harness files. Give a brief result.`
  }
  const direct = `Use the supplied vitest executable. Write ${context.testPath} with explicit imports. Run vitest run ${context.testPath} ${args} --reporter=json --outputFile=.checks/red.json. Save green.json after repair. Delete your test module. Preserve existing tests.`
  const forced = `Use ripide check ${scenario.symbol} --from ${scenario.from} ${args} --base HEAD --json --artifact .checks/red.json with TypeScript on stdin. Save green.json after repair. The CLI imports missing ${scenario.symbol}, test, expect, and vi bindings. Wrap assertions in test(). Relative imports and mocks resolve beside the selected source file. Remove existing artifacts before reusing paths. Do not create test modules.`
  const choice = mode === 'direct' ? `${direct} Do not use ripide.` : mode === 'forced' ? forced : `Choose one workflow. ${direct} Or: ${forced}`
  const guide = 'Use identical assertions for the failing and passing runs.'
  const summary = ''
  return `${choice}\n${guide}\n${summary}\nRemove existing artifacts before reusing paths. Keep assertions in .checks/assertions.txt. Only .checks may hold other temporary helpers. Remove every authored code helper before the final green run. Reuse assertions.txt for that run. For Vitest, recreate only the required temporary test module, then delete it after green. Finish by running check-behavior. Do not read external repositories or harness files. Give a brief result.`
}
