# Releasing @yodolabs/plateau-creative-mcp

Publishing is automated: **push a `vX.Y.Z` tag and CI runs `npm publish`**
(with provenance) using the `NPM_TOKEN` repository secret.

## Cut a release

1. Bump the version and keep the lockfile in sync:
   ```bash
   npm version X.Y.Z --no-git-tag-version      # updates package.json + package-lock.json
   # (or edit package.json then: npm install --package-lock-only)
   ```
   The version reported over MCP (`serverInfo.version`) is read from
   `package.json` at runtime, so it stays in sync automatically — no second
   place to edit.
2. Commit `package.json` + `package-lock.json` to `main` and push.
3. Tag and push. **The tag must equal `package.json` version** — CI checks this
   and fails otherwise:
   ```bash
   git tag -a vX.Y.Z -m "plateau-creative-mcp X.Y.Z"
   git push origin vX.Y.Z
   ```
4. Watch: `gh run watch <id>` (workflow: `release.yml`). It runs lint →
   typecheck → test → build → `npm publish --access public --provenance`.
5. Verify: `curl -s https://registry.npmjs.org/@yodolabs/plateau-creative-mcp | python3 -c "import json,sys;print(json.load(sys.stdin)['dist-tags']['latest'])"`

## The `NPM_TOKEN` secret (the thing that breaks)

A failed publish with `npm error 404 ... PUT .../@yodolabs%2fplateau-creative-mcp`
is **not** a "package missing" error — for a scoped package, npm returns 404
when the token is invalid/expired or lacks write access. Rotate the token:

1. npmjs.com → **Access Tokens** → Generate New Token → **Granular Access Token**:
   - **Bypass two-factor authentication (2FA): ✅ enabled** (CI can't enter an OTP).
   - **Allowed IP ranges: leave empty** (GitHub runners use dynamic IPs).
   - **Packages and scopes → Read and write**, scoped to
     `@yodolabs/plateau-creative-mcp` (or the `@yodolabs` scope).
   - **Organizations → No access.**
   - Expiration: pick the longest acceptable; it will need rotating on expiry.
2. GitHub repo → Settings → Secrets and variables → Actions → update
   **`NPM_TOKEN`** with the new value (the secret *existing* is not enough — the
   *value* must be a valid write-capable token).
3. Re-run the failed job (no new tag needed):
   `gh run rerun <run-id> --failed`
