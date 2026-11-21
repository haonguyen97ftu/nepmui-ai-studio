import { execFileSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

export const candidate = '81a1cca134dd797820023d053a98c73e8d21c81d'
export const repository = 'haonguyen97ftu/nepmui-ai-studio'
export const founder = 'haonguyen97ftu'
export const founderId = 140420655
const sha = /^[a-f0-9]{40}$/
export const requireGate = (ok, message) => { if (!ok) throw new Error(message) }

export function validateApproval({ approval, issue, refs, operator, app, ops, tag, now = Date.now() }) {
  requireGate(operator?.id === founderId && operator.login === founder, 'Founder GitHub identity is required.')
  requireGate(sha.test(app ?? '') && sha.test(ops ?? '') && approval.application === app && approval.operations === ops &&
    refs.application === app && refs.operations === ops && refs.tagTarget === ops,
  'Approval, request and immutable release refs must match.')
  requireGate(Number.isSafeInteger(approval.issue) && approval.issue > 0 && issue?.number === approval.issue &&
    issue.state === 'open' && !issue.pull_request && issue.user?.type === 'User' &&
    Number.isSafeInteger(issue.user.id) && issue.user.id !== founderId &&
    issue.user.login && issue.user.login === approval.requester, 'A separate authenticated requester is required.')
  let request
  try { request = JSON.parse(issue.body) } catch { throw new Error('The release issue must contain the exact JSON request.') }
  requireGate(request.application === app && request.operations === ops && request.phase === approval.phase &&
    ['release', 'acceptance'].includes(approval.phase), 'The GitHub request does not match this approval.')
  requireGate(/^[a-f0-9]{32}$/.test(approval.nonce ?? '') && tag === 'staging-approval-' + approval.nonce,
    'The signed approval nonce does not match the tag.')
  const approved = Date.parse(approval.approvedAt), expires = Date.parse(approval.expiresAt)
  const requested = Date.parse(issue.created_at), edited = Date.parse(issue.updated_at)
  requireGate(Number.isFinite(requested) && Number.isFinite(edited) && requested <= approved && edited <= approved &&
    approved <= now && now < expires && expires - approved <= 60 * 60 * 1000, 'Release approval is stale, future-dated or invalid.')
  if (approval.phase === 'release') {
    requireGate(approval.quiescence?.checkedAt && Date.parse(approval.quiescence.checkedAt) >= requested &&
      Date.parse(approval.quiescence.checkedAt) <= approved && now - Date.parse(approval.quiescence.checkedAt) <= 30 * 60 * 1000 &&
      typeof approval.quiescence.evidence === 'string' && approval.quiescence.evidence.trim().length >= 16,
    'A fresh, signed maintenance evidence reference is required.')
  }
  return approval.phase
}

export function verifyCI(run, { sha: expected, path, branch, event }) {
  requireGate(run?.head_sha === expected && run.path === path && run.head_branch === branch && run.event === event &&
    run.status === 'completed' && run.conclusion === 'success' && run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository, 'Exact required GitHub Actions run did not pass.')
}

export function verifyQA(review, app, submittedBy) {
  requireGate(review?.state === 'APPROVED' && review.commit_id === app &&
    review.user?.type === 'User' && Number.isSafeInteger(review.user.id) &&
    Number.isSafeInteger(submittedBy) && review.user.id !== founderId && review.user.id !== submittedBy,
  'An independent GitHub QA approval on the exact application SHA is required.')
}

function shell(command, args, cwd) {
  // Keep credentials supplied by the local credential store out of error messages.
  try { return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' } }).trim() }
  catch { throw new Error('Could not verify required Git or GitHub release evidence.') }
}

export async function privatePath(path, ...checkouts) {
  requireGate(isAbsolute(path ?? ''), 'A private absolute path is required.')
  const resolved = await realpath(path)
  requireGate(path === resolved, 'Use a canonical private path without symlinks.')
  for (const checkout of checkouts) {
    const location = relative(await realpath(checkout), resolved)
    requireGate(location.startsWith('../') || isAbsolute(location), 'Private release files must live outside checkouts.')
  }
  const mode = await lstat(path)
  requireGate(!mode.isSymbolicLink() && (mode.mode & 0o077) === 0 &&
    (typeof process.getuid !== 'function' || mode.uid === process.getuid()), 'Release state must be owner-only.')
  return mode
}

export async function verifySignedTag(git, tag, ops, allowed, opsDir, appDir) {
  const trust = await privatePath(allowed, opsDir, appDir)
  requireGate(trust.isFile(), 'A private Founder SSH allowed-signers file is required.')
  requireGate(/^haonguyen97ftu namespaces="git" ssh-ed25519 [a-zA-Z0-9+/=]+\s*$/.test(await readFile(allowed, 'utf8')),
    'The signing trust root must contain only the provisioned Founder SSH signing key.')
  git(['-c', 'gpg.format=ssh', '-c', 'gpg.ssh.allowedSignersFile=' + allowed,
    '-c', 'gpg.ssh.program=ssh-keygen', 'verify-tag', tag])
  const tagObject = git(['rev-parse', tag + '^{tag}'])
  const raw = git(['cat-file', 'tag', tagObject])
  const signed = raw.indexOf('\n-----BEGIN SSH SIGNATURE-----')
  requireGate(signed > 0, 'A signed annotated SSH approval tag is required.')
  const approval = JSON.parse(raw.slice(raw.indexOf('\n\n') + 2, signed))
  requireGate(raw.split('\n').includes('tag ' + tag) && raw.split('\n').includes('type commit') &&
    raw.split('\n')[0] === 'object ' + ops, 'The signed tag object does not directly identify the operations commit.')
  return { approval, tagObject, signedTag: raw }
}

export async function verifyGitHub(env, app) {
  const ops = env.STAGING_EXPECTED_OPS_SHA, tag = env.STAGING_APPROVAL_TAG
  requireGate(!env.GITHUB_ACTIONS && !env.GITHUB_EVENT_NAME, 'Hosted release is disabled in GitHub Actions.')
  requireGate(sha.test(ops ?? '') && /^staging-approval-[a-f0-9]{32}$/.test(tag ?? '') &&
    isAbsolute(env.OPS_DIR ?? '') && isAbsolute(env.APP_DIR ?? ''), 'Exact operations SHA, approval tag and clean checkouts are required.')
  const git = (args, dir = env.OPS_DIR) => shell('git', args, dir)
  for (const [dir, expected] of [[env.OPS_DIR, ops], [env.APP_DIR, app]]) {
    requireGate(git(['rev-parse', 'HEAD'], dir) === expected && git(['status', '--porcelain', '--untracked-files=all'], dir) === '',
      'Release checkouts must match the approved clean SHAs.')
  }
  const { approval, tagObject, signedTag } = await verifySignedTag(git, tag, ops, env.STAGING_ALLOWED_SIGNERS, env.OPS_DIR, env.APP_DIR)
  const gh = path => JSON.parse(shell('gh', ['api', '--hostname', 'github.com', path], env.OPS_DIR))
  const api = path => gh('repos/' + repository + '/' + path)
  const operator = gh('user')
  const issue = api('issues/' + (Number.isSafeInteger(approval.issue) ? approval.issue : 0))
  const remoteTag = api('git/ref/tags/' + tag)
  requireGate(remoteTag.object?.type === 'tag' && remoteTag.object.sha === tagObject, 'Signed approval tag must be published unchanged on GitHub.')
  const refs = {
    application: api('pulls/1').head?.sha,
    operations: api('git/ref/heads/ops/nm-ai-deploy-01').object?.sha,
    tagTarget: git(['rev-parse', tag + '^{commit}']),
  }
  const phase = validateApproval({ approval, issue, refs, operator, app, ops, tag })
  for (const [id, expected, path, branch, event] of [
    [approval.applicationRun, app, '.github/workflows/ci.yml', 'feat/nepmui-studio-mvp', 'pull_request'],
    [approval.operationsRun, ops, '.github/workflows/release-pipeline-ci.yml', 'ops/nm-ai-deploy-01', 'push'],
  ]) {
    requireGate(Number.isSafeInteger(id) && id > 0, 'An exact CI run ID is required.')
    verifyCI(api('actions/runs/' + id), { sha: expected, path, branch, event })
  }
  requireGate(Number.isSafeInteger(approval.qaReview) && approval.qaReview > 0, 'An exact independent QA review ID is required.')
  const review = api('pulls/1/reviews/' + approval.qaReview)
  verifyQA(review, app, api('commits/' + app).author?.id)
  const reviewPages = JSON.parse(shell('gh', ['api', '--hostname', 'github.com', '--paginate', '--slurp',
    'repos/' + repository + '/pulls/1/reviews?per_page=100'], env.OPS_DIR))
  const latest = reviewPages.flat().filter(item => item.user?.id === review.user.id &&
    ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(item.state)).at(-1)
  requireGate(latest?.id === review.id, 'The signed QA review was superseded.')

  const author = api('commits/' + ops).author?.login
  requireGate(author && approval.author === author, 'Operations commit author must be recorded in the approval.')
  return { approval, phase, tagObject, signedTag, approver: { login: founder, id: founderId } }
}

export async function consumeApproval(state, evidence) {
  const { approval, phase } = evidence
  // A single Founder host owns this durable ledger. A failed attempt consumes its request too.
  await mkdir(join(state, String(approval.issue)), { mode: 0o700 })
  const attempt = join(state, String(approval.issue))
  await writeFile(join(state, approval.nonce + '.nonce'), String(approval.issue), { mode: 0o600, flag: 'wx', flush: true })
  await writeFile(join(attempt, 'approval.json'), JSON.stringify({ ...evidence, consumedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx', flush: true })
  requireGate(phase === approval.phase, 'Invalid release phase.')
  return attempt
}
