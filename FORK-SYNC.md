# Fork Sync Strategy

This repository is a source fork of [`anomalyco/opencode`](https://github.com/anomalyco/opencode)
(upstream branch: `dev`), republished as a standalone repo (`fork: false` on GitHub — no
fork network link, so upstream sync is a manual git operation).

## Local delta over upstream

Everything not listed below is upstream content and must not be edited directly.

| Path | Delta |
|---|---|
| `specs/` | Own spec docs (perf roadmap, ISO 17025 skill-manager layer) — added |
| `opencode.skills.json` | Own skill-manager manifest — added |
| `.github/workflows/*` | **Deleted** in `d6bced4` for the initial push — no CI is wired |

## Sync procedure

```bash
git remote add upstream https://github.com/anomalyco/opencode.git   # once
git fetch upstream dev
git merge upstream/dev   # or: rebase the local delta commits onto upstream/dev
```

Conflict expectations:

- `.github/workflows/*`: upstream adds/updates will collide with the local
  deletion. Keep them deleted (or selectively restore) — decide per sync.
- `specs/`, `opencode.skills.json`: upstream never touches these paths;
  conflicts here mean upstream added same-named files — review manually.

## Risks

- **No CI**: upstream workflows were removed; upstream changes are not
  regression-tested here. Re-add a minimal workflow before relying on merges.
- **History divergence**: this repo is not a GitHub fork, so `gh` fork-sync
  helpers do not apply — only the git procedure above works.
- **npm/SDK drift**: `packages/sdk/js` is regenerated from upstream
  (`./packages/sdk/js/script/build.ts`); regenerate after each sync.
