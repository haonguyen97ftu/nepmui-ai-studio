# NẾP MÙI AI Studio

Vietnamese-first administration for a grounded support chatbot. The initial workspace is NẾP MÙI. The deployment database starts with the brand name and no knowledge, catalog, or customer records.

## Try it in a cloud workspace

Use Node.js 24 in GitHub Codespaces, Codex Cloud or another approved cloud development environment.

```bash
npm ci
npm run dev
```

Open the loopback preview on port 4173 inside the cloud workspace. The preview uses temporary, seeded D1 storage and a mock model. It is reset on restart. The label **Dữ liệu mô phỏng** identifies the entire preview. In a deployed workspace the dashboard separates **Dữ liệu thực** and **Dữ liệu thử**.

To try a grounded chat, open **Phòng thử nghiệm** and ask `Quy trình kiểm tra nội bộ`. To test Messenger deduplication, open **Tích hợp** and submit the sample twice. Customer messaging is disabled.

## Verify a change

```bash
npm run lint
npm run typecheck
npm run build:worker
npm test
npx playwright install --with-deps chromium
npm run test:e2e
```

Use `STUDIO_CHROMIUM_PATH` to point Playwright at an installed compatible Chromium. Tests write screenshots to `test-results/screenshots/`. GitHub Actions runs the checks and uploads browser artifacts on the feature branch and pull request.

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Security](docs/SECURITY.md)
- [Roadmap](docs/ROADMAP.md)
- [QA report](docs/QA_REPORT.md)
- [Founder actions](docs/FOUNDER_ACTIONS.md)
