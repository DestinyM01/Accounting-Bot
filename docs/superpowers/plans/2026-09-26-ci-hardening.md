# CI Hardening (Round A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Images build on GitHub-hosted runners, only after the api tests pass, and the retired bot's image is no longer built.

**Architecture:** One workflow file is rewritten, with three jobs: `test`, then `build-api` and `build-web` side by side. The runner install script goes, and the README's mention of it with it.

**Tech Stack:** GitHub Actions (`ubuntu-latest`), docker/build-push-action v6, pnpm 10.34.5, Node 20 (round C moves it to 24).

**Spec:** `docs/superpowers/specs/2026-09-26-ci-hardening-design.md`

**Repo rules:**
- The repo is PUBLIC.
- End every commit message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't push; the controller pushes and watches the run.

---

### Task 1: The workflow

**Files:** Modify `.github/workflows/docker-build.yml` (full replacement)

- [ ] **Step 1: Replace the file** with:

```yaml
name: Build and Push Docker Images

on:
  push:
    branches:
      - main
  workflow_dispatch:

# Least privilege: jobs only read the repo unless they say otherwise.
permissions:
  contents: read

# One run at a time, oldest first, so an older run can never push :latest after a newer one.
concurrency:
  group: docker-images
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io

jobs:
  # ── Gate: nothing is pushed unless the api's tests and type check pass ──────
  test:
    name: "1 · Test"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        run: npm install -g pnpm@10.34.5

      - name: Install api dependencies
        working-directory: api
        run: pnpm install --frozen-lockfile

      - name: Run api tests
        working-directory: api
        run: pnpm test

      - name: Type-check api
        working-directory: api
        run: npx tsc --noEmit -p tsconfig.json

  # ── API image ───────────────────────────────────────────────────────────────
  build-api:
    name: "2 · API"
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Lowercase image name
        run: echo "API_IMAGE=${IMAGE,,}" >> $GITHUB_ENV
        env:
          IMAGE: ${{ env.REGISTRY }}/${{ github.repository_owner }}/accounting-api

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.API_IMAGE }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-

      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: ./api
          file: ./api/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=registry,ref=${{ env.API_IMAGE }}:buildcache
          cache-to: type=registry,ref=${{ env.API_IMAGE }}:buildcache,mode=max
          provenance: false

  # ── Web image ───────────────────────────────────────────────────────────────
  build-web:
    name: "3 · Web"
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Lowercase image name
        run: echo "WEB_IMAGE=${IMAGE,,}" >> $GITHUB_ENV
        env:
          IMAGE: ${{ env.REGISTRY }}/${{ github.repository_owner }}/accounting-web

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.WEB_IMAGE }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-

      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: ./web
          file: ./web/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=registry,ref=${{ env.WEB_IMAGE }}:buildcache
          cache-to: type=registry,ref=${{ env.WEB_IMAGE }}:buildcache,mode=max
          provenance: false
```

- [ ] **Step 2: Check that it parses and is wired as intended.**

```bash
cd web && node -e "
const y=require('js-yaml');const w=y.load(require('fs').readFileSync('../.github/workflows/docker-build.yml','utf8'));
const j=w.jobs;console.log(Object.keys(j).join(','));
for (const [k,v] of Object.entries(j)) console.log(k, v['runs-on'], v.needs ?? '-', JSON.stringify(v.permissions ?? {}));
console.log('top permissions', JSON.stringify(w.permissions), 'concurrency', JSON.stringify(w.concurrency));"
```

If `js-yaml` isn't resolvable from `web/`, run the same script with `npx -y -p js-yaml node -e "…"`.

Expected output:
- `test,build-api,build-web`;
- every job on `ubuntu-latest`;
- `build-api` and `build-web` each with needs `test` and `{"contents":"read","packages":"write"}`;
- top permissions `{"contents":"read"}`;
- concurrency `{"group":"docker-images","cancel-in-progress":false}`.

And `grep -c "self-hosted\|build-bot\|accounting-bot" .github/workflows/docker-build.yml` prints `0`.

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/docker-build.yml
git commit -m "ci: build on GitHub-hosted runners, only after the api tests pass; stop building the retired bot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the runner install script

**Files:** Delete `setup-runner.sh`. Modify `README.md` (its file list). Edit `CONTEXT.md` locally: it is gitignored, so it's not committed.

- [ ] **Step 1: Delete and update.**
  - `git rm setup-runner.sh`.
  - In `README.md`'s file tree, delete the line `└── setup-runner.sh         ← One-time GitHub Actions runner install`, and change the line above it from `├── DEPLOY.md …` to start with `└──` so the tree still closes.
  - In `CONTEXT.md` (local only):
    - replace the line `├── .github/workflows/deploy.yml ← CI/CD via self-hosted GitHub Actions runner` with `├── .github/workflows/docker-build.yml ← CI on GitHub-hosted runners: api tests, then api + web images to GHCR`;
    - delete the `setup-runner.sh` tree line and the `- **GitHub runner:** …` line.

- [ ] **Step 2: Check.**

Run: `git grep -n "setup-runner\|self-hosted" -- . ':!docs'`
Expected: no output.

- [ ] **Step 3: Commit.**

```bash
git add README.md
git commit -m "chore: remove the self-hosted runner install script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller checklist

1. Run the PII gate, which must pass before pushing. Then push.
2. Watch the run through the GitHub API. Check:
   - the jobs are `1 · Test`, `2 · API` and `3 · Web`;
   - their `runner_name` values are GitHub-hosted, not the LXC runner;
   - `test` finishes before the builds start;
   - all three are green;
   - GHCR has new `sha-<commit>` tags.
3. Give the user the commands to remove the self-hosted runner. There is nothing to restart: the images are functionally the same.
4. Add "As built" to this plan and update memory. Then start round B's design.

## As built (2026-09-26)

The work landed in `d24f08d` (the workflow) and `2158537` (the runner script and the README). It was pushed with the spec and plan.

- **First run, 36212208012, all green on GitHub-hosted `ubuntu-latest`:**
  - `1 · Test`, 38 s: 830 tests and `tsc`;
  - then `2 · API` and `3 · Web` in parallel, about 20 s each.
- **The gate:** both builds started only after `test` finished, as `needs: test` defines.
- **The bot:** its image isn't built any more.
- **`CONTEXT.md`** was updated locally; it is gitignored.
- **One remaining `self-hosted` match,** in `.env.example`, refers to hosting MongoDB yourself, so it stays.

**The user's remaining step:** remove the self-hosted runner from GitHub and from the LXC, with the commands from the spec.
