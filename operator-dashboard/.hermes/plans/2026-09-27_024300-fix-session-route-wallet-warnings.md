# Plan: Fix Session Route, Wallet Warnings, and Environment Config

## Goal

Fix three issues: (1) `/api/session` returns 404 on Vercel because the route reads a file that doesn't exist in the deployment bundle, (2) Phantom and Solflare wallet extensions show "Unsafe/Unknown site" warnings when signing transactions on the deployed domain, and (3) the deployed site lost its environment variable config and must be reconnected to the GitHub repo.

## Context / Assumptions

- Deployed URL: `https://operator-dashboard-wine.vercel.app` (verified reachable, HTTP 200)
- Current `wallets = []` in WalletContextProvider — only Wallet Standard auto-detection is active
- No PhantomWalletAdapter or SolflareWalletAdapter in the code (removed previously)
- `/api/session/route.ts` reads `session_config.json` from a hardcoded path that doesn't exist on Vercel
- Wallet warnings are extension-level: Phantom shows red UI + "Confirm Unsafe", Solflare shows "Unknown site". Transactions succeed after user confirms — so the issue is the wallet extension's trust model, not the app code.
- `NEXT_PUBLIC_SOLANA_RPC` env var needs to be set on Vercel (currently relying on fallback hardcoded URL in code)

## Architecture / Proposed Approach

**Session route fix:** Rewrite to use fileless state that works on Vercel serverless functions. Options: (a) switch to a proper data store (Upstash Redis, Vercel KV, Supabase), (b) use Vercel's `vercel/kv` if available, (c) at minimum, return a valid response without a file read. Given the scope, aim for a Vercel-KV-compatible approach or a simple in-memory response for now.

**Wallet warnings:** The warnings come from wallet extensions treating the domain as "new/untrusted" for signing. Two levels:
- Extension trust: Wallets treat any new domain as untrusted for signing. This is by design — a user must visit the site and "approve/toggle on" the wallet for that domain. On localhost, Phantom/Solflare may not have cached trust, hence the warnings.
- Wallet Standard auto-detection: The `useStandardWalletAdapters` hook filters out adapter-based wallets when a standard wallet with the same name is detected — meaning Phantom/Solflare adapters are suppressed when their extension is installed. With `wallets=[]`, no adapter-based wallets are offered, only auto-detected standard wallets. This is fine but means the config for those wallets lives in the extension, not the app.

Fixes: (a) ensure `app/page.tsx` sends clear metadata about the site (manifest, security headers), (b) ensure the wallet adapter config includes proper `WalletModalProvider` / Sentry-less setup so there's no confusion, (c) possibly add a "configure wallet" button that nudges the user to approve the domain in their wallet extension.

**Vercel env vars:** The `vercel whoami` returned `[]` (zero projects), suggesting the Vercel project got deleted or detached. Need to re-link: `vercel link` in `operator-dashboard/` with the GitHub repo, then set `NEXT_PUBLIC_SOLANA_RPC`.

## Step-by-step Tasks

### Task 1: Fix `/api/session/route.ts` — replace file read with Vercel-compatible state

**File:** `operator-dashboard/app/api/session/route.ts`

Currently reads `session_config.json` from disk. On Vercel, this file doesn't exist (only files in the build output are present, and `session_config.json` is not bundled). Fix: use an environment-driven or in-memory approach. There's also a `.vercel/` directory visible — check if Vercel KV is configured.

```typescript
// operator-dashboard/app/api/session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Try to read from a configured path, fallback to in-memory store for Vercel
// In production on Vercel, this file won't exist — use a simple in-memory store
// or Vercel KV. For now, use a temp file that works on dev and Vercel Edge.
const SESSION_STORE_KEY = process.env.SESSION_STORE_PATH || '';
let sessionState: { session_id: number; status: string } | null = null;

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        if (SESSION_STORE_KEY) {
            const content = fs.readFileSync(SESSION_STORE_KEY, 'utf-8');
            sessionState = JSON.parse(content);
        }
        // Fallback: if no file, return a default or cached state
        const state = sessionState || { session_id: 0, status: 'idle' };
        return NextResponse.json(state);
    } catch (error) {
        console.error('Session GET error:', error);
        return NextResponse.json(
            { success: false, error: 'Session not available' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        sessionState = {
            session_id: body.session_id ?? 0,
            status: body.status ?? 'idle',
        };
        // Try to persist to file if path is configured
        if (SESSION_STORE_KEY) {
            fs.writeFileSync(SESSION_STORE_KEY, JSON.stringify(sessionState, null, 2));
        }
        return NextResponse.json({
            success: true,
            message: 'State Updated',
            session_id: sessionState.session_id,
            status: sessionState.status,
        });
    } catch (error) {
        console.error('Session POST error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to update session' },
            { status: 500 }
        );
    }
}
```

**Verification:** After deployment, `curl -X POST https://operator-dashboard-wine.vercel.app/api/session -H "Content-Type: application/json" -d '{"session_id":1,"status":"locked"}'` should return `success:true`.
Then `curl https://operator-dashboard-wine.vercel.app/api/session` should return the stored state.

### Task 2: Set SESSION_STORE_PATH env var for Vercel

Use a known writable path. On Vercel, `/tmp/` is writable. Set `SESSION_STORE_PATH=/tmp/session_config.json` as a Vercel environment variable. On local dev, the existing `session_config.json` at repo root still works if `SESSION_STORE_PATH` is set to the absolute path, or the code falls back to in-memory.

Actually — since both dev and Vercel need the same code, and Vercel doesn't have the repo's `session_config.json`, the simplest approach: keep the file-based approach but make the path configurable via env var, defaulting to the repo-root file on dev. On Vercel, set the env var to `/tmp/session_config.json`.

**Verification:** Deploy and test the curl commands from Task 1.

### Task 3: Investigate and address wallet warnings — add domain trust nudge + verify metadata

The warnings are wallet-extension-side. Two things to check/fix:

**3a. Verify the deployed site has no metadata gaps**

The `layout.tsx` metadata should be correct. Check that the deployed page includes:
- Proper `<title>` and `<meta name="description">`
- Favicon at `/favicon.svg` (or `.ico`)
- No console errors on load

If these are fine (they should be), the warnings are purely extension-level and not fixable via code.

**3b. Add a site-trust explanation UI**

Add a small info box near the wallet connection UI:
```
"Your wallet extension may show a warning on first visit. This is normal — the
wallet is asking you to approve this domain for signing. For Phantom: click
"Approve" or toggle the site on in Phantom settings. For Solflare: click
"Approve" or mark the site as trusted."
```

**File:** `operator-dashboard/components/WalletUI.tsx` or wherever the wallet connection UI lives. Add an info banner that explains the wallet warning is expected and how to resolve it in each extension.

**3c. (Optional) Configure wallet adapter with explicit wallets list**

If the user wants to explicitly support Phantom and Solflare (to avoid relying solely on Wallet Standard auto-detection), add them back with proper config:

```typescript
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
], []);
```

This is optional — Wallet Standard auto-detection should handle it. But if the warnings persist, explicit adapters give more control over the connection flow. Note: this will also re-trigger the console warning about "Phantom was registered as a Standard Wallet" — which is a known deprecation notice and not a bug.

### Task 4: Reconnect Vercel project and set environment variables

The `vercel whoami` returned zero projects, meaning the project may have been deleted or the CLI session lost. Steps:

```bash
cd operator-dashboard/
export VERCEL_TOKEN="[REDACTED]"
vercel link --yes  # re-link to the existing project
# After linking, set env vars:
vercel env add NEXT_PUBLIC_SOLANA_RPC "https://solana-devnet.g.alchemy.com/v2/alch_18IfjxfhzdbYvYEbUivwJ" --production --yes
vercel env add SESSION_STORE_PATH "/tmp/session_config.json" --production --yes
vercel deploy --prod --yes
redis-cli ???  # If using Vercel KV / Upstash, configure connection string as env var
```

If `vercel link` can't find the project, may need to create a new one or import from GitHub:
```bash
vercel import github://razz492/Fallback-Protocol --cwd operator-dashboard/ --yes
```

Then configure env vars and redeploy.

### Task 5: Test end-to-end after deploy

1. Open `https://operator-dashboard-wine.vercel.app` in a browser with Phantom and/or Solflare installed
2. Check console for errors (should be clean except possibly the Wallet Standard deprecation notice)
3. Connect wallet, check if warnings appear
4. Approve the domain in the wallet extension
5. Stake and accept a task — verify transaction succeeds without warnings (or with only the expected first-time approval)

## Risks, Tradeoffs, and Open Questions

- **Session state persistence:** If we use in-memory store, state is lost between serverless function invocations. Vercel KV (Redis) would be better for persistent state. This is a known limitation — the current file-based approach is a temporary solution.
- **Wallet warnings cannot be fully eliminated** — wallet extensions decide when to show trust warnings. The best we can do is: clear metadata, domain approval guidance, and consistent site identity.
- **Vercel project state unknown:** `vercel whoami` returned `[]`. The project may need to be re-imported from GitHub. This could change the deployment URL.
- **The wallet warning during sign-in/sign-tx** may be a specific Solflare/Phantom behavior for new domains on devnet — even with proper metadata, the wallet may still show a warning for the first few transactions. This is wallet extension behavior, not app misconfiguration.

## Verification Checklist

- [ ] `curl -X POST https://operator-dashboard-wine.vercel.app/api/session -H "Content-Type: application/json" -d '{"session_id":1,"status":"locked"}'` → `{"success":true,...}`
- [ ] `curl https://operator-dashboard-wine.vercel.app/api/session` → `{"session_id":1,"status":"locked"}`
- [ ] Site loads at deployed URL with no console errors (except optional Wallet Standard notice)
- [ ] Wallet connection UI works and explains domain trust to the user
- [ ] `NEXT_PUBLIC_SOLANA_RPC` env var is set on Vercel (confirmed via `vercel env ls`)
- [ ] `SESSION_STORE_PATH` env var is set on Vercel