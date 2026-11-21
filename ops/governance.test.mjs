import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { candidate, consumeApproval, founder, founderId, repository, validateApproval, verifyCI, verifyQA, verifySignedTag } from './governance.mjs'

const ops = 'b'.repeat(40), nonce = 'a'.repeat(32)
const now = Date.parse('2026-11-21T12:30:00Z')
const iso = minutes => new Date(now + minutes * 60000).toISOString()
const request = { application: candidate, operations: ops, phase: 'release' }
const approval = { ...request, issue: 12, requester: 'requester-test', author: 'author-test', nonce,
  approvedAt: iso(-10), expiresAt: iso(20),
  quiescence: { checkedAt: iso(-11), evidence: 'Synthetic maintenance evidence' } }
const issue = { number: 12, state: 'open', body: JSON.stringify(request),
  user: { type: 'User', login: 'requester-test', id: 123 }, created_at: iso(-15), updated_at: iso(-14) }
const fixture = { approval, issue, refs: { application: candidate, operations: ops, tagTarget: ops },
  operator: { login: founder, id: founderId }, app: candidate, ops, tag: 'staging-approval-' + nonce, now }

test('accepts one matching Founder-bound approval and rejects missing or changed identity', () => {
  assert.equal(validateApproval(fixture), 'release')
  for (const operator of [undefined, { login: founder }, { login: 'other', id: founderId }, { login: founder, id: 11 }]) {
    assert.throws(() => validateApproval({ ...fixture, operator }), /identity/)
  }
  assert.throws(() => validateApproval({ ...fixture, issue: { ...issue, user: { login: founder, id: founderId, type: 'User' } } }), /requester/)
})

test('rejects stale evidence, edits, altered SHA, boolean quiescence and tag substitutions', () => {
  for (const patch of [{ now: Date.parse(iso(20)) }, { now: Date.parse(iso(-11)) }, { tag: 'staging-approval-' + 'c'.repeat(32) },
    { refs: { ...fixture.refs, operations: 'c'.repeat(40) } }, { refs: { ...fixture.refs, application: 'c'.repeat(40) } },
    { refs: { ...fixture.refs, tagTarget: 'c'.repeat(40) } }, { issue: { ...issue, updated_at: iso(-3) } },
    { issue: { ...issue, body: JSON.stringify({ ...request, phase: 'acceptance' }) } },
    { approval: { ...approval, quiescence: true } }, { approval: { ...approval, expiresAt: iso(51) } }]) {
    assert.throws(() => validateApproval({ ...fixture, ...patch }))
  }
})

test('checks exact GitHub CI SHA, event, source and workflow', () => {
  const expectation = { sha: ops, path: '.github/workflows/release-pipeline-ci.yml', branch: 'ops/nm-ai-deploy-01', event: 'push' }
  const run = { head_sha: ops, path: expectation.path, head_branch: expectation.branch, event: 'push',
    repository: { full_name: repository }, head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' }
  verifyCI(run, expectation)
  for (const patch of [{ head_sha: candidate }, { conclusion: 'failure' }, { status: 'in_progress' },
    { path: '.github/workflows/deploy-staging.yml' }, { event: 'workflow_dispatch' }, { head_repository: { full_name: 'elsewhere/repo' } }]) {
    assert.throws(() => verifyCI({ ...run, ...patch }, expectation), /did not pass/)
  }
})

test('requires independent QA on the exact app SHA', () => {
  const review = { state: 'APPROVED', commit_id: candidate, user: { type: 'User', id: 501 } }
  verifyQA(review, candidate, 502)
  for (const invalid of [undefined, { ...review, state: 'DISMISSED' }, { ...review, commit_id: ops },
    { ...review, user: { ...review.user, id: founderId } }, { ...review, user: { ...review.user, id: 502 } }]) {
    assert.throws(() => verifyQA(invalid, candidate, 502), /independent/)
  }
  assert.throws(() => verifyQA(review, candidate, undefined), /independent/)
})

test('consumes the issue and nonce once, including concurrent attempts or a new issue with the same nonce', async () => {
  const state = await mkdtemp(join(tmpdir(), 'studio-approval-test-'))
  try {
    const evidence = { approval, phase: 'release', tagObject: 'c'.repeat(40) }
    const outcomes = await Promise.allSettled([consumeApproval(state, evidence), consumeApproval(state, evidence)])
    assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1)
    await assert.rejects(consumeApproval(state, evidence), { code: 'EEXIST' })
    await assert.rejects(consumeApproval(state, { ...evidence, approval: { ...approval, issue: 99 } }), { code: 'EEXIST' })
  } finally { await rm(state, { recursive: true, force: true }) }
})

test('verifies a real SSH signed annotated tag and denies unsigned, tampered or untrusted approvals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-signature-test-')), checkout = join(root, 'checkout')
  try {
    await mkdir(checkout)
    const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    git(['init', '-q'])
    git(['config', 'user.name', 'Synthetic tester'])
    git(['config', 'user.email', 'synthetic@example.test'])
    git(['commit', '--allow-empty', '-qm', 'fixture'])
    const key = join(root, 'fixture-key')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key])
    const publicKey = (await readFile(key + '.pub', 'utf8')).split(' ').slice(0, 2).join(' ')
    const allowed = join(root, 'allowed')
    await writeFile(allowed, `haonguyen97ftu namespaces="git" ${publicKey}\n`, { mode: 0o600 })
    const message = JSON.stringify(approval)
    const tag = fixture.tag, head = git(['rev-parse', 'HEAD'])
    git(['-c', 'gpg.format=ssh', '-c', 'user.signingkey=' + key, 'tag', '-s', '-m', message, tag])
    const result = await verifySignedTag(git, tag, head, allowed, checkout, checkout)
    assert.deepEqual(result.approval, approval)
    git(['tag', '-a', '-m', message, 'unsigned'])
    await assert.rejects(verifySignedTag(git, 'unsigned', head, allowed, checkout, checkout))
    const raw = git(['cat-file', 'tag', result.tagObject]).replace('requester-test', 'tampered-test')
    const corrupted = spawnSync('git', ['hash-object', '-w', '-t', 'tag', '--stdin'], { cwd: checkout, input: raw + '\n', encoding: 'utf8' })
    assert.equal(corrupted.status, 0)
    git(['update-ref', 'refs/tags/' + tag, corrupted.stdout.trim()])
    await assert.rejects(verifySignedTag(git, tag, head, allowed, checkout, checkout))
    git(['update-ref', 'refs/tags/' + tag, result.tagObject])
    const wrongKey = join(root, 'wrong-key')
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', wrongKey])
    const wrongPublic = (await readFile(wrongKey + '.pub', 'utf8')).split(' ').slice(0, 2).join(' ')
    await writeFile(allowed, `haonguyen97ftu namespaces="git" ${wrongPublic}\n`)
    await assert.rejects(verifySignedTag(git, tag, head, allowed, checkout, checkout))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retention removes only eligible expired encrypted envelopes', async () => {
  const { utimes, readdir } = await import('node:fs/promises')
  const { expireRecovery } = await import('./expire-recovery.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'studio-retention-test-'))
  try {
    const stale = join(dir, nonce + '.aes256gcm'), fresh = 'b'.repeat(32) + '.aes256gcm'
    await writeFile(stale, 'synthetic')
    await writeFile(join(dir, fresh), 'synthetic')
    await writeFile(join(dir, 'approval.json'), 'synthetic')
    const old = new Date(Date.now() - 6.5 * 86400000)
    await utimes(stale, old, old)
    await expireRecovery(dir)
    assert.deepEqual((await readdir(dir)).sort(), ['approval.json', fresh])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
