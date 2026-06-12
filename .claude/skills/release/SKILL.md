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

## Versioned releases

For a tagged version (image also gets a semver tag via metadata-action):

```bash
git tag v0.X.0 && git push origin v0.X.0
```

## Notes

- User data is safe across updates — everything lives in the `/data` volume (`/volume1/docker/dayleaf/dayleaf-data` on the NAS).
- Schema changes must be additive/backward-compatible (`CREATE TABLE IF NOT EXISTS` + explicit migrations in `server/db.js`); existing NAS databases must keep working after a pull.
