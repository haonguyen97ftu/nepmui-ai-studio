export const candidate = '81a1cca134dd797820023d053a98c73e8d21c81d'
export const repository = 'haonguyen97ftu/nepmui-ai-studio'
export const founder = 'haonguyen97ftu'
export const founderId = 140420655
export const requireGate = (ok, message) => { if (!ok) throw new Error(message) }

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
