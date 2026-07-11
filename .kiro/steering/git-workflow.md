---
inclusion: always
---

# Git Workflow Preference

**Push directly to `main`.** Do NOT create a new feature/fix branch for changes in this repository.

- Commit changes directly on `main` and push via `github_push_to_remote` targeting `main`.
- Do NOT open a new Pull Request for routine changes - push straight to `main`.
- This overrides the general "always push to a new branch" default workflow guidance for this specific repository.
- If the user explicitly asks for a branch/PR for a specific change (e.g. something they want to review first), follow that instruction instead for just that change.
