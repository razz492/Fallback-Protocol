# Plan: Fix Session Route for Vercel + Investigate Wallet Warnings

## Goal

Fix the `/api/session` route to work on Vercel (it currently fails because `session_config.json` is at the repo root, not bundled with the deployment), and investigate/document the Phantom "red UI" and Solflare "Unknown site" wallet warnings on the deployed Vercel URL.

## Current Context / Assumptions

**What's deployed:**
- Dashboard: `https://operator-dashboard-wine.vercel.app`
- `/api/robot` works (uses `os.tmpdir()`)
- `/api/session` returns `{"success":false}` because it tries to read/write `session_config.json` from the repo root path, which doesn't exist in the Vercel deployment

**Wallet warnings:**
- Phantom: red UI with "Confirm Unsafe" button — user can proceed
- Solflare: "Unknown site — We don't recognize this domain..." — user can proceed
- Both warnings appear on the deployed Vercel URL, even though it's a valid HTTPS domain

**Wallet adapter setup:**
- `WalletContextProvider.tsx`: `wallets = useMemo(() => [], [])` (empty array — relies on auto-detection via Wallet Standard)
- Auto-detection via `@solana/wallet-standard-wallet-adapter-react`'s `useStandardWalletAdapters` hook
- Phantom and Solflare adapters are available as dependencies but not explicitly used

**Session route (current — broken on Vercel):**
```typescript
// Uses process.cwd() which resolves differently on Vercel
const filePath = path.join(process.cwd(), '..', 'session_config.json');
```

**Root cause of session failure on Vercel:** The `session_config.json` file lives at `/home/amr01/fallback_protocol/session_config.json` (repo root), but Vercel only deploys the `operator-dashboard/` directory. The file is not included in the deployment, so the route fails.

## Architecture / Proposed Approach

### Part 1: Fix `/api/session` for Vercel

The `/api/session` route needs to use `os.tmpdir()` like `/api/robot` does, since Vercel serverless functions have a writable `/tmp` directory. The session state will be stored in the serverless function's temp directory, which persists across requests within the same function instance.

### Part 2: Wallet warnings investigation

The Phantom "red UI" and Solflare "Unknown site" warnings are wallet-extension-level security features. They trigger when:
1. The site is not in the wallet's trusted sites list
2. The user hasn't previously approved transactions from this domain

The deployed Vercel URL (`operator-dashboard-wine.vercel.app`) is a valid HTTPS domain, but wallet extensions treat it as "new" until the user interacts with it. This is expected behavior for a new deployment.

**What can be done:**
- The warnings are fundamentally a user-side interaction — the user must approve the site once in each wallet
- After the first approval, the wallet should remember the domain and stop showing warnings
- No code change can bypass this security feature (it's enforced by the wallet extension)

**What the plan will do:**
1. Fix the session route for Vercel
2. Add a user-facing note about the wallet warnings (documenting that they're expected on first visit)
3. Optionally add explicit Phantom/Solflare wallet adapters back (they were removed earlier due to a console warning, but the warning is harmless)

## Step-by-Step Tasks

### Task 1: Fix `/api/session` to use `os.tmpdir()` on Vercel

**File:** `operator-dashboard/app/api/session/route.ts`

Replace the file-based approach with `os.tmpdir()` approach (same pattern as `/api/robot`).

**Current (broken on Vercel):**
```typescript
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), '..', 'session_config.json');
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContents);
        return NextResponse.json({
            session_id: data.session_id ?? 200,
            status: data.status ?? 'idle'
        });
    } catch (error) {
        return NextResponse.json({ session_id: 200, status: 'idle' });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const filePath = path.join(process.cwd(), '..', 'session_config.json');
        let currentData = { session_id: 200, status: 'idle' };
        if (fs.existsSync(filePath)) {
            try {
                currentData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (e) { }
        }
        const newData = { ...currentData, ...body };
        fs.writeFileSync(filePath, JSON.stringify(newData));
        return NextResponse.json({ success: true, message: "State Updated" });
    } catch (error) {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}
```

**New (works on Vercel):**
```typescript
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use Vercel's writable temp directory for session state persistence
const sessionFilePath = path.join(os.tmpdir(), 'session_config.json');

function readSessionFile(): { session_id: number; status: string } {
    try {
        if (fs.existsSync(sessionFilePath)) {
            const contents = fs.readFileSync(sessionFilePath, 'utf8');
            return JSON.parse(contents);
        }
    } catch { }
    return { session_id: 200, status: 'idle' };
}

function writeSessionFile(data: { session_id: number; status: string }): void {
    fs.writeFileSync(sessionFilePath, JSON.stringify(data));
}

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const data = readSessionFile();
        return NextResponse.json({
            session_id: data.session_id ?? 200,
            status: data.status ?? 'idle'
        });
    } catch {
        return NextResponse.json({ session_id: 200, status: 'idle' });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const currentData = readSessionFile();
        const newData = { ...currentData, ...body };
        writeSessionFile(newData);
        return NextResponse.json({ success: true, message: "State Updated" });
    } catch {
        return NextResponse.json({ success: false }, { status: 500 });
    }
}
```

**Verification:**
```bash
# After deploying, test:
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" \
  -d '{"session_id":332,"status":"locked"}'
# Expected: {"success":true,"message":"State Updated"}

curl -s https://operator-dashboard-wine.vercel.app/api/session
# Expected: {"session_id":332,"status":"locked"}
```

---

### Task 2: Test the full Vercel API surface

After deploying the session route fix, verify all endpoints work:

```bash
# Test /api/robot POST
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" \
  -d '{"ready":true,"slashed":false,"resolved":false,"tx":null}'
# Expected: {"success":true}

# Test /api/robot GET
curl -s https://operator-dashboard-wine.vercel.app/api/robot
# Expected: {"ready":true,"slashed":false,"resolved":false,"tx":null}

# Test /api/session POST
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" \
  -d '{"session_id":332,"status":"locked"}'
# Expected: {"success":true,"message":"State Updated"}

# Test /api/session GET
curl -s https://operator-dashboard-wine.vercel.app/api/session
# Expected: {"session_id":332,"status":"locked"}
```

---

### Task 3: Commit, push, and trigger Vercel redeploy

```bash
cd /home/amr01/fallback_protocol
git add -A
git commit -m "fix: use os.tmpdir() for session state on Vercel"
git push origin main
```

Vercel auto-deploys on push. Verify the deployment:

```bash
curl -s https://operator-dashboard-wine.vercel.app | grep -o "title>[^<]*</title"
# Expected: title>Fallback Protocol — Operator Dashboard</title
```

Then re-test all API endpoints (Task 2).

---

### Task 4: Document the wallet warnings for users

**File:** `operator-dashboard/README.md` (update the wallet section)

Add a clear explanation that the Phantom "red UI" and Solflare "Unknown site" warnings are expected on first visit, and how to resolve them:

```markdown
## Wallet Warnings on First Visit

When you first visit the dashboard and connect your wallet, Phantom and Solflare
may show security warnings:

- **Phantom:** Red UI with "Confirm Unsafe" button
- **Solflare:** "Unknown site — We don't recognize this domain..." warning

This is **normal behavior** for first-time visits to a new domain. The wallets
are asking you to confirm that you trust the site before connecting.

**To resolve:**
1. Click "Confirm Unsafe" (Phantom) or "Proceed" / "I understand" (Solflare)
2. The wallet will remember the site for future visits
3. The warnings should not appear on subsequent visits

**If warnings persist after the first approval:**
- Make sure your wallet extensions are up-to-date
- Try clearing the wallet's site data (Phantom: Settings → Advanced → Clear site data)
- The Vercel URL (`operator-dashboard-wine.vercel.app`) is a legitimate HTTPS domain
```

---

### Task 5: (Optional) Add explicit Phantom/Solflare wallet adapters back

The wallet adapters were removed earlier because they triggered a console warning ("Phantom was registered as a Standard Wallet"). This warning is harmless — it just means the adapter is redundant with the auto-detection. However, adding them back explicitly might improve wallet discovery reliability.

**File:** `operator-dashboard/components/WalletContextProvider.tsx`

```typescript
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

// ...

const wallets = useMemo(
    () => [
        new PhantomWalletAdapter(),
        new SolflareWalletAdapter(),
    ],
    []
);
```

**Verification:**
```bash
cd /home/amr01/fallback_protocol/operator-dashboard
npx tsc --noEmit --project tsconfig.json
# Expected: no type errors
```

**Tradeoff:** This re-introduces the harmless console warning but may improve wallet discovery reliability. The auto-detection via Wallet Standard should work, but explicit adapters provide a fallback.

---

## Tests / Validation

### Pre-deployment (local)
```bash
cd /home/amr01/fallback_protocol/operator-dashboard
npx tsc --noEmit --project tsconfig.json
# Expected: no type errors

# Build check
npm run build 2>&1 | tail -5
# Expected: Route (app) ... Build Completed successfully
```

### Post-deployment (Vercel)
```bash
# Verify deployment
curl -s https://operator-dashboard-wine.vercel.app | grep -o "title>[^<]*</title"
# Expected: title>Fallback Protocol — Operator Dashboard</title

# Test all API endpoints
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" -d '{"ready":true}'
# Expected: {"success":true}

curl -s -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" -d '{"session_id":1,"status":"locked"}'
# Expected: {"success":true,"message":"State Updated"}

curl -s https://operator-dashboard-wine.vercel.app/api/robot
# Expected: {"ready":true,...}

curl -s https://operator-dashboard-wine.vercel.app/api/session
# Expected: {"session_id":1,"status":"locked"}
```

### Wallet warning test (manual, in browser)
1. Open `https://operator-dashboard-wine.vercel.app` in a browser with Phantom and Solflare installed
2. Click the wallet connect button
3. Observe the warnings (expected on first visit)
4. Approve the connection in each wallet
5. Refresh the page and reconnect — warnings should NOT appear (wallet remembers the site)

## Risks, Tradeoffs, and Open Questions

1. **Session state persistence on Vercel:** Using `os.tmpdir()` means session state is stored in the serverless function's temp directory. This persists across requests within the same function instance but may be lost when Vercel recycles the function. For the demo/operator use case, this is acceptable — the session state is transient.

2. **`session_config.json` at repo root:** The file at `/home/amr01/fallback_protocol/session_config.json` is for local development only. It's not bundled with the Vercel deployment. The Vercel deployment uses its own temp-based storage. The local file and Vercel storage are separate — changes on Vercel don't affect the local file and vice versa.

3. **Wallet warnings are user-side:** The Phantom "red UI" and Solflare "Unknown site" warnings are enforced by the wallet extensions, not the web app. The app cannot bypass these warnings. The user must approve the site once in each wallet. This is a security feature, not a bug.

4. **Ngrok tunnel:** The ngrok tunnel (`gatherer-shopping-yam.ngrok-free.dev`) is no longer needed since the robot client scripts now use the Vercel deployment URL directly. The tunnel can be left running or stopped — it won't affect anything.

5. **ROS WebSocket localhost constraint:** The dashboard's ROS WebSocket connection (`ws://127.0.0.1:9090`) requires the browser to connect to localhost. This means the browser must run on the same machine as the ROS nodes. The dashboard can be served from Vercel (HTML from CDN) but the WebSocket connection is to the user's local ROSBridge. This is by design and works correctly.

6. **Explicit wallet adapters tradeoff:** Adding Phantom/Solflare adapters back explicitly may improve wallet discovery but re-introduces a harmless console warning. The Wallet Standard auto-detection should handle discovery, but explicit adapters provide a fallback. Worth testing both approaches.
