import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectContext } from '../evals/experiment/check-context.ts'
import { gradeProject } from '../evals/experiment/index.ts'

const projects: string[] = []
afterEach(() => projects.splice(0).forEach(project => rmSync(project, { recursive: true, force: true })))

function projectWith(extra: string) {
  const project = mkdtempSync(join(tmpdir(), 'ripide-project-grading-'))
  projects.push(project)
  const source = 'export const value = 1\n'
  writeFileSync(join(project, 'value.ts'), source)
  mkdirSync(dirname(join(project, extra)), { recursive: true })
  writeFileSync(join(project, extra), '{}\n')
  return { project, expected: { 'value.ts': source } }
}

describe('complete-project grading', () => {
  it.each([
    'packages/angular/.angular/cache/22.1.8/ng-packagr/entry.json',
    'packages/angular/.angular/cache/22.1.8/ng-packagr/tsbuildinfo/client.tsbuildinfo',
  ])('accepts build-generated Angular cache: %s', (path) => {
    const { project, expected } = projectWith(path)
    expect(gradeProject(project, expected, projectContext('unhead-real-caller').generated, [])).toEqual({ _tag: 'Passed' })
  })

  it('rejects unexpected files beside the generated cache', () => {
    const { project, expected } = projectWith('packages/angular/.angular/helper.ts')
    expect(gradeProject(project, expected, projectContext('unhead-real-caller').generated, [])).toEqual({
      _tag: 'Failed',
      issues: ['Unexpected file: packages/angular/.angular/helper.ts'],
    })
  })
})
