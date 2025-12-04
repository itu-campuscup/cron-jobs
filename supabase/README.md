# Supabase

This folder contains `keep-alive.ts`, a Bun script that pings PROD and STAGE Supabase projects to keep them awake (prevents free-tier DB sleep).

## Usage

### Local (interactive)

Simply run the script—it will prompt for missing credentials and save them to your OS keychain via Bun.secrets:

```bash
bun run keep-alive.ts
```

On first run, you'll be prompted for:
- `SUPABASE_PROD_URL` and `SUPABASE_PROD_KEY`
- `SUPABASE_STAGE_URL` and `SUPABASE_STAGE_KEY`

These are saved to your OS credential store (macOS Keychain, Linux libsecret, etc.) for future runs.

## How it works

1. **Local**: Reads from Bun.secrets (OS keychain) or environment variables; prompts for missing keys and stores them.
2. **CI**: Reads credentials from environment variables (GitHub Secrets) only; no prompts.
3. Pings each project's REST endpoint (`/rest/v1/`) with a GET request.
4. Logs results with timestamps and response status codes.
5. Exits with code 1 if all projects fail (for CI alerting), 0 otherwise.

