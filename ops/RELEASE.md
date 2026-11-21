# NM-AI-05E private staging release

This operations runbook supersedes the Actions release and marker instructions in the application baseline. Keep the repository private. Actions runs offline CI. The dispatch workflow only points to this runbook and exits. Existing Git history remains available, so removing live credentials from Actions is a prerequisite even after this change lands.

## Readiness states

- **CODE READY** requires CI for the exact application and operations SHAs.
- **ENVIRONMENT READY** requires the checks and setup below, with evidence retained privately.
- **DEPLOYMENT APPROVED** requires an independent exact-SHA QA approval and a fresh Founder-signed approval for one release request. A new request and signature are required after any failed attempt, and a separate request is required for acceptance or restore.

## Founder setup before approval

1. In GitHub, open the repository **Settings → General** and keep visibility **Private**. Confirm **Issues** is enabled under **Features** so requests have a GitHub-authenticated author. Under **Settings → Collaborators and teams**, review write access. Retain only necessary writers. The requester needs a separate GitHub account from the Founder, and the QA reviewer must be separate from the Founder and the application commit author. Record the operations commit author separately from approval. A commit authored by the Founder does not count as approval.
2. Under **Settings → Actions → General → Workflow permissions**, select read-only default permissions and clear **Allow GitHub Actions to create and approve pull requests**. Under **Settings → Environments → nepmui-staging**, check branch restrictions if available and remove live deployment/benchmark secrets from this environment. Check **Settings → Secrets and variables → Actions**, including repository and inherited organization scope. Remove access to all live staging credentials from Actions, including old aliases. Review pending or running jobs on historical refs. If a live value remains accessible to a workflow or an untrusted writer, keep staging on HOLD and obtain explicit remediation authorization. This change does not rotate or replace any existing credential.
3. Use a single trusted Founder-operated machine with a clean shell, Node.js 24, Git with SSH signing, OpenSSH and GitHub CLI. Keep Cloudflare configuration and GitHub login on that machine. For GitHub authenticate with `gh auth login --hostname github.com --web` and confirm the session is the Founder account. Store the Founder signing public key in a canonical, mode-0600 allowed-signers file outside the repository, in the form `haonguyen97ftu namespaces="git" ssh-ed25519 <public-key-base64>`. Independently verify the fingerprint before trusting it. Keep the signing private key and credentials out of GitHub Actions and the repository. Use existing approved credential storage.
4. Provision owner-only, durable and separately located `STAGING_RELEASE_STATE` and `STAGING_RECOVERY_DIR`. Never reset or clone the approval ledger onto a second host. Keep the recovery key in separate protected storage. Configure the machine scheduler to run `node /absolute/reviewed/ops/expire-recovery.mjs` with `STAGING_RECOVERY_DIR` hourly and on boot. It removes only recognized encrypted artifacts at age six days. Verify the job and configure existing storage retention to delete any offline copies by day seven. Keep only the approval record and artifact digest for long-term audit. If durable local state or the retention controls are unavailable, keep staging on HOLD.
5. Supply these values through approved local configuration without printing them.

| Phase | Required settings |
| --- | --- |
| Both | `OPS_DIR`, `APP_DIR`, `STAGING_EXPECTED_OPS_SHA`, `STAGING_APPROVED_CANDIDATE_SHA`, `STAGING_APPROVAL_TAG`, `STAGING_ALLOWED_SIGNERS`, `STAGING_RELEASE_STATE`, `CLOUDFLARE_ACCOUNT_ID`, `STUDIO_STAGING_D1_ID`, `STUDIO_PRODUCTION_D1_ID` |
| Release | `CLOUDFLARE_API_TOKEN`, `STAGING_ADMIN_SECRET`, `STAGING_AUTH_PEPPER`, `STAGING_RECOVERY_KEY`, `STAGING_RECOVERY_DIR`. Preserve existing keys. Optional `STAGING_CHANNEL_ENCRYPTION_KEY` must be distinct. |
| Acceptance | `STAGING_BENCHMARK_EMAIL`, `STAGING_BENCHMARK_PASSWORD`, `STAGING_BENCHMARK_WORKSPACE` for an isolated synthetic Brand Admin |

The Cloudflare token must work only against the intended account/resources to the extent Cloudflare supports scoping. Confirm its scope and the actual production D1 ID against the Cloudflare dashboard. The script checks the pinned staging account, database UUID and Cloudflare name, and rejects a missing, invalid, placeholder or matching production UUID.

## Request, approval and execution

1. Independently review the exact application and operations SHAs. Submit a GitHub **Approve** review on PR #1 for the exact application head using the independent QA account. Record its numeric review ID and both exact successful Actions run IDs. The script verifies the review and both workflow results through GitHub.
2. The separate requester creates an issue in the private repository. The entire body must be JSON with keys `application`, `operations` and `phase` (either `release` or `acceptance`). Do not edit the request after approval. A comment, author name in a commit, workflow dispatch and marker push do not approve release.
3. For release, separately authorize the maintenance window. Disable the staging workers.dev and preview routes and remove its Cron Triggers in **Cloudflare → Workers & Pages → staging Worker → Settings**. In the same view and account, verify no alternate routes, queue or service bindings, or direct D1 writers remain active. Drain mock work through the approved operational process and wait for in-flight executions to finish. Record a private maintenance evidence reference. The runner independently checks disabled workers.dev and previews, zero schedules and custom domains, zero pending mock jobs and stable Time Travel bookmarks/data before migration. These checks cannot certify unknown external writers. Maintain the freeze until the approved deployment.
4. On the Founder machine, use bare new checkouts or clean detached checkouts at the independently reviewed SHAs. Verify both with `git rev-parse HEAD` before executing reviewed code. The Founder prepares an approval JSON outside the repo with these fields:

   - The original `application`, `operations`, and `phase`.
   - Numeric `issue`, `qaReview`, `applicationRun`, and `operationsRun`.
   - GitHub logins `requester` and `author` for the requester and operations commit author.
   - A fresh 32-character lowercase hex `nonce` (generate with `openssl rand -hex 16`), UTC ISO `approvedAt` and `expiresAt` within one hour.
   - For release, `quiescence` containing UTC ISO `checkedAt` and `evidence`, the private maintenance reference. Keep secret and customer data out of the tag.

   Sign and publish only this tag, with SSH signing configured to use the verified Founder key:

   ```sh
   git -C "$OPS_DIR" -c gpg.format=ssh -c "user.signingkey=$FOUNDER_SIGNING_KEY" \
     tag -s -F "$APPROVAL_JSON" "$STAGING_APPROVAL_TAG" "$STAGING_EXPECTED_OPS_SHA"
   git -C "$OPS_DIR" push origin "refs/tags/$STAGING_APPROVAL_TAG"
   node "$OPS_DIR/ops/staging-release.mjs"
   ```

   Set `STAGING_APPROVAL_TAG` to `staging-approval-<nonce>`. Use a new tag for each approval. The runner compares the remote tag object and branch/PR refs, verifies the signature against the local trust root, and atomically reserves both the issue and nonce on the single host. It retains the signed evidence and result metadata. A retry after failure requires a new issue and signature. Review any partial migrations, worker state and recovery artifact first.

5. Release encrypts and durably stores a verified Time Travel bookmark and snapshot before applying the pending ordered 0003–0005 suffix. It verifies the full ledger, preservation, founder guards, usage, FTS and foreign keys before setting the 0005 readiness marker. The deploy helper uses the staging bundle and disables provisioning. Signed-out smoke verifies the candidate identity and disabled live Messenger. A partial release leaves staging in its observed state for operator review.
6. After successful release and founder account setup, request and sign a separate `acceptance` issue. It runs hosted checks with an explicit synthetic workspace selection, the unchanged 13+2 benchmark and model configuration restoration. Verify hosted RBAC, mock behavior and benchmark results separately. Restore requires its own explicit Founder decision and execution procedure.

## Protection and residual risk

GitHub authenticates issue and review authors and provides exact ref and Actions metadata. Git verifies the signed tag against the locally provisioned Founder key. The single host enforces freshness and replay protection. **This is not GitHub Required Reviewers.** The private plan does not enforce an operations branch or tag protection here. A repository writer can attempt to edit workflows, pins or audit artifacts. Such changes cannot match a previous signed operations SHA. Keeping all usable deployment credentials outside Actions is essential. The Founder host, signing key, credential store and local ledger are trusted controls. Loss or rollback of the host ledger, unknown alternate Cloudflare writers and incomplete secret inventory block release. A GitHub tag may be deleted by a writer, so preserve the verified release audit locally.
