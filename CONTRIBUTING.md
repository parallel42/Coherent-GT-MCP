# How to send your work

This file is for each person who changes this repository, and for their AI agent. Read it before you change any file.

## The idea in one line

Each new job gets its own new branch, made from the newest `master`. When the job is done, you open a pull request. Keven puts it into `master`.

## Why

A branch that lives for a long time gets old. Other people change `master` in the same weeks, and then Git cannot put your work in without conflicts. Someone must then copy your work by hand, and things get lost.

A new branch for each job stays small and new. Small branches go into `master` easily.

## Words you will see

| Word | What it means |
|---|---|
| `master` | The shared copy of this project. You cannot push to it directly: GitHub refuses. |
| Branch | Your own copy of the code for one job. Its name starts with your GitHub user name, for example `Jeppeson2001/new-shelter`. |
| Pull request (PR) | A request on GitHub: "please put my branch into `master`". People and automatic checks review it there. |
| Draft PR | A pull request that is not finished yet. |
| Conflict | You and someone else changed the same lines. Git asks a person to choose. |

## The steps

In the commands, replace `<you>` with your GitHub user name and `<job>` with a short name for the job, for example `new-shelter`.

### 1. Start a job: new branch from the newest `master`

```
git fetch origin
git switch -c <you>/<job> origin/master
```

Do not start from an old branch, and do not keep one branch for all your jobs.

### 2. Do the work and save it (commit)

```
git add <the files you changed>
git status
git commit -m "Short sentence that says what changed"
```

Add only the files of this job. Do not add build output, `.agent-work/`, or files from other jobs.

Before you commit, read the `git status` output. Under "Changes to be committed" you must see only the files of this job. If you see other files, remove them from the commit with `git restore --staged <file>` (this keeps your changes in the file).

### 3. Send it to GitHub and open a draft PR

```
git push -u origin HEAD
gh pr create --draft --base master --fill
```

If you do not have `gh`, open the repository on GitHub. Click "Compare & pull request", set the base to `master`, and select "Create draft pull request".

### 4. Tell us on Discord

Post the PR link in the product channel, with one line that says what it does.

### 5. Read the review and fix

The checks and the reviewers write comments on the PR in GitHub. Make the fixes on the same branch, then:

```
git add <files>
git commit -m "Fix review notes"
git push
```

The PR updates by itself. Do not make a new branch or a new PR for fixes.

### 6. If `master` changed while you worked

```
git fetch origin
git merge origin/master
git push
```

If Git reports a conflict, the merge stops before `git push`. Fix the conflict (or ask your agent or us), then run `git add <files>`, `git commit` and `git push`. Always push after a merge, also when there was no conflict, so that GitHub has the new version.

### 7. Done

When the work is finished and tested, click "Ready for review" on the PR. Keven merges it. After the merge, the next job starts again at step 1.

## Rules

- One job = one branch = one PR.
- Always start from the newest `origin/master`.
- Never push to `master`, and never force-push.
- Put files where `AGENTS.md` says. Do not make new folders at the top of the repository.

## Copy this to your AI agent

```
You work in this repository. I am a beginner with Git, so explain each step in plain words.
Read AGENTS.md and CONTRIBUTING.md first.

Rules for each job:
1. Run `git fetch origin`, then make a new branch from the newest master:
   `git switch -c <my GitHub user name>/<short-job-name> origin/master`.
   Never build on an old branch, and never keep one branch for many jobs.
2. Put files where AGENTS.md says. Do not make new folders at the repository root.
3. Commit only the files of this job. Run `git status` before each commit and make sure that only those files are staged.
   Never commit build output or .agent-work/.
4. Push with `git push -u origin HEAD`. Open a draft pull request to master:
   `gh pr create --draft --base master --fill`. Give me the PR link.
5. For review fixes, commit and push on the same branch. Do not open a new PR.
6. If master moved, run `git fetch origin` and `git merge origin/master`. Resolve conflicts, then always push.
7. Never push to master, and never force-push.
8. When the work is tested, run `gh pr ready`. Keven merges it.
```
