# docs

Operator- and contributor-facing reference docs.

| File | What |
|---|---|
| [ENV_GUIDE.md](ENV_GUIDE.md) | Plain-language guide to every `.env` variable — what to set for local dev vs. production. |
| [devops.md](devops.md) | Production handoff checklist — every account/DNS/cert a devops engineer needs to provision, grouped by feature, in order. |
| [post-launch-backlog.md](post-launch-backlog.md) | Deliberately-deferred debt & future gaps, each with a reason and a code citation. Non-launch-blocking. |

Design docs live in [`../arch/`](../arch/) (start with `arch/system-design.md`); operational
procedures live in [`../deploy/RUNBOOK.md`](../deploy/RUNBOOK.md). The implementation roadmap
(`plan/`) and the pre-deploy audits were archived out of version control during pre-deploy
cleanup — kept locally under `mess/` (git-ignored).
