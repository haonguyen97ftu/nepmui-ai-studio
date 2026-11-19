# Cloud deployment

CI runs on GitHub Actions and publishes test and screenshot artifacts. Production is a manual release from an approved cloud shell. The repository contains no production deployment workflow.

## Verify and provision after founder approval

1. Use a Cloudflare Workers Free account and its existing `workers.dev` subdomain. Use an authenticated cloud workspace shell with Node.js 24 and the reviewed release checked out. Do not enable Workers Paid or AI Gateway billing.
2. Run `npm ci` and reproduce GitHub CI checks. Sign in using `npx cf auth login` or use a short-lived least-privilege token from a cloud secret store. Do not place it in the repo or command history.
3. Create the D1 database and export the returned UUID in the shell. Apply the migration to that database.

   ```bash
   npx cf d1 create --name nepmui-ai-studio
   export STUDIO_D1_ID='<database-uuid>'
   npx cf d1 migrations list "$STUDIO_D1_ID"
   npx cf d1 migrations apply "$STUDIO_D1_ID"
   ```

4. Generate an unpredictable administrator key with at least 32 random bytes, save it in the team's password manager, and provision it as the `ADMIN_SECRET` Worker secret. For the initial authenticated release use `cf deploy --no-provision --secrets-file <restricted-secret-file>` after preparing a protected, ignored JSON or dotenv file with only `ADMIN_SECRET`. Remove the file after use. Set the binding ID to the real database UUID. The default in the template is a dummy UUID for offline builds.
5. Verify the dashboard URL prompts for an administrator key and protected endpoints return 401 without a valid session. Verify the brand, migration, empty real records, and mock playground. Keep `STUDIO_WORKERS_AI_ENABLED` and `STUDIO_MESSENGER_INGEST` unset at launch.
6. Enable Workers AI only if approved, by deploying with `STUDIO_WORKERS_AI_ENABLED=true`, choosing a model, and setting UTC request and estimated Neuron limits in the UI. The app cap is at most 8,000 estimated Neurons/day. The Cloudflare Free account-wide cap is authoritative. Monitor account-level usage before expanding.
7. Treat Messenger ingress as a separate approval. Add `META_APP_SECRET`, `META_VERIFY_TOKEN`, and `META_PAGE_ID` as Worker secrets, redeploy with `STUDIO_MESSENGER_INGEST=true`, and validate signed events on a test page. The route is `/api/webhooks/messenger`. A separate outbound adapter and approval would be needed for live messages.

Before applying later migrations, use D1 Time Travel or export a backup. For an application rollback, redeploy the previous reviewed Worker version if it supports the updated schema. Revert a schema change with a forward migration after evaluating recovery.

[Cloudflare CLI for agents](https://developers.cloudflare.com/cf/agents/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
