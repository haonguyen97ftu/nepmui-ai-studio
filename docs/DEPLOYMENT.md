# Authenticated staging on Cloudflare Workers Free

The staging Worker is `nepmui-ai-studio-staging`. It uses a separately provisioned D1 database from `STUDIO_STAGING_D1_ID`, an existing `workers.dev` subdomain, and its own administrator key. The login page is publicly reachable. Every admin data endpoint requires a valid session. The staging configuration and runtime both reject live Messenger ingress and delivery. Use synthetic data only.

## Provision and deploy

Use the approved Cloudflare account on the Workers Free plan and a private cloud shell with Node.js 24. Leave Workers Paid and AI Gateway billing disabled. Run the following from the reviewed feature branch.

```bash
npm ci
npx cf auth login
npx cf auth whoami
npx cf d1 create --name nepmui-ai-studio-staging
export STUDIO_STAGING_D1_ID='<UUID printed for nepmui-ai-studio-staging>'
npx cf d1 migrations list "$STUDIO_STAGING_D1_ID" --mode staging
npx cf d1 migrations apply "$STUDIO_STAGING_D1_ID" --mode staging
npm run build:staging
```

In the private shell, create the staging secret file outside the repository. This generates a 32-byte random key, restricts the file to the current user, and avoids displaying it in terminal output.

```bash
umask 077
export STUDIO_STAGING_SECRETS_FILE="$(mktemp /tmp/nepmui-staging.XXXXXX.json)"
node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeFileSync(process.env.STUDIO_STAGING_SECRETS_FILE,JSON.stringify({ADMIN_SECRET:crypto.randomBytes(32).toString("hex")}))'
```

Transfer the key into the approved password manager without displaying it in a shared terminal. Then run `npm run deploy:staging` and securely remove the temporary file after successful deployment. The command pins staging mode, checks the database ID and secret file, and disables resource provisioning. GitHub Actions builds and tests both modes. The existing `ops/nm-ai-deploy-01` branch also owns `.github/workflows/deploy-staging.yml`: it pins the reviewed release SHA and runs in the `nepmui-staging` environment. Updating `.github/staging-deploy.request` on that branch triggers staging deployment and the hosted benchmark; use the complete 40-character checkout SHA. Production remains a separate approval and release.

## Verify staging

1. Confirm a signed-out request to `/api/knowledge` returns 401. Sign in via the browser and open the Playground, product catalog and knowledge history.
2. Confirm `/api/integrations` returns both flags false while signed in. Submit the mock using a question from synthetic published knowledge or a synthetic catalog item. Repeat the event ID and confirm no duplicate reply. Confirm the live webhook returns 403.
3. In **Mô hình AI**, choose Workers AI and the allowlisted JSON-mode Llama model. Set daily UTC limits such as 20 calls and 4,000 estimated Neurons for the evaluation, subject to account headroom. Spending controls use an atomic pre-inference reservation, plus Cloudflare’s authoritative 10,000-Neuron account-wide Free limit. Other Workers may share that allocation.
4. Run the synthetic Vietnamese benchmark from a private shell, providing `STUDIO_BENCHMARK_URL` and `STUDIO_BENCHMARK_ADMIN_SECRET` through the approved secret store. Run `npm run benchmark:staging`. The script verifies staging, seeds synthetic fixtures in the admin API, scores the result reason, generation method and facts, and deletes fixtures and threads after the run. Synthetic version history is retained. A Vietnamese reviewer should also assess tone, relevance and naturalness in the Playground. Record the model, limits and measured results in the QA report.
5. Confirm the deployed Worker has the daily retention cron. Test manual deletion and retention using synthetic conversations only.

Staging provisioning and deployment are complete through GitHub Actions. See [NM-AI-03 QA evidence](QA_REPORT.md) for actual inference results. Do not reset the D1 usage counters between experiments. Repeated synthetic evaluations may use a temporary bounded staging allocation of 40 calls and 6,000 reserved Neurons, below the application maximum and the account Free allocation; restore 20/4,000 afterward. Reservations remain cumulative and Cloudflare’s account limit remains authoritative. No production deploy, paid upgrade, gateway billing or live Messenger is authorized.

[Cloudflare programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/) · [Cloudflare CLI authentication](https://developers.cloudflare.com/cf/agents/) · [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [Workers AI JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) · [Workers AI Free limits](https://developers.cloudflare.com/workers-ai/platform/pricing/)
