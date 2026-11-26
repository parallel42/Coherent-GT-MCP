# Coherent-GT-MCP

Before any Git work (branch, commit, push, pull request), read `CONTRIBUTING.md` and follow it.

## Direct publication to `master`

Status: **not active**.

Direct publication starts only when both of these are true:

- The repository maintainers change the status above to "active", with the date.
- The effective GitHub rules for `master` let your account push a fast-forward commit. Run `gh api repos/parallel42/Coherent-GT-MCP/rules/branches/master`: the result must have no `update` and no `pull_request` rule.

If one of them is false, use `CONTRIBUTING.md`. When direct publication is active, do these steps for each change:

1. Run `git fetch origin`. Build the commit on the current `origin/master` tip, not on a local branch. If the checkout has other changes, build the commit in a temporary index (`GIT_INDEX_FILE`) so that the checkout stays as it is.
2. Commit only the files of the task. Name each path; never use `git add -A` or `git add .`.
3. Run the checks on the exact commit SHA that you will push, in a clean copy of that SHA (for example a clone in `.agent-work/tmp/<slug>` with `git checkout <SHA>`), not in a checkout with other changes: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. A pass on a different SHA or on other files does not count.
4. Run `git fetch origin` again. If `origin/master` moved, go back to step 1.
5. Push a fast-forward only: `git push origin '<SHA>:refs/heads/master'`. Never force-push. Never rewrite or delete `master`.
6. Run `git ls-remote origin refs/heads/master`: it must show your SHA. If GitHub runs checks on `master`, wait until each required check for that SHA passes (`gh api repos/parallel42/Coherent-GT-MCP/commits/<SHA>/check-runs`). A pending or missing result means the change is not complete. Fix each failure with a new commit. On 2026-11-25 the repository had no workflows and no required checks.

If the result of the push is not known, run `git fetch origin` and `git merge-base --is-ancestor <SHA> origin/master`. If `master` contains your SHA, continue at step 6. If GitHub refused the push, or `master` does not contain your SHA, do not retry with force; publish through `CONTRIBUTING.md`.

Direct publication does not authorize a deployment, a package publish, a release, or a tag. Each one needs its own approval from the repository maintainers.
