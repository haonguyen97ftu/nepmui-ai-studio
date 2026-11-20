# AI Studio

A Vietnamese-first multi-workspace, multi-Page administration platform for grounded support assistants. AI Studio is the temporary platform name; NẾP MÙI is the preserved first workspace. New workspaces have independent content, agents, accounts/roles, channels and limits, with no published knowledge, products or customer records.

## Try it in a cloud workspace

Use Node.js 24 in GitHub Codespaces, Codex Cloud or another approved cloud development environment.

```bash
npm ci
npm run dev
```

Open the loopback preview on port 4173 inside the cloud workspace. The preview uses temporary, seeded D1 storage and a mock model. It is reset on restart. The label **Dữ liệu mô phỏng** identifies the entire preview. In a deployed workspace the dashboard separates **Dữ liệu thực** and **Dữ liệu thử**.

To try a grounded chat, open **Phòng thử nghiệm** and ask `Quy trình kiểm tra nội bộ`. To test Messenger deduplication, open **Tích hợp** and submit the sample twice. Open **Nền tảng** to create/switch workspaces, **Kênh & Pages** for mock Pages, **Trợ lý AI** for reusable configurations and **Thành viên & quyền** for role management. The demo seeds three synthetic workspaces and six mock Pages. Customer messaging is disabled.

## Verify a change

```bash
npm run lint
npm run typecheck
npm run build:worker
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run build:staging
npm run migration:report
```

Use `STUDIO_CHROMIUM_PATH` to point Playwright at an installed compatible Chromium. Tests write screenshots to `test-results/screenshots/`. GitHub Actions runs the checks and uploads browser artifacts on the feature branch and pull request.

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
- [QA report](docs/QA_REPORT.md)
- [Migration and recovery report](docs/MIGRATION_REPORT.md)
- [Founder actions](docs/FOUNDER_ACTIONS.md)

NM-AI-04 is a reviewed deployment candidate, not a hosted schema rollout. Existing staging remains on NM-AI-03 until the founder approves the private recovery point, migration and release sequence. Never reset usage counters or enable live Messenger to obtain a passing benchmark.
