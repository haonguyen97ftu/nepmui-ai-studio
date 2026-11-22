import assert from 'node:assert/strict'
import test from 'node:test'
import { candidate, founderId, repository, verifyCI, verifyQA } from './governance.mjs'

const ops = 'b'.repeat(40)

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
