# Plan: Migrate Robot Client Scripts from Ngrok to Vercel Deployment

## Goal

Update all robot client Python scripts to call the deployed Vercel dashboard API (`https://operator-dashboard-wine.vercel.app`) instead of the ngrok tunnel, and verify end-to-end communication works.

## Current Context / Assumptions

**What's deployed:**
- Dashboard: `https://operator-dashboard-wine.vercel.app` (production Vercel deployment)
- API routes: `/api/robot` and `/api/session` are serverless functions on Vercel

**What the robot client scripts do:**
- `robot_client.py`: Trigger a deadlock, send Solana tx, notify dashboard via HTTP POST
- `task_resolved.py`: Signal task resolved, notify dashboard via HTTP POST
- `task_failed.py`: Slash operator, notify dashboard via HTTP POST with tx signature
- `timeout_client.py`: Cancel timeout / slash (no dashboard notification)

**Current API URLs in scripts:**
```
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"
SESSION_API_URL  = "https://gatherer-shopping-yam.ngrok-free.dev/api/session"
```

These point to an ngrok tunnel that forwards to `localhost:3000`. The tunnel is no longer needed now that the dashboard is deployed on Vercel.

**Architecture:**
```
robot_client.py (local) ──HTTP POST──> Vercel serverless function (/api/robot)
                                            │
                                            ▼ writes to os.tmpdir()/robot_signal.json
                                            │
Browser (Vercel) ──GET /api/robot──> reads robot_signal.json ◄─────┘
```

The ROS WebSocket connection (`ws://127.0.0.1:9090`) is NOT affected — it connects from the browser to localhost regardless of where the dashboard HTML is served from.

**Files to modify:**
- `/home/amr01/fallback_protocol/robot_client.py` — DASHBOARD_API_URL, SESSION_API_URL, dual-call logic
- `/home/amr01/fallback_protocol/task_resolved.py` — DASHBOARD_API_URL
- `/home/amr01/fallback_protocol/task_failed.py` — DASHBOARD_API_URL

**Files to verify (no changes needed):**
- `/home/amr01/fallback_protocol/operator-dashboard/app/api/robot/route.ts` — works on Vercel as-is (uses os.tmpdir)
- `/home/amr01/fallback_protocol/operator-dashboard/app/api/session/route.ts` — works on Vercel as-is (reads/writes session_config.json from deployment)

## Architecture / Proposed Approach

Replace the ngrok tunnel URL with the Vercel deployment URL in all three Python client scripts. Simplify the dual-call pattern (localhost + ngrok) to a single call to the Vercel URL, since the Vercel deployment is the canonical API endpoint now.

The `signal_dashboard_ready()` function in `robot_client.py` currently tries localhost first, then ngrok. With the Vercel deployment, we should call the Vercel URL directly. We can keep the localhost fallback for local development.

## Step-by-Step Tasks

### Task 1: Update robot_client.py API URLs

**File:** `/home/amr01/fallback_protocol/robot_client.py`

Replace the ngrok URLs and simplify the notification logic.

**Current (lines 17-19, 25-44, 46-62):**
```python
# 🌐 YOUR NGROK STATIC DOMAIN ENDPOINTS
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"
SESSION_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/session"

def signal_dashboard_ready():
    payload = {"ready": True, "slashed": False, "resolved": False, "tx": None}
    # Notify localhost dashboard directly
    try:
        requests.post("http://localhost:3000/api/robot", json=payload, timeout=2)
        print("✅ Local dashboard unlocked.")
    except Exception:
        pass
    # Also notify ngrok if available
    try:
        requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
        print("✅ [📡 SERVER] Ngrok dashboard unlocked.")
    except Exception:
        pass

def alert_session_locked(session_id: int):
    set_session_state(session_id=session_id, status="locked")
    print(f"✅ Local session_config.json → session_id={session_id}, status=locked")
    payload = {"session_id": session_id, "status": "locked"}
    # Notify localhost dashboard immediately
    try:
        requests.post("http://localhost:3000/api/session", json=payload, timeout=2)
        print("✅ Local dashboard notified.")
    except Exception:
        pass
    # Also notify ngrok if configured
    try:
        requests.post(SESSION_API_URL, json=payload, timeout=3)
        print("✅ Dashboard notified via ngrok.")
    except Exception:
        pass
```

**New:**
```python
# 🌐 DASHBOARD API ENDPOINTS
# Use Vercel deployment for remote access, localhost for local dev
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
SESSION_API_URL = "https://operator-dashboard-wine.vercel.app/api/session"
LOCAL_DASHBOARD_URL = "http://localhost:3000"

def _notify_dashboard(url: str, payload: dict, label: str) -> bool:
    """POST payload to dashboard API. Returns True on success."""
    try:
        resp = requests.post(url, json=payload, timeout=3)
        if resp.status_code == 200:
            print(f"✅ [{label}] Dashboard notified.")
            return True
    except Exception as e:
        print(f"⚠️ [{label}] Failed to notify dashboard: {e}")
    return False

def signal_dashboard_ready():
    """Tells the Next.js dashboard that the robot is unlocked for teleop"""
    payload = {
        "ready": True,
        "slashed": False,
        "resolved": False,
        "tx": None
    }
    # Try Vercel deployment first, fall back to localhost
    if not _notify_dashboard(DASHBOARD_API_URL, payload, "VERCEL"):
        _notify_dashboard(LOCAL_DASHBOARD_URL + "/api/robot", payload, "LOCAL")

def alert_session_locked(session_id: int):
    """Mark session as locked and notify dashboard."""
    set_session_state(session_id=session_id, status="locked")
    print(f"✅ Local session_config.json → session_id={session_id}, status=locked")
    payload = {"session_id": session_id, "status": "locked"}
    # Try Vercel deployment first, fall back to localhost
    if not _notify_dashboard(SESSION_API_URL, payload, "VERCEL"):
        _notify_dashboard(LOCAL_DASHBOARD_URL + "/api/session", payload, "LOCAL")
```

**Verification:**
```bash
cd /home/amr01/fallback_protocol
python -c "import robot_client; print('Import OK')" 2>&1
# Should print "Import OK" with no errors
```

---

### Task 2: Update task_resolved.py API URL

**File:** `/home/amr01/fallback_protocol/task_resolved.py`

**Current (lines 3-4, 27-32):**
```python
# 🌐 YOUR NGROK STATIC DOMAIN
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"
...
# Ngrok notification
try:
    requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
    print("📡 [SERVER] Success! Ngrok dashboard updated.")
except Exception as e:
    print(f"\n⚠️ [NETWORK ERROR] Could not reach Ngrok Dashboard at {DASHBOARD_API_URL}")
```

**New:**
```python
# 🌐 DASHBOARD API ENDPOINT
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"

...
# Vercel deployment notification
try:
    requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
    print("📡 [SERVER] Success! Dashboard updated.")
except Exception as e:
    print(f"\n⚠️ [NETWORK ERROR] Could not reach Dashboard at {DASHBOARD_API_URL}")
```

Also update the localhost call to use the same pattern (try Vercel, fall back to localhost):

```python
# Localhost notification
try:
    requests.post("http://localhost:3000/api/robot", json=payload, timeout=2)
    print("\n📡 [LOCAL] Success! Localhost dashboard updated.")
except Exception:
    pass

# Vercel deployment notification
try:
    requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
    print("📡 [SERVER] Success! Dashboard updated.")
except Exception as e:
    print(f"\n⚠️ [NETWORK ERROR] Could not reach Dashboard at {DASHBOARD_API_URL}")
```

**Verification:**
```bash
cd /home/amr01/fallback_protocol
python -c "import task_resolved; print('Import OK')" 2>&1
```

---

### Task 3: Update task_failed.py API URL

**File:** `/home/amr01/fallback_protocol/task_failed.py`

**Current (lines 14-15, 76-86):**
```python
# 🌐 YOUR NGROK STATIC DOMAIN
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"
...
        try:
            requests.post(DASHBOARD_API_URL, json=slash_payload, timeout=3)
            print("📡 [SERVER] Alerted Operator UI of the Slash Transaction!")
        except Exception as api_e:
            print(f"⚠️ [NETWORK ERROR] Could not notify Next.js UI: {api_e}")
```

**New:**
```python
# 🌐 DASHBOARD API ENDPOINT
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
...
        try:
            requests.post(DASHBOARD_API_URL, json=slash_payload, timeout=3)
            print("📡 [SERVER] Alerted Operator UI of the Slash Transaction!")
        except Exception as api_e:
            print(f"⚠️ [NETWORK ERROR] Could not notify Dashboard: {api_e}")
```

Also update the localhost call:

```python
        try:
            requests.post("http://localhost:3000/api/robot", json=slash_payload, timeout=2)
            print("📡 [LOCAL] Alerted Localhost Operator UI of the Slash Transaction!")
        except Exception:
            pass

        try:
            requests.post(DASHBOARD_API_URL, json=slash_payload, timeout=3)
            print("📡 [SERVER] Alerted Operator UI of the Slash Transaction!")
        except Exception as api_e:
            print(f"⚠️ [NETWORK ERROR] Could not notify Dashboard: {api_e}")
```

**Verification:**
```bash
cd /home/amr01/fallback_protocol
python -c "import task_failed; print('Import OK')" 2>&1
```

---

### Task 4: Test end-to-end communication

This is the critical validation step. We need to verify that posting to the Vercel API actually updates the dashboard state.

**Step 4a: Start the dashboard locally (for ROS WebSocket)**

The ROS WebSocket connection requires the browser to connect to localhost:9090. The dashboard can be served from Vercel, but the ROS connection still needs localhost. So for full teleoperation, the user needs:
1. ROS 2 nodes running locally (`start_teleop.sh`)
2. Browser pointing to the Vercel URL

**Step 4b: Test the /api/robot endpoint**

```bash
# Test POST to Vercel API
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" \
  -d '{"ready": true, "slashed": false, "resolved": false, "tx": null}'

# Expected: {"success":true}
```

**Step 4c: Test the /api/session endpoint**

```bash
# Test POST to Vercel API
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" \
  -d '{"session_id": 332, "status": "locked"}'

# Expected: {"success":true,"message":"State Updated"}

# Test GET to verify
curl -s https://operator-dashboard-wine.vercel.app/api/session

# Expected: {"session_id":332,"status":"locked"}
```

**Step 4d: Full integration test**

```bash
cd /home/amr01/fallback_protocol

# 1. Simulate a robot_client.py run (without the Solana parts)
python -c "
import requests
import json

# Test /api/session
requests.post('https://operator-dashboard-wine.vercel.app/api/session',
    json={'session_id': 999, 'status': 'locked'}, timeout=5)
print('session POST OK')

# Test /api/robot
requests.post('https://operator-dashboard-wine.vercel.app/api/robot',
    json={'ready': True, 'slashed': False, 'resolved': False, 'tx': None}, timeout=5)
print('robot POST OK')

# Verify GET
r = requests.get('https://operator-dashboard-wine.vercel.app/api/robot', timeout=5)
print('robot GET:', r.json())

r = requests.get('https://operator-dashboard-wine.vercel.app/api/session', timeout=5)
print('session GET:', r.json())
"
```

Expected output:
```
session POST OK
robot POST OK
robot GET: {'ready': True, 'slashed': False, 'resolved': False, 'tx': None}
session GET: {'session_id': 999, 'status': 'locked'}
```

---

### Task 5: Update the README with the new architecture

**File:** `/home/amr01/fallback_protocol/README.md` (or `operator-dashboard/README.md`)

Add a section explaining the deployed architecture and how the robot clients communicate with the Vercel dashboard.

```markdown
## Deployed Dashboard Communication

The dashboard is deployed at **https://operator-dashboard-wine.vercel.app**.
Robot client scripts (`robot_client.py`, `task_resolved.py`, `task_failed.py`)
communicate with it via HTTP REST API calls to the Vercel serverless functions.

### API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/robot` | POST | Notify dashboard of robot state (ready, slashed, resolved) |
| `/api/robot` | GET | Read current robot state |
| `/api/session` | POST | Update session state (locked, unlocked) |
| `/api/session` | GET | Read current session state |

### Robot Client Scripts

| Script | Purpose | Solana Tx |
|---|---|---|
| `robot_client.py` | Trigger deadlock, lock session, notify dashboard | Yes (escrow) |
| `task_resolved.py` | Signal task resolved, release bounty | No |
| `task_failed.py` | Slash operator for timeout, notify dashboard | Yes (slash) |
| `timeout_client.py` | Cancel timeout / slash (no dashboard notify) | Yes (slash) |

### ROS WebSocket Connection

The dashboard connects to ROS 2 via WebSocket at `ws://127.0.0.1:9090` (ROSBridge).
This connection is always to localhost because the browser runs on the same
machine as the ROS nodes. The dashboard HTML can be served from Vercel or
localhost — the WebSocket connection is independent of the hosting location.

### File Storage

- `/api/robot` state: stored in Vercel's temp directory (`os.tmpdir()/robot_signal.json`)
- `/api/session` state: stored in `session_config.json` (part of the deployment)
```

---

## Tests / Validation

### Test 1: Script imports (static check)
```bash
cd /home/amr01/fallback_protocol
python -c "import robot_client; print('robot_client OK')" 2>&1
python -c "import task_resolved; print('task_resolved OK')" 2>&1
python -c "import task_failed; print('task_failed OK')" 2>&1
```
Expected: Each prints "OK" with no errors.

### Test 2: API endpoint reachability
```bash
curl -s -o /dev/null -w "robot POST: %{http_code}\n" \
  -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" \
  -d '{"ready":true,"slashed":false,"resolved":false,"tx":null}'

curl -s -o /dev/null -w "session POST: %{http_code}\n" \
  -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" \
  -d '{"session_id":1,"status":"locked"}'

curl -s -o /dev/null -w "robot GET: %{http_code}\n" \
  https://operator-dashboard-wine.vercel.app/api/robot

curl -s -o /dev/null -w "session GET: %{http_code}\n" \
  https://operator-dashboard-wine.vercel.app/api/session
```
Expected: All return 200.

### Test 3: End-to-end data roundtrip
```bash
cd /home/amr01/fallback_protocol
python -c "
import requests
# Post
r = requests.post('https://operator-dashboard-wine.vercel.app/api/robot',
    json={'ready': True, 'slashed': False, 'resolved': True, 'tx': 'test_sig'},
    timeout=5)
assert r.status_code == 200, f'POST failed: {r.status_code}'

# Get
r = requests.get('https://operator-dashboard-wine.vercel.app/api/robot', timeout=5)
assert r.status_code == 200
data = r.json()
assert data['ready'] == True
assert data['resolved'] == True
assert data['tx'] == 'test_sig'
print('E2E roundtrip OK:', data)
"
```
Expected: "E2E roundtrip OK: {'ready': True, 'slashed': False, 'resolved': True, 'tx': 'test_sig'}"

### Test 4: Verify Vercel deployment is serving the latest code
```bash
curl -s https://operator-dashboard-wine.vercel.app | grep -o "title>[^<]*</title"
```
Expected: `title>Fallback Protocol — Operator Dashboard</title`

---

## Risks, Tradeoffs, and Open Questions

1. **Vercel serverless function cold starts:** The first request to `/api/robot` or `/api/session` after deployment may take 1-3 seconds (cold start). Subsequent requests are fast. This is acceptable for the robot client's use case (it waits for user action between calls).

2. **`os.tmpdir()` on Vercel:** Vercel serverless functions have a writable `/tmp` directory. The `robot_signal.json` file persists for the lifetime of the function instance. On Vercel, function instances may be recycled, which could lose the signal. However, since the robot client posts the signal and the browser reads it shortly after, this is unlikely to be an issue in practice.

3. **`session_config.json` on Vercel:** This file is part of the deployment bundle. POSTs to `/api/session` modify it on Vercel's server. The changes persist across requests because Vercel's filesystem is persistent for the deployment. However, if the deployment is re-deployed (new build), the file resets to the bundled version. This is acceptable for devnet/demo use.

4. **ROS WebSocket localhost constraint:** The dashboard's ROS WebSocket connection (`ws://127.0.0.1:9090`) requires the browser to connect to localhost. This works regardless of where the dashboard HTML is hosted (Vercel or localhost), because the browser runs on the user's machine. The ROS nodes must be running on the same machine as the browser.

5. **Ngrok tunnel can be removed:** Once all scripts are updated to use the Vercel URL, the ngrok tunnel is no longer needed. However, the ngrok tunnel could serve as a fallback if the Vercel deployment is down. Keeping the localhost fallback in the scripts is a good safety net.

6. **URL hardcoded in scripts:** The Vercel URL is hardcoded in the Python scripts. If the deployment URL changes (e.g., custom domain), all scripts need updating. A better approach would be to use an environment variable or config file, but for a demo/setup with a fixed Vercel URL, hardcoding is acceptable.
