---
name: release
description: Ship a Dayleaf release — verify, push to main, watch the GHCR image build, and give NAS update steps. Use when asked to release, deploy, ship, or publish changes.
---

# Release Dayleaf

Pushing to `main` IS the release: `.github/workflows/docker.yml` builds and pushes `ghcr.io/t0n003c/dayleaf:latest` (amd64+arm64). The NAS pulls that tag.

## Steps

1. **Gate:** run the `smoke-test` skill (type-check + API suite). Don't release on failures.
2. **Docker proof:** `docker build -t dayleaf:test .` — this is exactly what CI runs.
3. Commit (if needed) and push:
   ```bash
   git push origin main
   ```
4. Watch the build (takes a few minutes for multi-arch):
   ```bash
   gh run list --limit 1
   gh run watch <run-id> --exit-status --interval 30
   ```
5. Verify the image is pullable anonymously (the package is public; this guards against visibility regressions):
   ```bash
   docker logout ghcr.io; docker pull ghcr.io/t0n003c/dayleaf:latest
   ```
6. Tell the user the NAS update commands (run on the NAS, in the compose folder):
   ```bash
   docker compose pull && docker compose up -d
   ```

## Versioned releases (the normal flow — the user likes each batch tagged)

Current series is **v1.4.x**. Bump both `package.json` and `web/package.json` to the new version (the Settings footer shows it), then:

```bash
git tag vX.Y.Z && git push origin main vX.Y.Z
gh release create vX.Y.Z --title "Dayleaf vX.Y.Z — <theme> 🍃" --notes-file <notes>
```

A push to a tag AND to main both fire the workflow. Watch BOTH runs:
```bash
for RUN in $(gh run list --limit 2 --json databaseId -q '.[].databaseId'); do
  gh run watch "$RUN" --exit-status --interval 30 >/dev/null 2>&1
  gh run view "$RUN" --json conclusion,headBranch -q '.headBranch + ": " + .conclusion'
done
```

## Notes

- **Concurrent-build race:** the `main` and tag builds run simultaneously on the same commit and share the GHA cache; occasionally one fails with `error writing layer blob: not_found`. It's transient — `gh run rerun <id> --failed` fixes it. Make sure the **main** build ends green (that's what publishes `:latest`).
- **Non-root container** (since v1.4.0): the NAS data dir must be writable by UID 1000 — tell the user to `chown -R 1000:1000 ./dayleaf-data` before `docker compose up -d`, or the container can't write.
- **PWA service-worker lag:** after a pull, the installed phone app must be **opened twice** for the new service worker to take over (it updates on the launch-after-next). Always include this in update instructions.
- User data is safe across updates — everything lives in the `/data` volume (`/volume1/docker/dayleaf/dayleaf-data` on the NAS).
- Schema changes must be additive/backward-compatible (`CREATE TABLE IF NOT EXISTS` + explicit migrations in `server/db.js`); existing NAS databases must keep working after a pull.
- Bump the service worker behavior carefully: navigations are SWR with self-sufficient asset precaching and a **stable** cache name (`dayleaf-app`) that's never purged — see CLAUDE.md before touching `web/public/sw.js`.
