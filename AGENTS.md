# Coherent-GT-MCP

Before any Git work (branch, commit, push, pull request), read `CONTRIBUTING.md` to select the workflow.

## Direct publication to `master`

Status: **not active**.

Direct publication starts only when both of these are true:

- The repository maintainers change the status above to "active", with the date.
- The effective GitHub rules for `master` let your account push a fast-forward commit. Check `gh api repos/parallel42/Coherent-GT-MCP/rules/branches/master` and any classic branch protection. Verify that your account can update `master` directly and meet every rule that applies.

If one of them is false, use `CONTRIBUTING.md`. When direct publication is active, do these steps for each change:

1. Run `git fetch origin`. Build the commit on the current `origin/master` tip, not on a local branch. If the checkout has other changes, build the commit in a temporary index (`GIT_INDEX_FILE`) so that the checkout stays as it is.
2. Commit only the files of the task. Name each path; never use `git add -A` or `git add .`.
3. Run the checks on the exact commit SHA that you will push, in a clean copy of that SHA (for example a clone in `.agent-work/tmp/<slug>` with `git checkout <SHA>`), not in a checkout with other changes: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. A pass on a different SHA or on other files does not count.
4. Run `git fetch origin` again. If `origin/master` moved, go back to step 1.
5. Push a fast-forward only: `git push origin '<SHA>:refs/heads/master'`. Never force-push. Never rewrite or delete `master`.
6. After every push attempt, including a successful or ambiguous result, run `git fetch origin refs/heads/master`. After the fetch succeeds, run `git merge-base --is-ancestor <SHA> FETCH_HEAD`. Exit code 0 confirms that the exact tested SHA is the remote tip or an ancestor. Exit code 1 means the SHA is missing. If the fetch or comparison fails for another reason, resolve the error before you retry or report success.
7. When the remote contains the SHA, check the Actions runs (`gh run list --commit <SHA>`), check runs and commit statuses for that SHA. Wait for each applicable workflow and required check to pass, including expected results that are missing or pending. Fix failures with a new tested commit. If no workflow applies and no check is required, verify this from the workflow definitions, GitHub Actions and the effective branch rules. Record that evidence and the local results from step 3.

If the remote does not contain the tested SHA, check the current tip and effective rules before another push:

- If direct publication is inactive or the rules block direct updates to `master`, use the pull request workflow in `CONTRIBUTING.md`.
- If GitHub rejects the commit for another policy reason, report the rule and resolve it before another push.
- If the tip moved and the rules still permit direct publication, return to step 1. Build on the new tip and test the new SHA before you push.
- If the tip is still the tested commit's parent, retry the same SHA once after a transient or ambiguous result, then repeat steps 6 and 7. If the SHA is still missing or GitHub reports another rejection, stop and report the result. Never force-push.

Direct publication does not authorize a deployment, a package publish, a release, or a tag. Each one needs its own approval from the repository maintainers.
