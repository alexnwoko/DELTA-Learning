---
name: delta-security-scan
description:
  "Run DELTA's pinned local security scans (gitleaks, Semgrep, Trivy) on a branch and triage
  the findings. Use before opening a PR, before the merge train, after a dependency change,
  or when asked to scan DELTA for secrets, vulnerabilities or insecure code."
---

# DELTA security scan

The same tools and pins as `.github/workflows/security-scan.yml`. Run from the repository root.

## Pinned versions

- gitleaks 8.30.1, Semgrep 1.180.0, Trivy 0.75.0 or later.
- Never Trivy 0.69.4, `trivy-action` below 0.35.0 or `setup-trivy` below 0.2.6
  (GHSA-69fq-xp46-6x23, CVE-2026-33634).

## Commands

```bash
gitleaks git --redact --no-banner .
semgrep scan --metrics=off --config p/typescript --config p/secrets --config p/react \
  --severity ERROR --severity WARNING app/
trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --skip-dirs node_modules .
```

- Always `--redact` for gitleaks. If a live secret appears, rotate it; deleting it from the
  tree is not enough.
- Always `--metrics=off` and named rulesets for Semgrep. `--config auto` sends metrics.

## Triage

- Record each finding with file:line, severity, and owner lane (see the architecture map in
  `DELTA_dev_collaboration_read_me.md`).
- Historical non-live secrets go in `.gitleaksignore` with a one-line reason.
- Lockfile upgrades go in one commit by the merge owner, never piecemeal on feature branches.
- For security review of a diff, follow with the `differential-review` skill. For workflow
  files, use `agentic-actions-auditor`.
