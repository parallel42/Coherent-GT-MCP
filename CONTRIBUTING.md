# Git workflow for agents

This file gives the pull request workflow for changes to `master`. Use it while direct publication is inactive or the effective GitHub rules block it. When both conditions in `AGENTS.md` are met, follow its direct publication steps. Explain your decisions and each blocker in plain English.

## Fixed facts

| Item | Value |
|---|---|
| Repository | `parallel42/Coherent-GT-MCP`. `git remote -v` must show it for both fetch and push of `origin`. |
| Base branch | `master`. Start each job from `origin/master` and open each pull request into it. |
| Protected pushes | In this pull request workflow, push to your job branch and send the pull request to `master`. Never force-push or delete `master`. |
| Your branch name | For this workflow, use `LOGIN/JOB-SLUG`. Get `LOGIN` with `gh api user --jq .login` and verify that the effective GitHub rules let your account create or update that branch. |
| File placement and tests | As `AGENTS.md` says. Read it before any Git command. Do not add new folders at the repository root. |

In the commands, replace `LOGIN`, `JOB-SLUG`, `PR_NUMBER` and the sample paths with real values. Put each value in single quotes, as shown, so that the shell does not change it. Double an apostrophe inside a value (`'it''s.md'` in PowerShell) or use the escaping of your shell. Pass a pull request body through a file (`--body-file`), not on the command line.

## Rules

- One job = one branch = one pull request. Do not keep one long-lived branch for many jobs: it falls behind `master` and then conflicts with the work of other people.
- Stop at the first command that fails. Read its message before you do anything else.
- Before each commit, merge and push, `git branch --show-current` must show your job branch, and `git remote -v` must show `parallel42/Coherent-GT-MCP`.
- Do not push to a protected branch. Do not force-push. Do not rebase or amend commits that you already pushed.
- Hand the pull request to a repository maintainer with verified permission to merge into `master`. Check the maintainer's GitHub repository permission and the effective branch rules, including any needed bypass. Follow the team approval and merge rules for any agent action. Do not approve or close pull requests.
- Commit only the files of the current job. Do not commit build output, logs, `.agent-work/`, credentials or tokens.
- Do not change what another job staged or changed. If you find such changes, stop and ask the person.

## Procedure

1. **Start a new job, or resume one.**
   - To resume: find the pull request and its branch (`gh pr list --author '@me'`). Then run `git fetch origin` and `git switch 'LOGIN/JOB-SLUG'`. If that branch exists only on `origin`, run `git switch --track 'origin/LOGIN/JOB-SLUG'`. Continue at the step where the job stopped.
   - To start: `git status` must show a clean working tree. If not, stop and ask the person. Pick a `JOB-SLUG` that `git branch --list 'LOGIN/JOB-SLUG'` and `git ls-remote --heads origin 'LOGIN/JOB-SLUG'` both show as unused. Then:
   ```
   git fetch origin
   git switch -c 'LOGIN/JOB-SLUG' 'origin/master'
   ```
2. **Do the work** as `AGENTS.md` says.
3. **Commit.** Stage named paths only, never `git add -A` or `git add .`:
   ```
   git add -- 'path/to/file one.md' 'path/to/file2.cpp'
   git diff --cached --name-only
   ```
   Read the list. It must contain only the files of this job. If it shows another file, stop and ask the person; do not unstage it yourself. Commit only after this check:
   ```
   git commit -m 'One sentence: what changed and why'
   ```
4. **Get up to date before each push.**
   ```
   git fetch origin
   git rev-list --count 'HEAD..origin/master'
   ```
   If the count is more than 0, run `git merge 'origin/master'`.
   - Without conflicts, Git makes the merge commit.
   - With conflicts, edit each conflicted file so that both your change and the other change stay, then run `git add -- 'each/resolved file'` and `git commit --no-edit`.
   - If you cannot tell which change is correct, run `git merge --abort` (this returns the branch to its state before the merge) and ask the person.
   - After the merge, run the tests of `AGENTS.md` again.
5. **Push.** Always name the branch on both sides:
   ```
   git push -u origin 'refs/heads/LOGIN/JOB-SLUG:refs/heads/LOGIN/JOB-SLUG'
   ```
   On the first push only, open a draft pull request. Write the body (why, what changed, how it was tested) to a file first:
   ```
   gh pr create --draft --base 'master' --head 'LOGIN/JOB-SLUG' --title 'What changed' --body-file 'pr-body.md'
   ```
   Give the person the pull request link once. Do not commit `pr-body.md`.
6. **Keep the pull request current.** After each new commit, and each time `master` moves before the merge, do steps 4 and 5 again. Use the same pull request. Then check the new head with `gh pr checks PR_NUMBER`.
7. **Handle review.** Read all three sources, because each one shows different comments:
   ```
   gh pr view PR_NUMBER --comments
   gh api --paginate 'repos/parallel42/Coherent-GT-MCP/pulls/PR_NUMBER/comments'
   gh pr checks PR_NUMBER
   ```
   Fix each finding on the same branch, then do steps 3 to 6.
8. **Mark it ready** when the work is complete, the applicable local checks pass, step 4 gives 0, and `gh pr view PR_NUMBER --json headRefOid --jq .headRefOid` equals `git rev-parse HEAD`.
   - Check the GitHub results for that head with `gh pr checks PR_NUMBER`. Wait for all applicable workflows and required checks to pass.
   - If there are no applicable Actions workflows and no required checks, verify this from the workflow definitions, GitHub Actions and the effective branch rules, including any classic branch protection. An empty check list alone does not verify their absence. Record the applicable local evidence and the verified absence of CI requirements.
   - When these conditions are met, run `gh pr ready PR_NUMBER` and hand it to the verified maintainer.
9. **After the merge,** leave the local branch as it is. The next job starts at step 1 from a fresh `origin/master`.

## When GitHub refuses a push in the pull request workflow

A message such as `GH013`, "Repository rule violations" or "Cannot update this protected ref" names the rule that refused the push. Do not retry with force. Read that rule, then check the repository (`git remote -v`), the branch (`git branch --show-current`) and the account (`gh api user --jq .login`).
- If the rule blocks a destination other than your verified job branch, push the same commits to the verified job branch as in step 5. If the job already has a pull request, keep using it. If GitHub refuses the verified job branch, report the rule and stop.
- For any other rule (for example commit signing): do not retry. Tell the person the rule name and stop.
