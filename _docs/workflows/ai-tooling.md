# AI agent tooling for DELTA

This page lists the agent skills and developer tools used on DELTA, where each lives, and how
to set it up. It complements [`openspec.md`](openspec.md) and [`.github/agents/README.md`](../../.github/agents/README.md).

## In the repository (works on clone)

| Skill                     | Folder                               | Purpose                                                 | Source and licence                       |
| ------------------------- | ------------------------------------ | ------------------------------------------------------- | ---------------------------------------- |
| `delta-house-style`       | `.claude/skills/`, `.github/skills/` | Writing rules and lint for DELTA documents              | DELTA, Apache-2.0                        |
| `delta-data-honesty`      | `.claude/skills/`, `.github/skills/` | Null-not-zero, grades, refusal, remainder, tenant scope | DELTA, Apache-2.0                        |
| `delta-security-scan`     | `.claude/skills/`, `.github/skills/` | Pinned gitleaks, Semgrep and Trivy runs and triage      | DELTA, Apache-2.0                        |
| `openspec-*`, `/opsx`     | `.claude/`, `.github/`               | Spec-driven change workflow                             | OpenSpec, MIT                            |
| `differential-review`     | `.claude/skills/`                    | Security review of a diff                               | Trail of Bits @ `442fc9d6`, CC-BY-SA-4.0 |
| `agentic-actions-auditor` | `.claude/skills/`                    | Audit of AI agents in GitHub Actions                    | Trail of Bits @ `442fc9d6`, CC-BY-SA-4.0 |
| `web-design-guidelines`   | `.claude/skills/`                    | UI and accessibility audit of `app/**/*.tsx`            | Vercel @ `ba469388` and `4ecfb9fb`, MIT  |

Third-party folders carry a `NOTICE` and, where upstream has one, a `LICENSE`. Their licences
cover only those folders. DELTA code stays Apache-2.0.

## On each developer machine

These tools are too large to vendor, or are command-line programs. Install them once.

| Tool          | Install                                                                                                                | Notes                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| OpenSpec CLI  | `npm i -g --prefix ~/.local @fission-ai/openspec@1.11.0`                                                               | Matches the version the skills were generated with. Then `openspec config set telemetry.enabled false` |
| gitleaks      | `brew install gitleaks` (8.30.1)                                                                                       | Always `--redact`                                                                                      |
| Semgrep       | `brew install semgrep` (1.180.0)                                                                                       | Always `--metrics=off` and named rulesets                                                              |
| Trivy         | `brew install trivy` (0.75.0 or later)                                                                                 | Never 0.69.4                                                                                           |
| graphify      | `uv tool install graphifyy==0.9.85 && graphify install --platform claude`                                              | User skill. Write output outside the repository                                                        |
| Archify       | `npx -y skills add tt-a1i/archify --skill archify --agent claude-code --global --copy --yes`                           | User skill, about 11 MB                                                                                |
| Book to Skill | `git clone --branch v1.4.0 --depth 1 https://github.com/virgiliojr94/book-to-skill.git ~/.claude/skills/book-to-skill` | Expect commit `387d938e`. Only from `virgiliojr94`                                                     |

## Review in GitHub

CodeRabbit reads `.coderabbit.yaml`. It is free for public repositories, but it only runs once
the CodeRabbit GitHub app is installed on the repository. `auto_review.base_branches` takes
regex patterns and includes `^v2/.*`. `path_instructions` carry the DELTA rules above.
