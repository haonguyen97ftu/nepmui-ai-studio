# Founder actions — NM-AI-04

1. Review the functional platform changes, security disposition, screenshots and [migration report](MIGRATION_REPORT.md) in draft PR #1. NẾP MÙI records/settings remain preserved; other workspaces are synthetic tests only.
2. Approve the concrete staging backup, forward migration and pinned release plan in [DEPLOYMENT.md](DEPLOYMENT.md) when ready. Nothing in NM-AI-04 has changed hosted schema or the last approved NM-AI-03 staging runtime.
3. After approval, have the existing Actions deployer preserve the founder key, provision distinct protected auth/Page keys, verify a private recovery point, apply migration and deploy. Claim the founder account once and keep its credentials in the password manager. Shared-key login then closes.
4. Assign a dedicated staging benchmark account, update the existing workflow login/restoration steps to use account credentials and explicit workspace scope, and rerun the unchanged 13+2 checks without resetting quotas. Assess Vietnamese tone and actual authentication cost on Workers Free.

Keep live Messenger off. Page ownership verification does not authorize ingress, outbound sending, production deployment or a paid service. Those remain separate decisions. No SaaS billing or domain purchase is included.
