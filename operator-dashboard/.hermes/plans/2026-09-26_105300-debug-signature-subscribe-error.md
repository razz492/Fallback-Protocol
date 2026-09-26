# Debug Plan: signatureSubscribe RPC Error in Operator Dashboard

## Goal

Fix the repeated `signatureSubscribe` JSON-RPC errors (-32601 "Method not found") that cause transaction confirmation failures with `TransactionExpiredBlockheightExceededError`.

## Current Context / Assumptions

**Observed symptoms:**
- `npm run dev` starts the Next.js dev server on `localhost:3000`
- Phantom wallet connects successfully ("Phantom was registered as a Standard Wallet")
- When a user initiates a transaction (acceptTask/resolveTask), `sendTransaction()` succeeds and returns a signature
- Then `connection.confirmTransaction()` is called, which triggers repeated `signatureSubscribe` JSON-RPC calls
- All `signatureSubscribe` calls fail with error code `-32601`, message "Method 'signatureSubscribe' not found"
- Eventually the transaction expires: `TransactionExpiredBlockheightExceededError: block height exceeded`
- The user never gets confirmation feedback; the UI shows "❌ Failed: ..."

**Environment:**
- Project: `operator-dashboard/` (Next.js 16.3.5, React 19, TypeScript, Turbopack)
- Solana stack: `@solana/web3.js@^1.99.0`, `@solana/wallet-adapter-react@^0.15.40`, `@solana/wallet-adapter-wallets@^0.19.39`
- Network: Solana Devnet via Alchemy (`https://solana-devnet.g.alchemy.com/v2/...`)
- Wallet: Phantom (browser extension)

**Key files:**
- `app/page.tsx:371-379` — `acceptTask` calls `connection.confirmTransaction()` with `'confirmed'` commitment
- `app/page.tsx:469-477` — `resolveTask` has identical pattern
- `components/WalletContextProvider.tsx` — wraps app with `ConnectionProvider` using Alchemy Devnet RPC
- `package.json` — all dependency versions

**Root cause hypothesis:**
The `connection.confirmTransaction()` method in `@solana/web3.js` v1 uses `signatureSubscribe` under the hood for real-time confirmation tracking. The Alchemy Devnet RPC endpoint may not support `signatureSubscribe` (it's a websocket/account-subscribe style method that some RPC providers don't expose). The repeated logs show the same signature being polled — this is `confirmTransaction` retrying the subscription.

## Architecture / Proposed Approach

**Option A — Use `getSignatureStatus` polling instead of `confirmTransaction`:**

Replace `connection.confirmTransaction()` with a manual polling loop using `connection.getSignatureStatus()`. This uses only standard RPC methods (`getSignatureStatus` is universally supported).

**Option B — Use a different commitment/confirmation strategy:**

Try `'processed'` or `'finalized'` commitment in `confirmTransaction`, or use `getSignatureStatus` with a timeout loop.

**Option C — Add error handling with fallback:**

Wrap `confirmTransaction` in try/catch, and on failure fall back to polling `getSignatureStatus`.

**Recommendation:** Go with **Option A** — replace `confirmTransaction` with a `getSignatureStatus` polling helper. It's the most reliable across RPC providers, avoids the `signatureSubscribe` dependency entirely, and gives us full control over timeout/retry behavior.

## Step-by-Step Tasks

### Task 1: Create a `pollSignatureConfirmation` helper

Create a reusable confirmation helper that polls `getSignatureStatus` until confirmed, finalized, or timeout.

**File:** `lib/confirmTransaction.ts` (new file)

```typescript
import { Connection, SignatureStatus, ConfirmedSignature, Commitment } from "@solana/web3.js";

export type ConfirmationResult =
  | { status: "confirmed"; signature: string; blockNumber: number }
  | { status: "finalized"; signature: string; blockNumber: number }
  | { status: "expired"; signature: string; reason: string }
  | { status: "timeout"; signature: string; reason: string };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 40; // ~60 seconds total

export async function pollSignatureConfirmation(
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed",
  timeoutMs: number = 30000
): Promise<ConfirmationResult> {
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      return { status: "timeout", signature, reason: `Timed out after ${timeoutMs / 1000}s` };
    }

    try {
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      if (status && status.err) {
        return { status: "expired", signature, reason: `Transaction failed: ${status.err}` };
      }

      if (status && status.confirmationStatus) {
        if (commitment === "finalized" && status.confirmationStatus === "finalized") {
          const blockNumber = status.blockHeight ?? 0;
          return { status: "finalized", signature, blockNumber };
        }
        if (commitment === "confirmed" && status.confirmationStatus === "confirmed") {
          const blockNumber = status.blockHeight ?? 0;
          return { status: "confirmed", signature, blockNumber };
        }
        // For "processed" commitment, check if it's at least processed
        if (commitment === "processed" && ["processed", "confirmed", "finalized"].includes(status.confirmationStatus)) {
          const blockNumber = status.blockHeight ?? 0;
          return { status: "confirmed", signature, blockNumber };
        }
      }

      // No status yet — wait and retry
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch (err) {
      // Network glitch — retry
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return { status: "timeout", signature, reason: `Exceeded ${MAX_ATTEMPTS} polling attempts` };
}
```

**Verification:**
```bash
# From operator-dashboard/ directory
cd /home/amr01/fallback_protocol/operator-dashboard
npx tsc --noEmit lib/confirmTransaction.ts  # Should compile clean
```

---

### Task 2: Replace `connection.confirmTransaction` in `acceptTask`

**File:** `app/page.tsx` (lines 370-379)

Replace:
```typescript
            setStatus("⏳ Confirming transaction on Devnet...");
            await withTimeout(
                connection.confirmTransaction({
                    signature,
                    blockhash: latestBlockhash.blockhash,
                    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
                }, 'confirmed'),
                30000,
                'Transaction confirmation'
            );
            console.log("[acceptTask] Transaction confirmed!");
```

With:
```typescript
            setStatus("⏳ Confirming transaction on Devnet...");
            const confirmation = await withTimeout(
                pollSignatureConfirmation(connection, signature, "confirmed", 30000),
                30000,
                "Transaction confirmation"
            );
            if (confirmation.status === "timeout" || confirmation.status === "expired") {
                throw new Error(confirmation.reason);
            }
            console.log(`[acceptTask] Transaction ${confirmation.status}: signature ${confirmation.signature}`);
```

**Verification:**
- Start dev server: `npm run dev`
- Connect Phantom wallet
- Trigger an `acceptTask` transaction
- Console should show confirmation poll progress instead of repeated `signatureSubscribe` errors
- Transaction should confirm successfully

---

### Task 3: Replace `connection.confirmTransaction` in `resolveTask`

**File:** `app/page.tsx` (lines 468-477)

Same replacement pattern as Task 2 — swap `connection.confirmTransaction(...)` for `pollSignatureConfirmation(connection, signature, "confirmed", 30000)`.

---

### Task 4: Address the Phantom wallet adapter warning

**File:** `components/WalletContextProvider.tsx`

We currently get: `[browser] Phantom was registered as a Standard Wallet. The Wallet Adapter for Phantom can be removed from your app.`

This is a deprecation notice. The modern approach (as of wallet-adapter v0.19.x) is to use `@solana/wallet-adapter-wallets` exports properly — but Phantom may also be auto-detected now.

**To investigate:** Check the `@solana/wallet-adapter-wallets` changelog / Phantom's current recommended integration. For now, this is a cosmetic warning that doesn't affect functionality — mark as low priority.

---

### Task 5: (Optional) Clean up the Turbopack warnings

**File:** `next.config.ts`

Two warnings:
1. "Next.js ignored package-lock.json in /home/amr01 because it is outside the current Git repository"
2. "Next.js inferred your workspace root... Detected additional lockfiles: /home/amr01/fallback_protocol/operator-dashboard/package-lock.json"

These are non-blocking warnings. To silence them, add `turbopack.root` to `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['@coral-xyz/anchor'],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
```

---

## Tests / Validation

### Manual validation (post-fix)
1. Start dev server: `cd /home/amr01/fallback_protocol/operator-dashboard && npm run dev`
2. Open `http://localhost:3000` in a browser with Phantom wallet installed
3. Connect wallet
4. Click "Accept Task" on a session
5. **Expected:** No `signatureSubscribe` errors in console. Status progresses: "🔐 Check your wallet extension..." → "⏳ Confirming transaction..." → "📡 Teleoperation Active..."
6. If confirmation fails, the error message should be clear (timeout/expired reason, not a JSON-RPC cryptic error)

### Pre-fix baseline (document current behavior)
Before making changes, capture the current console output showing the `signatureSubscribe` loop so we can confirm the fix eliminates it.

---

## Risks, Tradeoffs, and Open Questions

1. **`getSignatureStatus` vs `signatureSubscribe`:** `getSignatureStatus` is a polling approach (HTTP request every 1.5s). This is less efficient than websocket subscription but is universally supported. Tradeoff: slightly more RPC calls, but far more reliable.

2. **`searchTransactionHistory: true`:** This parameter can be expensive on some RPC providers. If we see rate-limiting, we can remove it and rely on the default behavior (checking recent blocks only). For devnet, this shouldn't be an issue.

3. **Commitment levels:** The current code uses `'confirmed'`. If we need `'finalized'` for stronger guarantees, the helper already supports it via the `commitment` parameter.

4. **Phantom warning:** The "Standard Wallet" warning may indicate the wallet adapter is using a deprecated Phantom integration path. If Phantom stops working in the future, we'll need to update to the latest Phantom adapter approach. Not blocking now.

5. **Transaction expiry:** The `TransactionExpiredBlockheightExceededError` is a consequence of the confirmation failure, not a separate bug. Once `confirmTransaction` is replaced with reliable polling, this error should disappear. However, if the user takes too long to approve in their wallet, the transaction can still expire — the UI already handles this with a 60s wallet approval timeout.

6. **Duplicate lockfiles:** The monorepo-style setup with `operator-dashboard/package-lock.json` inside `fallback_protocol/package-lock.json` is unusual. The turbopack warnings are non-blocking but could cause issues with dependency resolution in edge cases. Consider consolidating to a single lockfile if this becomes a real project.
