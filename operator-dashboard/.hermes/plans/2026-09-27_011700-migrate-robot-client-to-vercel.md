# Plan: Migrate Robot Client Scripts from Ngrok to Vercel Deployment

## Goal

Update all robot client Python scripts to call the deployed Vercel dashboard API (`https://operator-dashboard-wine.vercel.app`) instead of the ngrok tunnel, and simplify the notification logic.

## Current Context / Assumptions

**What's deployed:**
- Dashboard: `https://operator-dashboard-wine.vercel.app` (production Vercel deployment)
- API routes: `/api/robot` and `/api/session` work on Vercel (both using `os.tmpdir()`)

**What the robot client scripts do:**
- `robot_client.py`: Trigger deadlock, lock session, notify dashboard via HTTP POST
- `task_resolved.py`: Signal task resolved, release bounty, notify dashboard
- `task_failed.py`: Slash operator for timeout, notify dashboard with tx signature
- `timeout_client.py`: Cancel timeout/slash (no dashboard notification)

**Current API URLs in scripts (ALL pointing to ngrok tunnel):**
```
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"
SESSION_API_URL  = "https://gatherer-shopping-yam.ngrok-free.dev/api/session"
```

**Architecture (after migration):**
```
robot_client.py (local) ──HTTP POST──> Vercel serverless function (/api/robot)
                                            │
                                            ▼ writes to os.tmpdir()/robot_signal.json
                                            │
Browser (Vercel) ──GET /api/robot──> reads robot_signal.json ◄─────┘
```

The ROS WebSocket connection (`ws://127.0.0.1:9090`) is NOT affected — it connects from the browser to localhost regardless of where the dashboard is hosted. The browser runs on the user's machine, so `127.0.0.1` always refers to the user's machine.

**Why network scanning can't find robot_client.py:**
`robot_client.py` is NOT a ROS 2 node. It's a standalone Python script that:
1. Performs Solana on-chain transactions (escrow, stakes, slash)
2. Calls the dashboard REST API (`/api/robot`, `/api/session`) via HTTP
3. Does NOT register with ROS master, does NOT expose ROS services/topics
4. Is NOT discoverable via `ros2 node list`, `ros2 service list`, or nmap

The ROS 2 nodes (Gazebo, ROSBridge on :9090, web_video_server on :8080) ARE discoverable. They're started by `start_teleop.sh`. The ngrok tunnel was only for the DASHBOARD API communication, not for ROS.

## Architecture / Proposed Approach

Replace ngrok URLs with Vercel deployment URLs in all three Python scripts. Keep localhost as fallback for local development. Use consistent notification pattern across all scripts.

New URL scheme:
```python
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
SESSION_API_URL  = "https://operator-dashboard-wine.vercel.app/api/session"
LOCAL_DASHBOARD_ROBOT_URL = "http://localhost:3000/api/robot"
LOCAL_DASHBOARD_SESSION_URL = "http://localhost:3000/api/session"
```

Pattern for each notification: try Vercel first, fall back to localhost.

## Step-by-Step Tasks

### Task 1: Update robot_client.py

**File:** `/home/amr01/fallback_protocol/robot_client.py`

**Changes:**
1. Replace ngrok URL constants with Vercel URLs (lines 17-19)
2. Rewrite `signal_dashboard_ready()` to use Vercel + localhost fallback (lines 25-44)
3. Rewrite `alert_session_locked()` to use Vercel + localhost fallback (lines 46-62)

**New lines 17-19:**
```python
# 🌐 DASHBOARD API ENDPOINTS
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
SESSION_API_URL  = "https://operator-dashboard-wine.vercel.app/api/session"
```

**New `signal_dashboard_ready()` (replace lines 25-44):**
```python
def signal_dashboard_ready():
    """Tells the Next.js dashboard that the robot is unlocked for teleop"""
    payload = {
        "ready": True,
        "slashed": False,
        "resolved": False,
        "tx": None
    }
    # Try Vercel deployment first, fall back to localhost
    try:
        requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
        print("✅ [📡 VERCEL] Dashboard unlocked.")
    except Exception:
        try:
            requests.post("http://localhost:3000/api/robot", json=payload, timeout=2)
            print("✅ Local dashboard unlocked.")
        except Exception:
            pass

def alert_session_locked(session_id: int):
    """Mark session as locked and notify dashboard."""
    set_session_state(session_id=session_id, status="locked")
    print(f"✅ Local session_config.json → session_id={session_id}, status=locked")
    payload = {"session_id": session_id, "status": "locked"}
    # Try Vercel deployment first, fall back to localhost
    try:
        requests.post(SESSION_API_URL, json=payload, timeout=3)
        print("✅ Dashboard notified via Vercel.")
    except Exception:
        try:
            requests.post("http://localhost:3000/api/session", json=payload, timeout=2)
            print("✅ Local dashboard notified.")
        except Exception:
            pass
```

### Task 2: Update task_resolved.py

**File:** `/home/amr01/fallback_protocol/task_resolved.py`

**Changes:**
1. Replace DASHBOARD_API_URL (line 4)
2. Update the notification block to use Vercel URL (lines 20-32)

**New line 4:**
```python
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
```

**New notification block (replace lines 20-32):**
```python
# Try Vercel deployment first, fall back to localhost
try:
    requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
    print("📡 [VERCEL] Dashboard updated.")
except Exception:
    try:
        requests.post("http://localhost:3000/api/robot", json=payload, timeout=2)
        print("\n📡 [LOCAL] Success! Localhost dashboard updated.")
    except Exception:
        pass
```

### Task 3: Update task_failed.py

**File:** `/home/amr01/fallback_protocol/task_failed.py`

**Changes:**
1. Replace DASHBOARD_API_URL (line 15)
2. Update the notification block to use Vercel URL (lines 76-86)

**New line 15:**
```python
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
```

**New notification block (replace lines 76-86):**
```python
        try:
            requests.post(DASHBOARD_API_URL, json=slash_payload, timeout=3)
            print("📡 [VERCEL] Alerted Operator UI of the Slash Transaction!")
        except Exception:
            try:
                requests.post("http://localhost:3000/api/robot", json=slash_payload, timeout=2)
                print("📡 [LOCAL] Alerted Operator UI of the Slash Transaction!")
            except Exception:
                pass
```

### Task 4: Verify all scripts compile/import

```bash
cd /home/amr01/fallback_protocol
python -c "import robot_client; print('robot_client OK')" 2>&1
python -c "import task_resolved; print('task_resolved OK')" 2>&1
python -c "import task_failed; print('task_failed OK')" 2>&1
python -c "import timeout_client; print('timeout_client OK')" 2>&1
```

### Task 5: Test Vercel API communication

```bash
# Test POST to /api/robot
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" \
  -d '{"ready":true,"slashed":false,"resolved":false,"tx":null}'
# Expected: {"success":true}

# Test POST to /api/session
curl -s -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" \
  -d '{"session_id":999,"status":"locked"}'
# Expected: {"success":true,"message":"State Updated"}

# Verify GET endpoints
curl -s https://operator-dashboard-wine.vercel.app/api/robot
# Expected: {"ready":true,"slashed":false,"resolved":false,"tx":null}

curl -s https://operator-dashboard-wine.vercel.app/api/session
# Expected: {"session_id":999,"status":"locked"}
```

### Task 6: Update the README with new architecture

**File:** `/home/amr01/fallback_protocol/README.md`

Add a section documenting the deployed architecture and how robot clients communicate with Vercel.

## Tests / Validation

### Static checks (before deployment)
```bash
cd /home/amr01/fallback_protocol
python -c "import robot_client" && echo "robot_client: OK"
python -c "import task_resolved" && echo "task_resolved: OK"
python -c "import task_failed" && echo "task_failed: OK"
```

### API reachability
```bash
# All should return 200
curl -s -o /dev/null -w "%{http_code}" -X POST https://operator-dashboard-wine.vercel.app/api/robot \
  -H "Content-Type: application/json" -d '{"ready":true}'
# => 200

curl -s -o /dev/null -w "%{http_code}" -X POST https://operator-dashboard-wine.vercel.app/api/session \
  -H "Content-Type: application/json" -d '{"session_id":1,"status":"locked"}'
# => 200

curl -s -o /dev/null -w "%{http_code}" https://operator-dashboard-wine.vercel.app/api/robot
# => 200

curl -s -o /dev/null -w "%{http_code}" https://operator-dashboard-wine.vercel.app/api/session
# => 200
```

### E2E roundtrip
```bash
cd /home/amr01/fallback_protocol
python -c "
import requests

# Post robot state
r = requests.post('https://operator-dashboard-wine.vercel.app/api/robot',
    json={'ready': True, 'slashed': False, 'resolved': True, 'tx': 'test_tx'},
    timeout=5)
assert r.status_code == 200, f'POST failed: {r.status_code}'

# Verify
r = requests.get('https://operator-dashboard-wine.vercel.app/api/robot', timeout=5)
assert r.status_code == 200
data = r.json()
assert data['ready'] == True
assert data['resolved'] == True
assert data['tx'] == 'test_tx'
print('E2E robot roundtrip: OK')

# Post session state
r = requests.post('https://operator-dashboard-wine.vercel.app/api/session',
    json={'session_id': 123, 'status': 'locked'}, timeout=5)
assert r.status_code == 200, f'POST failed: {r.status_code}'

# Verify
r = requests.get('https://operator-dashboard-wine.vercel.app/api/session', timeout=5)
assert r.status_code == 200
data = r.json()
assert data['session_id'] == 123
assert data['status'] == 'locked'
print('E2E session roundtrip: OK')
"
```

### Verify deployment
```bash
curl -s https://operator-dashboard-wine.vercel.app | grep -o "title>[^<]*</title"
# => title>Fallback Protocol — Operator Dashboard</title
```

## Risks, Tradeoffs, and Open Questions

1. **Vercel `/api/session` was broken before this plan**: The original `session/route.ts` used `path.join(process.cwd(), '..', 'session_config.json')` which doesn't work on Vercel's serverless environment. This was fixed in a prior step to use `os.tmpdir()` instead. The scripts should work with the fixed endpoint.

2. **Vercel cold starts**: First request to a serverless function may take 1-3 seconds. Robot client scripts have timeouts of 2-3 seconds. If the function is cold, the request may timeout. Mitigation: the fallback to localhost handles this — if Vercel is slow, localhost works for local dev.

3. **ROS WebSocket is localhost-only**: The dashboard's ROS connection (`ws://127.0.0.1:9090`) always connects to localhost. This means:
   - The browser must run on the same machine as the ROS nodes
   - The dashboard can be served from Vercel (HTML from CDN) but the WebSocket connects to the user's local ROSBridge
   - This is by design and works correctly

4. **session_config.json at repo root vs Vercel**: The file at `/home/amr01/fallback_protocol/session_config.json` is for local development. On Vercel, session state is stored in the serverless function's temp directory. These are separate — changes on Vercel don't affect the local file and vice versa.

5. **Ngrok tunnel removal**: Once all scripts use the Vercel URL, the ngrok tunnel (`gatherer-shopping-yam.ngrok-free.dev`) is no longer needed. It can be left running or stopped — it won't affect anything.
