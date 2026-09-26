# CI Hardening (Round A) — Design Spec

**Goal:** Nothing from the internet runs inside the home network, no untested image reaches the registry, and CI stops building the retired bot. This is round A of `2026-09-26-upgrade-roadmap.md`, covering code-review findings 1 and 7.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Where builds run | **GitHub-hosted runners** (`ubuntu-latest`), which are free for public repos. The self-hosted LXC runner is removed. |
| Test gate | The api's Jest suite and type check must pass before any image is pushed. |
| Retired bot | **No longer built.** Its code, manifests, last image and Argo app stay; the Argo app owns the namespace and MongoDB. |

## Workflow (`.github/workflows/docker-build.yml`)

- **Triggers** are unchanged: a push to `main`, and `workflow_dispatch`.
- **Top-level `permissions: contents: read`.** Only the build jobs add `packages: write`.
- **Concurrency.** `concurrency: { group: docker-images, cancel-in-progress: false }`. Runs don't overlap, so an older run can't push `:latest` after a newer one.
- **The `test` job** (`ubuntu-latest`), in order:
  1. checkout;
  2. `actions/setup-node@v4` with Node 20 (round C moves it to 24);
  3. `npm install -g pnpm@10.34.5`, matching the Dockerfiles;
  4. in `api/`: `pnpm install --frozen-lockfile`, `pnpm test`, then `npx tsc --noEmit -p tsconfig.json`.
- **The `build-api` and `build-web` jobs** run on `ubuntu-latest` with `needs: test`, side by side. Their steps stay as they are today:
  - checkout, lowercase image name, buildx, GHCR login with `GITHUB_TOKEN`, metadata;
  - build and push with the tags `latest` and `sha-…` and the registry build cache;
  - `provenance: false`.
- **The `build-bot` job is removed.**

## Repo cleanup

- **`setup-runner.sh`** is deleted.
- **`README.md`** drops the file-list line for `setup-runner.sh`.
- **`CONTEXT.md`:**
  - the CI line names `.github/workflows/docker-build.yml` on GitHub-hosted runners;
  - the runner install and status lines go.

## The user's steps, after the first green run on hosted runners

1. **Remove the runner from GitHub:** GitHub → the repo → Settings → Actions → Runners → the self-hosted runner → Remove.
2. **Remove it from the LXC:**

   ```bash
   cd /opt/actions-runner && sudo ./svc.sh stop && sudo ./svc.sh uninstall
   ```

   Then remove its registration with the token GitHub shows (`./config.sh remove --token …`), and delete `/opt/actions-runner`.
3. **Optional:** Settings → Actions → General → "Require approval for all external contributors".

## Testing

- The first push after the change shows `test`, then `build-api` and `build-web` on GitHub-hosted runners, all green, with fresh `latest` and `sha-` tags in GHCR.
- **The gate works:**
  - When the `gh` CLI is authenticated, a `workflow_dispatch` run on a throwaway branch with one deliberately failing assertion stops at `test`, and no build job starts. The branch is deleted afterwards. `latest` is only tagged on the default branch, so such a run couldn't move `latest` anyway.
  - Without `gh`, the run graph of the first push shows both build jobs waiting on `test`.
