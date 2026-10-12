import { describe, expect, it } from 'vitest'
import { assertReplacementPublished, downloadPublishedPackages, planAutomaticRelease, planRelease, publicationDecision, publishRelease, readPublishedVersions } from '../scripts/release.ts'

const packages = ['ripide-api', 'ripide-vue', 'ripide-tsrx', 'ripide'].map(name => ({ name, version: '0.5.0' }))

describe('automatic release', () => {
  const history = (versions: string[]) => packages.map(pkg => ({ name: pkg.name, versions: [...versions] }))

  it('tags a coordinated version bump at the checked commit', () => {
    expect(planAutomaticRelease(packages, history(['0.4.0']), 'checked-sha', null)).toEqual({ _tag: 'Tag', tag: 'v0.5.0', sha: 'checked-sha' })
  })

  it('skips a version already published for every package', () => {
    expect(planAutomaticRelease(packages, history(['0.5.0']), 'checked-sha', 'release-sha')).toEqual({ _tag: 'Skip' })
  })

  it('retries an existing tag when publication has not completed', () => {
    expect(planAutomaticRelease(packages, history(['0.4.0']), 'checked-sha', 'checked-sha')).toEqual({ _tag: 'Retry', tag: 'v0.5.0', sha: 'checked-sha' })
  })

  it('refuses to replace a tag from another commit', () => {
    expect(() => planAutomaticRelease(packages, history(['0.4.0']), 'checked-sha', 'other-sha')).toThrow('different commit')
  })

  it('rejects a partial version bump', () => {
    expect(() => planAutomaticRelease([{ ...packages[0], version: '0.6.0' }, ...packages.slice(1)], history(['0.4.0']), 'checked-sha', null)).toThrow('must match')
  })

  it('resumes a partially published release', () => {
    const partial = history(['0.4.0'])
    partial[0].versions.push('0.5.0')
    expect(planAutomaticRelease(packages, partial, 'checked-sha', 'checked-sha')).toEqual({ _tag: 'Retry', tag: 'v0.5.0', sha: 'checked-sha' })
  })

  it.each(['0.6.0', '1.0.0', '0.5.1-beta.1'])('rejects a candidate older than published %s', (released) => {
    expect(() => planAutomaticRelease(packages, history([released]), 'checked-sha', null)).toThrow('newer')
  })

  it.each([
    ['0.5.0-beta.10', '0.5.0-beta.2'],
    ['0.5.0-beta.a', '0.5.0-beta.10'],
    ['0.5.0-beta.2.1', '0.5.0-beta.2'],
    ['0.5.0', '0.5.0-rc.1'],
    ['0.10.0', '0.9.0'],
    ['0.5.0', '0.4.0+build.123'],
  ])('accepts %s after %s', (candidate, released) => {
    const bumped = packages.map(pkg => ({ ...pkg, version: candidate }))
    expect(planAutomaticRelease(bumped, history([released]), 'checked-sha', null)).toEqual({ _tag: 'Tag', tag: `v${candidate}`, sha: 'checked-sha' })
  })

  it.each([
    ['0.5.0-beta.2', '0.5.0-beta.10'],
    ['0.5.0-beta.10', '0.5.0-beta.a'],
    ['0.5.0-rc.1', '0.5.0'],
    ['0.5.0-rc.1', '0.5.0+build.123'],
  ])('rejects %s after %s', (candidate, released) => {
    expect(() => planAutomaticRelease(packages.map(pkg => ({ ...pkg, version: candidate })), history([released]), 'checked-sha', null)).toThrow('newer')
  })

  it('checks the release history of every package', () => {
    const divergent = packages.map(pkg => ({ name: pkg.name, versions: [pkg.name === 'ripide-tsrx' ? '0.6.0' : '0.4.0'] }))
    expect(() => planAutomaticRelease(packages, divergent, 'checked-sha', null)).toThrow('newer')
  })
})

describe('published release history', () => {
  it.each(['0.4.0', '0.4.0+build.123'])('reads single-version npm metadata: %s', (version) => {
    for (const stdout of [JSON.stringify(version), JSON.stringify([version])])
      expect(readPublishedVersions(packages, () => ({ status: 0, stdout }))).toEqual(packages.map(pkg => ({ name: pkg.name, versions: [version] })))
  })

  it.each(['[]', '{}', '["invalid"]', '["0.4.0", null]', '["0.4.0+"]', '["0.4.0+build+extra"]', '["0.4.0+build..123"]'])('rejects malformed release history: %s', (stdout) => {
    expect(() => readPublishedVersions(packages, () => ({ status: 0, stdout }))).toThrow(/Invalid/)
  })

  it.each(['E401', 'E503'])('surfaces npm failures: %s', (code) => {
    expect(() => readPublishedVersions(packages, () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }))).toThrow('Registry lookup failed')
  })

  it('requires registration before preparing a release', () => {
    expect(() => readPublishedVersions(packages, () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' }))).toThrow('register')
  })
})

describe('publication registration', () => {
  const artifacts = packages.map(pkg => ({ ...pkg, tarball: `${pkg.name}.tgz`, integrity: 'sha512-local' }))

  it('publishes nothing when a newer version appeared after tag preparation', () => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, (name, field) => field === 'name'
      ? { status: 0, stdout: JSON.stringify(name) }
      : { status: 0, stdout: '["0.6.0"]' }, artifact => published.push(artifact.name), () => {})).toThrow('newer')
    expect(published).toEqual([])
  })

  it('publishes nothing when a later package has never been registered', () => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, (name, field) => {
      if (field === 'name')
        return name === 'ripide-tsrx' ? { status: 1, stdout: '{"error":{"code":"E404"}}' } : { status: 0, stdout: JSON.stringify(name) }
      return { status: 1, stdout: '{"error":{"code":"E404"}}' }
    }, artifact => published.push(artifact.name), () => {})).toThrow('ripide-tsrx')
    expect(published).toEqual([])
  })

  it('checks every artifact before publishing missing versions', () => {
    const published: string[] = []
    publishRelease(artifacts, (name, field) => {
      if (field === 'name')
        return { status: 0, stdout: JSON.stringify([name]) }
      if (field === 'versions')
        return { status: 0, stdout: '["0.4.0"]' }
      return name.startsWith('ripide-api@') ? { status: 0, stdout: '"sha512-local"' } : { status: 1, stdout: '{"error":{"code":"E404"}}' }
    }, artifact => published.push(artifact.name), () => {})
    expect(published).toEqual(['ripide-vue', 'ripide-tsrx', 'ripide'])
  })

  it('publishes nothing when a later artifact differs', () => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, (name, field) => {
      if (field === 'name')
        return { status: 0, stdout: JSON.stringify(name) }
      if (field === 'versions')
        return { status: 0, stdout: '["0.4.0"]' }
      return name.startsWith('ripide-tsrx@') ? { status: 0, stdout: '"sha512-other"' } : { status: 1, stdout: '{"error":{"code":"E404"}}' }
    }, artifact => published.push(artifact.name), () => {})).toThrow('different artifact')
    expect(published).toEqual([])
  })

  it.each(['E401', 'E503'])('publishes nothing when registration lookup returns %s', (code) => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }), artifact => published.push(artifact.name), () => {})).toThrow('Registry lookup failed')
    expect(published).toEqual([])
  })

  it('rejects a registry response for a different package', () => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, () => ({ status: 0, stdout: '"another-package"' }), artifact => published.push(artifact.name), () => {})).toThrow('Registry metadata differs')
    expect(published).toEqual([])
  })

  it('stops publication after a publish operation fails', () => {
    const published: string[] = []
    expect(() => publishRelease(artifacts, (name, field) => field === 'name'
      ? { status: 0, stdout: JSON.stringify(name) }
      : field === 'versions' ? { status: 0, stdout: '["0.4.0"]' } : { status: 1, stdout: '{"error":{"code":"E404"}}' }, (artifact) => {
      if (artifact.name === 'ripide-vue')
        throw new Error('Publication failed')
      published.push(artifact.name)
    }, () => {})).toThrow('Publication failed')
    expect(published).toEqual(['ripide-api'])
  })
})

describe('legacy package deprecation', () => {
  it('requires the replacement release before deprecating legacy packages', () => {
    expect(() => assertReplacementPublished({ status: 0, stdout: '"0.0.0"' }, '0.6.1')).toThrow('replacement release')
    expect(() => assertReplacementPublished({ status: 1, stdout: '{"error":{"code":"E404"}}' }, '0.6.1')).toThrow('replacement release')
    expect(() => assertReplacementPublished({ status: 0, stdout: '"0.6.1"' }, '0.6.1')).not.toThrow()
  })
})

describe('registry download', () => {
  it('waits for processed packages before completing the download', async () => {
    const responses = [
      { status: 1, stdout: '{"error":{"code":"ETARGET"}}' },
      { status: 1, stdout: '{"error":{"code":"E404"}}' },
      { status: 0, stdout: '[]' },
    ]
    let pauses = 0
    await downloadPublishedPackages(() => responses.shift()!, async () => {
      pauses++
    }, 3)
    expect(pauses).toBe(2)
    expect(responses).toEqual([])
  })

  it('stops when processing exceeds the retry limit', async () => {
    let pauses = 0
    await expect(downloadPublishedPackages(
      () => ({ status: 1, stdout: '{"error":{"code":"ETARGET"}}' }),
      async () => { pauses++ },
      2,
    )).rejects.toThrow('not available')
    expect(pauses).toBe(1)
  })

  it.each(['E401', 'E503'])('fails immediately for %s', async (code) => {
    let pauses = 0
    await expect(downloadPublishedPackages(
      () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }),
      async () => { pauses++ },
      3,
    )).rejects.toThrow('download failed')
    expect(pauses).toBe(0)
  })
})

describe('release plan', () => {
  it('publishes matching package versions to latest', () => {
    expect(planRelease('v0.5.0', packages)).toEqual({ version: '0.5.0', npmTag: 'latest' })
  })

  it('keeps prereleases off latest', () => {
    expect(planRelease('v0.6.0-beta.1', packages.map(pkg => ({ ...pkg, version: '0.6.0-beta.1' }))).npmTag).toBe('beta')
  })

  it.each(['main', 'v0.5.0;echo injected', 'v00.5.0', 'v0.5.0-01'])('rejects an invalid release tag: %s', (tag) => {
    expect(() => planRelease(tag, packages)).toThrow('Pass a version tag')
  })

  it('rejects mixed package versions', () => {
    expect(() => planRelease('v0.5.0', [{ ...packages[0], version: '0.4.0' }, ...packages.slice(1)])).toThrow('must match')
  })

  it('rejects missing or duplicate packages', () => {
    expect(() => planRelease('v0.5.0', packages.slice(1))).toThrow('core, Vue, TSRX, and CLI')
    expect(() => planRelease('v0.5.0', [packages[0], packages[0], ...packages.slice(2)])).toThrow('core, Vue, TSRX, and CLI')
  })
})

describe('publication retry', () => {
  it('publishes only a missing version', () => {
    expect(publicationDecision({ status: 1, stdout: '{"error":{"code":"E404"}}' }, 'sha512-local')).toBe('publish')
  })

  it('skips an already published identical artifact', () => {
    expect(publicationDecision({ status: 0, stdout: '"sha512-local"' }, 'sha512-local')).toBe('skip')
  })

  it('accepts the single-version array returned by npm 12', () => {
    expect(publicationDecision({ status: 0, stdout: '["sha512-local"]' }, 'sha512-local')).toBe('skip')
    expect(() => publicationDecision({ status: 0, stdout: '["sha512-local","sha512-other"]' }, 'sha512-local')).toThrow('different artifact')
  })

  it('rejects an existing version with different bytes', () => {
    expect(() => publicationDecision({ status: 0, stdout: '"sha512-other"' }, 'sha512-local')).toThrow('different artifact')
  })

  it('propagates registry outages and authentication failures', () => {
    expect(() => publicationDecision({ status: 1, stdout: '{"error":{"code":"E503"}}' }, 'sha512-local')).toThrow('Registry lookup failed')
    expect(() => publicationDecision({ status: 1, stdout: '{"error":{"code":"E401"}}' }, 'sha512-local')).toThrow('Registry lookup failed')
    expect(() => publicationDecision({ status: null, stdout: '' }, 'sha512-local')).toThrow('Registry lookup failed')
  })
})
