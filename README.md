# Fallback Protocol — Remote Teleoperation Safety Net for Autonomous Mobile Robots

A Solana-based fallback system for autonomous mobile robots (AMRs): when a robot encounters an unrecoverable edge case, it escrows a bounty on-chain and yields control to a remote human operator who stakes a bond to resolve the incident. If the operator times out, the robot reclaims both the bounty and the bond.

**Live demo:** https://operator-dashboard-wine.vercel.app

---

## Architecture

```
                    ┌─────────────────────────┐
                    │   Solana Devnet (RPC)   │
                    │  program: fallback_     │
                    │  protocol H8FY...       │
                    └──────────┬──────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
┌─────────┴─────────┐  ┌──────┴──────┐  ┌──────────┴──────────┐
│   Robot Client     │  │  Dashboard  │  │   Operator Client    │
│   (Python)         │  │  (Next.js)  │  │   (Python)          │
│   robot_client.py  │  │  /find-work │  │   operator_client.py │
│   robotaxi_client  │  │  /incident  │  │                     │
│   task_resolved.py │  │  /claim     │  │                     │
│   task_failed.py   │  │             │  │                     │
└─────────┬──────────┘  └──────┬──────┘  └─────────────────────┘
          │                    │
          │   Vercel deploy   │
          └────────────────────┘
```

**On-chain state machine** (Session account PDA):

```
  [Open] ──robot funds bounty──> [Active] ──operator stakes bond──> [Active]
    │                                                           │
    │                        (operator resolves)                │ (robot times out)
    │                                                           │
    └──────────────────< [Resolved] ──payout bounty+bond ──────┘
                                                              [Slashed]
```

**Four instructions** (defined in `programs/fallback_protocol/src/lib.rs`):

| Instruction | Called by | Effect |
|---|---|---|
| `request_fallback` | Robot | Creates Session PDA, escrows bounty from robot wallet |
| `accept_task` | Operator | Stakes bond from operator wallet, marks session Active (5-min SLA) |
| `resolve_task` | Operator | Marks Resolved, pays out bounty + bond to operator |
| `cancel_timeout` | Robot | Marks Slashed, refunds bounty + bond to robot (operator loses bond) |

**Dashboard API endpoints** (Next.js API routes in `operator-dashboard/app/api/`):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/robot` | POST | Robot signals state: `{ready, slashed, resolved, tx}` |
| `/api/session` | POST | Session status updates: `{session_id, status}` |
| `/api/simulate/robot/` | POST | Backend simulation of robot crash (needs `SIMULATE_ROBOT_KEYPAIR`) |
| `/api/simulate/robotaxi/` | POST | Backend simulation of robotaxi deadlock (needs `SIMULATE_ROBOT_KEYPAIR`) |

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| npm | 9+ | ships with Node.js |
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| Anchor CLI | 0.31.x | `curl -sSf https://raw.githubusercontent.com/solana-developers/anchor/master/scripts/install.sh | sh` |
| Solana CLI | 2.x | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Python | 3.12 | system package manager |
| Phantom wallet (browser extension) | latest | https://phantom.app |
| Phantom wallet (mobile) | latest | App Store / Play Store |

**Configured before first run:**

1. **Solana CLI configured for devnet:**
   ```
   solana config set --url https://api.devnet.solana.com
   ```

2. **Wallet keypair at `~/.config/solana/id.json`** (robot's keypair — used by robot_client.py, robotaxi_client.py, task_failed.py, task_resolved.py):
   ```
   solana-keygen new --outfile ~/.config/solana/id.json
   ```

3. **Airdrop the robot wallet on devnet** (you need SOL to fund bounties):
   ```
   solana airdrop 2
   ```
   The robot wallet is the one in `~/.config/solana/id.json`. Check balance:
   ```
   solana balance
   ```

4. **Operator wallet** (separate keypair for the human operator — used by operator_client.py and the dashboard):
   - For the dashboard: connect Phantom browser extension (any devnet wallet with SOL).
   - For `operator_client.py`: create `operator.json` in the repo root (operator's keypair in JSON array format):
     ```
     solana-keygen new --outfile operator.json
     solana airdrop --keypair operator.json 2
     ```

5. **Python dependencies** (from repo root):
   ```
   python3 -m venv venv
   source venv/bin/activate
   pip install solana solders requests
   ```

---

## Repository Structure

```
fallback_protocol/
├── programs/
│   └── fallback_protocol/
│       ├── Cargo.toml              # Anchor program manifest (idl-build feature)
│       ├── Xargo.toml              # Cross-compilation config
│       ├── Anchor.toml             # Anchor config: devnet, program ID, cluster
│       └── src/
│           └── lib.rs              # On-chain program: 4 instructions, Session struct, errors
├── operator-dashboard/             # Next.js 16.3.5 operator UI
│   ├── app/
│   │   ├── layout.tsx              # Root layout: ConnectionProvider, WalletAdapterProvider
│   │   ├── page.tsx                # Main UI: wallet connect, Find Work, incident card, accept/resolve
│   │   ├── idl/
│   │   │   └── fallback_protocol.json   # Generated IDL (auto-regenerated by build)
│   │   └── api/
│   │       ├── robot/route.ts      # POST /api/robot — robot state signals
│   │       ├── session/route.ts    # POST /api/session — session status updates
│   │       ├── simulate/
│   │       │   ├── robot/route.ts      # POST /api/simulate/robot — bot-side crash sim
│   │       │   └── robotaxi/route.ts   # POST /api/simulate/robotaxi — bot-side deadlock sim
│   │       └── ...                 # (other API routes)
│   ├── components/                 # React components (WalletContextProvider, etc.)
│   ├── scripts/
│   │   ├── generate-idl.mjs        # Runs `anchor idl build` and writes IDL JSON
│   │   └── check-idl-ci.mjs        # CI guard: verifies checked-in IDL matches generated
│   ├── package.json                # Dashboard deps + build script (idl-gen → next build)
│   └── .gitignore
├── robot_client.py                 # Robot: trigger deadlock, fund 0.1 SOL bounty, signal dashboard
├── robotaxi_client.py              # Robotaxi: trigger deadlock, fund 1.0 SOL bounty, signal dashboard
├── task_resolved.py                # Robot: signal resolution → unlocks Claim button on dashboard
├── task_failed.py                  # Robot: signal timeout slash → reclaims bounty + bond
├── operator_client.py              # Operator: stake bond, accept task, resolve (CLI equivalent of dashboard)
├── session_manager.py              # Local session_config.json read/write (pure local state)
├── timeout_client.py               # Timeout/cancel script
├── run_robots.sh                   # Interactive launcher (1=deadlock, 2=robotaxi, 3=resolved, 4=slash)
├── start_teleop.sh                 # Starts ROS 2 nodes (Gazebo, rosbridge :9090, web_video_server :8080)
├── package.json                    # Root: Anchor/TS test deps (mocha, chai, ts-mocha)
├── Cargo.toml                      # Rust workspace (members = programs/*)
├── Anchor.toml                     # Anchor config (devnet, program ID H8FY..., cluster Devnet)
├── vercel.json                     # Vercel config: rootDir=operator-dashboard
├── .gitignore
└── .github/workflows/
    └── dashboard.yml               # CI: checkout → node → rust → anchor → npm ci → idl gen → tsc → build
```

---

## Quick Start (Full End-to-End)

### Step 1: Build and deploy the on-chain program

From the repo root:

```
# Build the program (compiles Rust + generates IDL)
anchor build

# Deploy to devnet (uses the wallet in ~/.config/solana/id.json)
anchor deploy --provider.cluster devnet
```

This compiles `programs/fallback_protocol/src/lib.rs`, produces the BPF binary, and deploys to Solana devnet. The program ID is `H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT` (configured in `Anchor.toml` and `programs/fallback_protocol/Cargo.toml`).

### Step 2: Start the dashboard

From `operator-dashboard/`:

```
npm install
npm run dev
```

The dashboard opens at `http://localhost:3000`. Connect your Phantom wallet (devnet) and you'll see the Find Work page.

**For production deployment** (Vercel):

```
cd operator-dashboard
vercel --prod
```

The deployed URL is `https://operator-dashboard-wine.vercel.app`. The `npm run build` script auto-generates the IDL before building (`node scripts/generate-idl.mjs && next build`).

### Step 3: Trigger a robot incident

From the repo root (with venv activated):

```
./run_robots.sh
# Choose:
#   1 : Trigger Deadlock   (robot_client.py — 0.1 SOL bounty, delivery robot)
#   2 : Trigger Robotaxi   (robotaxi_client.py — 1.0 SOL bounty, robotaxi)
#   3 : 🟢 Signal Resolved (task_resolved.py)
#   4 : 🔴 Signal Slashed  (task_failed.py)
```

**What happens when you choose option 1 (Trigger Deadlock):**

1. `robot_client.py` reads `~/.config/solana/id.json` for the robot keypair
2. Increments `session_id` in `session_config.json` (via `session_manager.py`) until it finds a session ID whose PDA doesn't already exist on-chain
3. Derives the Session PDA: `Pubkey.find_program_address([b"session", robot_pubkey, session_id_u64_le], program_id)`
4. Builds a `request_fallback` instruction with discriminator + `(session_id, bounty_lamports)` args
5. Sends the transaction to devnet (escrows 0.1 SOL from robot wallet into the Session PDA)
6. Waits 3 seconds for cluster gossip to propagate the new PDA
7. POSTs to `https://operator-dashboard-wine.vercel.app/api/robot` with `{ready: true, slashed: false, resolved: false, tx: <signature>}`
8. Falls back to `http://localhost:3000/api/robot` if the Vercel endpoint is unreachable
9. Prints the explorer URL and signs off

**What happens when you choose option 3 (Signal Resolved):**

1. `task_resolved.py` POSTs to `/api/robot` with `{ready: true, slashed: false, resolved: true}`
2. The dashboard receives this and enables the "Claim" button on the incident card

**What happens when you choose option 4 (Signal Slashed):**

1. `task_failed.py` reads the current session ID, derives the Session PDA, builds a `cancel_timeout` instruction
2. Sends the transaction (marks session Slashed, refunds bounty + bond to robot)
3. POSTs to `/api/robot` with `{ready: true, slashed: true, resolved: false, tx: <signature>}`
4. The dashboard shows the slash state

### Step 4: Operator accepts and resolves (via dashboard)

1. Open the dashboard, connect Phantom (devnet wallet with ≥0.05 SOL for delivery or ≥0.5 SOL for robotaxi)
2. On the Find Work page, select a vehicle profile (Delivery Robots / Robotaxis)
3. Click **Go Online & Find Work** — the dashboard polls for robot signals via the `/api/robot` endpoint
4. When a robot signal arrives, the incident card appears showing:
   - Session ID, robot pubkey, bounty amount
   - Wallet address + balance + needed stake
5. Click **Stake X SOL & Accept** — the dashboard builds an `accept_task` instruction, signs with Phantom, sends to devnet
6. After acceptance, the **Claim X SOL** button appears
7. When the robot signals resolved (`task_resolved.py`), the Claim button becomes active
8. Click **Claim** — the dashboard builds a `resolve_task` instruction, signs, sends, and shows the receipt

### Step 5: Operator accepts and resolves (via CLI)

Alternatively, use `operator_client.py` as a CLI equivalent:

```
python3 operator_client.py
```

This script:
1. Loads the operator keypair from `operator.json`
2. Reads the current session ID from `session_config.json`
3. Derives the Session PDA (same seeds as the robot)
4. Builds and sends `accept_task` (stakes 0.05 SOL bond)
5. Waits 15 seconds, then builds and sends `resolve_task` with a telemetry hash

---

## Robot Client Details

### `robot_client.py` — Delivery Robot (0.1 SOL bounty)

```
python3 robot_client.py
```

- Bounty: 0.1 SOL (100,000,000 lamports)
- Uses `~/.config/solana/id.json` as robot keypair
- Session PDA seeds: `[b"session", robot_pubkey_bytes, session_id_u64_le]`
- After funding the bounty, signals dashboard via Vercel API → localhost fallback

### `robotaxi_client.py` — Robotaxi (1.0 SOL bounty)

```
python3 robotaxi_client.py
```

- Bounty: 1.0 SOL (1,000,000,000 lamports)
- Same flow as `robot_client.py` but higher stake and different print messages

### `session_manager.py` — Local session state

Pure local-state module. Reads/writes `session_config.json` in the repo root. Does NOT make RPC calls.

```
from session_manager import increment_session_id, get_current_session_id, set_session_state

session_id = increment_session_id()   # reads config, adds 1, writes back
set_session_state(session_id=350, status="locked")
```

**Important:** `robot_client.py` does its own PDA-existence check (queries `get_account_info` on the derived PDA and skips session IDs whose PDAs already exist on-chain). This is because `session_manager.py` only tracks local state — it doesn't know if a session ID was used in a previous run that left the PDA allocated on-chain.

### `task_resolved.py` — Resolution signal

```
python3 task_resolved.py
```

One-shot script. POSTs `{ready: true, slashed: false, resolved: true}` to the dashboard. No on-chain transaction — just a signal.

### `task_failed.py` — Timeout slash signal

```
python3 task_failed.py
```

1. Reads current session ID from `session_config.json`
2. Loads robot keypair from `~/.config/solana/id.json`
3. Derives Session PDA
4. Builds and sends `cancel_timeout` instruction (marks Slashed, refunds bounty + bond to robot)
5. POSTs slash signal to dashboard

### `timeout_client.py` — Cancel/Timeout (CLI)
Robot-side script that cancels an active session and slashes the operator's bond (`cancel_timeout` instruction). Uses the session ID from `session_config.json` and the robot keypair from `~/.config/solana/id.json`.

```
python3 timeout_client.py
```

---

## Dashboard Details

### Environment variables

The dashboard uses one environment variable, set in Vercel project settings (or a `.env.local` file for local dev):

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SOLANA_RPC` | Yes | Solana RPC URL (devnet Alchemy: `https://solana-devnet.g.alchemy.com/v2/alch_18IfjxfhzdbYvYEbUivwJ`) |

The simulation API routes (`/api/simulate/robot/` and `/api/simulate/robotaxi/`) require an additional env var **not yet configured**:

| Variable | Required | Purpose |
|---|---|---|
| `SIMULATE_ROBOT_KEYPAIR` | For simulation routes | Robot keypair secret key (base58-encoded) — used by the backend to sign simulated crash transactions server-side |

Without `SIMULATE_ROBOT_KEYPAIR`, the simulation buttons return `500 { error: "SIMULATE_ROBOT_KEYPAIR env var not configured" }`.

### Wallet connection

The dashboard uses `@solana/wallet-adapter-react` + `@solana/wallet-adapter-react-ui` + `@solana/wallet-adapter-wallets`. Phantom (browser extension or mobile) is the supported wallet. The wallet context is provided by `components/WalletContextProvider.tsx`.

### Transaction flow

All dashboard transactions use `VersionedTransaction` + `ComputeBudgetProgram` (with a legacy `Transaction` fallback for mobile Phantom compatibility). `skipPreflight: true` is set on send — this skips the RPC preflight check but Phantom's own in-popup simulation may still fail on mobile (a known Phantom mobile bug). Transactions succeed on-chain regardless.

**Mobile Phantom warning:** Phantom mobile may show "Not enough SOL" or "Failed to simulate" popups even when the wallet has sufficient SOL and the transaction is valid. This is a Phantom mobile simulation bug. Users should ignore these warnings and approve the transaction — it will confirm on-chain.

**Debug mode:** Append `?debug=true` to the dashboard URL to reveal a diagnostic button ("🧪 Transfer 0.001 SOL to Robot") that sends a test transaction to the robot pubkey (`9kRjRmidhpzdCUckaG4wRKXmqfnDixT4xz6uppEga6b7`) to verify wallet connectivity.

### Profiles and stake amounts

| Profile | Stake | Bounty | File reference |
|---|---|---|---|
| Delivery Robots | 0.05 SOL | ~0.1 SOL | `PROFILES` in `page.tsx` |
| Robotaxis | 0.5 SOL | ~1.0 SOL | `PROFILES` in `page.tsx` |

These are defined as a `PROFILES` constant in `app/page.tsx` and match the bounty amounts hardcoded in `robot_client.py` (0.1 SOL) and `robotaxi_client.py` (1.0 SOL).

---

## API Endpoints

### `POST /api/robot`

**Request body:**
```json
{
  "ready": true,
  "slashed": false,
  "resolved": false,
  "tx": "string (transaction signature, optional)"
}
```

**Response:** `200 OK` with `{status: "ok"}` (or similar).

This endpoint updates the dashboard's robot state. The dashboard polls this endpoint periodically (via the robot signal file or direct API calls) to detect new incidents.

### `POST /api/session`

**Request body:**
```json
{
  "session_id": 350,
  "status": "locked"
}
```

**Response:** `200 OK`.

Updates session status. Used by `robot_client.py` and `robotaxi_client.py` to notify the dashboard that a session is locked.

### `POST /api/simulate/robot/`

Simulates a robot crash server-side (requires `SIMULATE_ROBOT_KEYPAIR` env var). Builds and sends a `request_fallback` transaction from the robot keypair, then notifies the dashboard.

**Response on success:**
```json
{
  "success": true,
  "signature": "string",
  "session_id": 351,
  "explorer_url": "https://explorer.solana.com/tx/...?cluster=devnet"
}
```

**Response when env var missing:**
```json
{
  "error": "SIMULATE_ROBOT_KEYPAIR env var not configured"
}
```
(staus 500)

### `POST /api/simulate/robotaxi/`

Same as above but with a 1.0 SOL bounty (robotaxi profile).

---

## IDL Generation and CI

The checked-in IDL at `operator-dashboard/app/idl/fallback_protocol.json` is auto-generated from the Anchor program source. It must be regenerated whenever `programs/fallback_protocol/src/lib.rs` changes.

### Regenerate the IDL (local)

```
cd operator-dashboard
node scripts/generate-idl.mjs
```

This script:
1. Checks if the `anchor` CLI is available on PATH
2. If available: runs `anchor idl build -- --package fallback_protocol` from the repo root, captures the JSON output, and writes it to `app/idl/fallback_protocol.json`
3. If `anchor` is not available (e.g. on Vercel's build environment): skips silently — the existing checked-in IDL is used as-is

The script uses `__dirname` resolved from `import.meta.url` (ES module compatible) and resolves paths relative to the project root, not the `scripts/` directory.

### CI guard (`check-idl-ci.mjs`)

```
cd operator-dashboard
node scripts/check-idl-ci.mjs
```

Compares the checked-in IDL against a freshly generated one. Exits 0 if they match, 1 if they don't (with a message like `❌ CI IDL check failed: Program address mismatch: checked-in=WRONG, generated=H8FY...`).

### Build script (`package.json`)

```
"build": "node scripts/generate-idl.mjs && next build"
```

The IDL is regenerated during `npm run build` before Next.js compiles. This ensures Vercel deployments always have a fresh IDL.

### GitHub Actions (`.github/workflows/dashboard.yml`)

Triggered on push/PR to `main` when files in `operator-dashboard/` or `programs/fallback_protocol/` change. Steps:
1. Checkout
2. Setup Node 20
3. Setup Rust (stable)
4. Install Anchor CLI
5. `npm ci` in `operator-dashboard/`
6. `node scripts/generate-idl.mjs` (regenerate IDL from source)
7. `node scripts/check-idl-ci.mjs` (verify checked-in IDL matches)
8. `npx tsc --noEmit` (TypeScript check)
9. `npm run build` (full Next.js build)

---

## ROS 2 Integration (Teleoperation)

The dashboard connects to a local ROS 2 environment for actual teleoperation:

- **ROSBridge:** `ws://127.0.0.1:9090` (hardcoded in the dashboard)
- **web_video_server:** `http://127.0.0.1:8080` (hardcoded in the dashboard)

These are always localhost — the browser connects to ROS on the same machine. For remote ROS, rosbridge must listen on a non-localhost address or a tunnel must be used.

Start the ROS 2 nodes:

```
./start_teleop.sh
```

This launches Gazebo, rosbridge on port 9090, and web_video_server on port 8080.

**Note:** The robot client scripts (`robot_client.py`, `robotaxi_client.py`) are NOT ROS 2 nodes — they are standalone Python scripts using `solders` + `solana.rpc` for on-chain transactions and `requests` for REST API calls. They are not discoverable via `ros2 node list`. The actual ROS 2 nodes (Gazebo, rosbridge, web_video_server) are launched by `start_teleop.sh`.

---

## Testing

### TypeScript check

```
cd operator-dashboard
npx tsc --noEmit
```

Expected: exits 0, no output.

### Build

```
cd operator-dashboard
npm run build
```

Expected: compiles successfully, generates IDL, produces `.next/` output.

### End-to-end flow (manual)

1. Deploy program to devnet: `anchor deploy --provider.cluster devnet`
2. Start dashboard: `cd operator-dashboard && npm run dev`
3. Connect Phantom (devnet) to dashboard at `http://localhost:3000`
4. Airdrop robot wallet: `solana airdrop 2` (robot wallet = `~/.config/solana/id.json`)
5. Trigger deadlock: `python3 robot_client.py`
6. Verify dashboard shows incident card
7. Accept task via dashboard (Stake 0.05 SOL & Accept) or CLI (`python3 operator_client.py`)
8. Signal resolved: `python3 task_resolved.py`
9. Claim bounty on dashboard
10. Verify payout on Solana Explorer

### Simulation buttons (backend, needs env var)

The simulation buttons at the bottom of the Find Work page call `/api/simulate/robot/` and `/api/simulate/robotaxi/`. These require `SIMULATE_ROBOT_KEYPAIR` to be set in the Vercel environment. Without it, they return a 500 error (this is expected behavior — the buttons are for testing the robot-side flow when the robot keypair is configured server-side).

---

## Known Issues and Troubleshooting

### "Session PDA already in use" error

**Symptom:** `robot_client.py` fails with `Allocate: account ... already in use` or `SendTransactionPreflightFailureMessage { message: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x0" }`.

**Cause:** The session ID in `session_config.json` was already used in a previous run, and the Session PDA is still allocated on-chain. Anchor's `init` instruction refuses to re-initialize an existing PDA.

**Fix:** The robot client automatically handles this — it increments the session ID and checks if the PDA exists on-chain via `get_account_info` before using it. If you're running `robot_client.py` manually and hit this, delete or reset `session_config.json` to a lower session ID, or let the client's retry loop find a free one.

### "SIMULATE_ROBOT_KEYPAIR env var not configured"

**Symptom:** Clicking the simulation buttons returns a 500 error with this message.

**Cause:** The `/api/simulate/robot/` and `/api/simulate/robotaxi/` routes require the robot's secret key to be set as an environment variable in the Vercel project settings.

**Fix:** Add `SIMULATE_ROBOT_KEYPAIR` to the Vercel project environment variables (`vercel.com/razz492/operator-dashboard-wine/settings/environment-variables`) with the robot keypair secret key (base58-encoded). Alternatively, use the normal robot client flow (`python3 robot_client.py`) instead of the simulation buttons.

### Phantom mobile "Not enough SOL" warning despite sufficient balance

**Symptom:** Phantom mobile shows "Not enough SOL" or "Failed to simulate" when approving a transaction, but the transaction succeeds on-chain.

**Cause:** Phantom mobile's in-popup simulation is buggy — it incorrectly simulates certain transaction types (self-transfers, multi-instruction VersionedTransactions with ComputeBudgetProgram). The `skipPreflight: true` flag skips the RPC preflight, but Phantom still runs its own simulation in the popup.

**Fix:** Users should ignore the Phantom warning and approve the transaction. The transaction is valid and will confirm on-chain. The dashboard displays a pre-popup notice ("ignore any 'Not enough SOL'/'Failed to simulate' warnings — Phantom mobile bug, tx will succeed") on all transaction paths.

**Workaround implemented:** Diagnostic transfers now go to `ROBOT_PUBKEY` (`9kRjRmidhpzdCUckaG4wRKXmqfnDixT4xz6uppEga6b7`) instead of self-transfer, to avoid Phantom mobile's self-transfer simulation bug. Accept/resolve transactions use legacy `Transaction` format first (better mobile compatibility), falling back to `VersionedTransaction` if needed.

### Dashboard not receiving robot signals

**Symptom:** Robot client reports "✅ Dashboard unlocked" but the dashboard doesn't show the incident.

**Cause:** The robot client tries the Vercel deployment URL first, then falls back to `localhost:3000`. If neither is reachable (e.g. the dashboard isn't running locally and the Vercel deploy is stale), the signal is lost.

**Fix:** Ensure the dashboard is deployed and running. Check the robot client's output for which endpoint succeeded. For local testing, run the dashboard with `npm run dev` and ensure the robot client can reach `localhost:3000`.

---

## Key Identifiers

| Identifier | Value | Used by |
|---|---|---|
| Program ID | `H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT` | All on-chain instructions, PDA derivation |
| Robot pubkey | `9kRjRmidhpzdCUckaG4wRKXmqfnDixT4xz6uppEga6b7` | Diagnostic transfers, PDA derivation reference |
| Operator wallet (dashboard) | `H89Siv45QpSaAWmcMDyMhqSrt3vs1w7D3Gzcp814htD4` | Dashboard Phantom connection (10 SOL on devnet) |
| RPC (devnet) | `https://solana-devnet.g.alchemy.com/v2/alch_18IfjxfhzdbYvYEbUivwJ` | Dashboard `NEXT_PUBLIC_SOLANA_RPC` env var |
| Dashboard URL (production) | `https://operator-dashboard-wine.vercel.app` | Robot client API endpoint |
| Dashboard URL (debug) | `https://operator-dashboard-wine.vercel.app/?debug=true` | Diagnostic button access |
| Robot client API | `https://operator-dashboard-wine.vercel.app/api/robot` | `robot_client.py`, `task_resolved.py`, `task_failed.py` |
| Session client API | `https://operator-dashboard-wine.vercel.app/api/session` | `robot_client.py`, `robotaxi_client.py` |

---

## Stake and Bounty Amounts

| Profile | Robot bounty | Operator stake | Session SLA |
|---|---|---|---|
| Delivery Robots | 0.1 SOL | 0.05 SOL | 5 minutes (300s) |
| Robotaxis | 1.0 SOL | 0.5 SOL | 5 minutes (300s) |

The robot's `request_fallback` bounty and the operator's `accept_task` bond are both transferred into the Session PDA. On `resolve_task`, the total (bounty + bond) is paid out to the operator. On `cancel_timeout`, the total is refunded to the robot.

The robot's timeout window for finding an operator is 1 hour (3600s, set in `request_fallback`). Once an operator accepts, the operator's SLA is 5 minutes (300s, reset in `accept_task`).

---

## Environment Setup Checklist (for new contributors)

```
[ ] Install Node.js 18+
[ ] Install Rust stable
[ ] Install Anchor CLI 0.31.x
[ ] Install Solana CLI 2.x
[ ] Configure Solana CLI for devnet: solana config set --url https://api.devnet.solana.com
[ ] Generate robot keypair: solana-keygen new --outfile ~/.config/solana/id.json
[ ] Airdrop robot wallet: solana airdrop 2
[ ] (Optional) Generate operator keypair: solana-keygen new --outfile operator.json && solana airdrop --keypair operator.json 2
[ ] Python venv: python3 -m venv venv && source venv/bin/activate && pip install solana solders requests
[ ] Clone repo: git clone git@github.com:razz492/Fallback-Protocol.git
[ ] cd Fallback-Protocol
[ ] Deploy program: anchor build && anchor deploy --provider.cluster devnet
[ ] Start dashboard: cd operator-dashboard && npm install && npm run dev
[ ] Connect Phantom (devnet) to dashboard
[ ] Test full flow: python3 robot_client.py → accept in dashboard → python3 task_resolved.py → claim in dashboard
```

---

## License

ISC (see root `package.json`).
