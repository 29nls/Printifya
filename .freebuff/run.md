# Printifya — Preview Run Doc

## Reproduce uncommitted artifacts

This worktree is the main checkout (no separate env files needed).

1. **Dependencies** — install with npm:
   ```bash
   npm install
   ```
   (`node_modules` is present in the worktree; reinstall only if missing or stale.)
2. **Env files** — none exist in this project (no `.env*` files). Nothing to copy.
3. **Uncommitted artifacts** — none required to run. `FEATURES.md` and all
   module sources live in `src/` and are served directly by Vite.

## Run the dev server

Start Vite detached (Windows) with stdout/stderr to separate files:

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -RedirectStandardOutput 'C:\Users\Admin\Documents\Coding\Printifya\.freebuff\preview-000a3cfe-7ca2-4607-bca7-00c8873f2c04.log' -RedirectStandardError 'C:\Users\Admin\Documents\Coding\Printifya\.freebuff\preview-000a3cfe-7ca2-4607-bca7-00c8873f2c04.log.err' -WindowStyle Hidden -PassThru).Id"
```

- Default port **5173** (free); Vite picks a fallback if taken.
- Verify: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` → `200`.
- The `Start-Process` call may outlive the shell (wrapper can hang); the node
  process listening on 5173 is the real server (check `netstat -ano | grep :5173`).
