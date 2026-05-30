# Rename Typos — `battons` → `buttons`, `shemas` → `schemas`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two directory typos in the NestJS backend (`battons/` → `buttons/`, `shemas/` → `schemas/`) and update all import paths that reference them.

**Architecture:** Two independent rename tasks. Each uses `git mv` to rename directories/files (preserving git history), then a single `sed` command to bulk-update all affected imports, verified by `npm run build`. No logic changes anywhere.

**Tech Stack:** NestJS · TypeScript · Git — all commands run from `repo/` directory

---

## File map

| Action | Path |
|---|---|
| Rename dir | `src/battons/` → `src/buttons/` |
| Rename dir | `src/mongodb/shemas/` → `src/mongodb/schemas/` |
| Rename file | `src/mongodb/schemas/balance.shemas.ts` → `balance.schemas.ts` |
| Rename file | `src/mongodb/schemas/budget.shemas.ts` → `budget.schemas.ts` |
| Rename file | `src/mongodb/schemas/recurring.shemas.ts` → `recurring.schemas.ts` |
| Rename file | `src/mongodb/schemas/transaction.shemas.ts` → `transaction.schemas.ts` |
| Update imports | 23 files importing from `../battons` or `'../battons'` |
| Update imports | 12 import lines referencing `shemas/` paths |

---

## Task 1 — Rename `battons/` → `buttons/` and update all imports

**Files affected (imports to update — 23 files):**
- `src/common/send.split.message.ts`
- `src/handler/transaction.handler.ts`
- `src/handler/statistics.handler.ts`
- `src/handler/compare.handler.ts`
- `src/handler/admin.handler.ts`
- `src/handler/analytics.handler.ts`
- `src/handler/advanced.statistics.handler.ts`
- `src/handler/budget.handler.ts`
- `src/handler/premium.handler.ts`
- `src/handler/balance.handler.ts`
- `src/handler/family.handler.ts`
- `src/handler/basicCommands.handler.ts`
- `src/handler/financial-literacy.handler.ts`
- `src/handler/export.handler.ts`
- `src/scene/change_balance.scene.ts`
- `src/scene/set-recurring.scene.ts`
- `src/scene/send.news.all.scene.ts`
- `src/scene/compound-interest.scene.ts`
- `src/middleware/global-error.filter.ts`
- `src/service/transaction.service.ts`
- `src/service/cron.notifications.service.ts`
- `src/service/statistics.service.ts`
- `src/service/notification.service.ts`

- [ ] **Step 1: Rename the directory with git mv**

  ```bash
  cd repo
  git mv src/battons src/buttons
  ```
  Verify: `ls src/buttons/` should list the 14 button files.

- [ ] **Step 2: Bulk-update all import paths**

  ```bash
  cd repo
  # Replace '../battons' with '../buttons' across all TypeScript source files
  find src -name "*.ts" -exec sed -i "s|'../battons'|'../buttons'|g; s|\"../battons\"|\"../buttons\"|g" {} \;
  # Also handle any double-relative paths (../../battons pattern, if present)
  find src -name "*.ts" -exec sed -i "s|'../../battons'|'../../buttons'|g; s|\"../../battons\"|\"../../buttons\"|g" {} \;
  ```

- [ ] **Step 3: Verify no stale references remain**

  ```bash
  grep -rn "battons" src/ --include="*.ts"
  ```
  Expected: **no output** (zero matches).

- [ ] **Step 4: Build to verify TypeScript compiles clean**

  ```bash
  npm run build 2>&1 | tail -10
  ```
  Expected: build succeeds, `dist/` populated, no errors. If any error mentions a module not found, it is a missed import — fix it manually using the grep from Step 3 as a guide.

- [ ] **Step 5: Commit**

  ```bash
  git add -A src/buttons src/handler src/service src/common src/scene src/middleware
  git commit -m "refactor(buttons): rename battons/ → buttons/ and update all imports"
  ```

---

## Task 2 — Rename `shemas/` → `schemas/`, fix 4 filename typos, update all imports

**Files with typos that need renaming (inside the directory, after the directory is renamed):**
- `balance.shemas.ts` → `balance.schemas.ts`
- `budget.shemas.ts` → `budget.schemas.ts`
- `recurring.shemas.ts` → `recurring.schemas.ts`
- `transaction.shemas.ts` → `transaction.schemas.ts`

**Already correctly named (no filename change needed):**
- `analytics.schemas.ts` — correct
- `balance-history.schemas.ts` — correct

**Import lines to update:**
- `src/app.module.ts` (6 import lines — lines 9–13, 17)
- `src/handler/compare.handler.ts`
- `src/service/balance-history.service.ts`
- `src/service/analytics.service.ts`
- `src/service/advanced.statistics.service.ts` (2 lines)
- `src/service/budget.service.ts`
- `src/service/cron.notifications.service.ts` (2 lines)
- `src/service/balance.service.ts`
- `src/service/premium.service.ts`
- `src/service/recurring.service.ts`
- `src/service/notification.service.ts`

- [ ] **Step 1: Rename the directory with git mv**

  ```bash
  cd repo
  git mv src/mongodb/shemas src/mongodb/schemas
  ```
  Verify: `ls src/mongodb/schemas/` should list 6 schema files.

- [ ] **Step 2: Rename the 4 files with typos in their names**

  ```bash
  cd repo
  git mv src/mongodb/schemas/balance.shemas.ts     src/mongodb/schemas/balance.schemas.ts
  git mv src/mongodb/schemas/budget.shemas.ts      src/mongodb/schemas/budget.schemas.ts
  git mv src/mongodb/schemas/recurring.shemas.ts   src/mongodb/schemas/recurring.schemas.ts
  git mv src/mongodb/schemas/transaction.shemas.ts src/mongodb/schemas/transaction.schemas.ts
  ```
  Verify: `ls src/mongodb/schemas/` should show all 6 files with `.schemas.ts` suffix, none with `.shemas.ts`.

- [ ] **Step 3: Bulk-update all import paths**

  ```bash
  cd repo
  # Fix the directory name in all import paths
  find src -name "*.ts" -exec sed -i \
    "s|mongodb/shemas/|mongodb/schemas/|g" {} \;
  # Fix the 4 filename typos in import paths
  find src -name "*.ts" -exec sed -i \
    "s|/balance\.shemas|/balance.schemas|g; \
     s|/budget\.shemas|/budget.schemas|g; \
     s|/recurring\.shemas|/recurring.schemas|g; \
     s|/transaction\.shemas|/transaction.schemas|g" {} \;
  ```

- [ ] **Step 4: Verify no stale references remain**

  ```bash
  grep -rn "shemas" src/ --include="*.ts"
  ```
  Expected: **no output** (zero matches — the word "shemas" must not appear in any TypeScript file).

- [ ] **Step 5: Build to verify TypeScript compiles clean**

  ```bash
  npm run build 2>&1 | tail -10
  ```
  Expected: build succeeds with no errors. Any `Cannot find module` error indicates a missed import — use the Step 4 grep output to find and fix it.

- [ ] **Step 6: Commit**

  ```bash
  git add -A src/mongodb/schemas src/app.module.ts src/handler src/service
  git commit -m "refactor(schemas): rename shemas/ → schemas/ and fix 4 filename typos"
  ```

---

## Self-review

**Spec coverage:**
| Requirement | Task | How |
|---|---|---|
| `battons/` dir renamed to `buttons/` | 1 | `git mv src/battons src/buttons` |
| All 23 `battons` import files updated | 1 | `sed` bulk-replace + grep verification |
| `shemas/` dir renamed to `schemas/` | 2 | `git mv src/mongodb/shemas src/mongodb/schemas` |
| 4 filename typos fixed inside the dir | 2 | 4 × `git mv` |
| All 12 `shemas` import lines updated | 2 | `sed` bulk-replace + grep verification |
| Build verifies no missed imports | 1 & 2 | `npm run build` after each task |

**Placeholder scan:** No TBDs, all commands and expected outputs provided. ✓

**Type consistency:** No new types introduced — pure rename. ✓
