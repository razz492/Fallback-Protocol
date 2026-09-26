# Plan: SSH Key Setup + Network Scanning / robot_client.py Investigation

## Goal

Set up SSH key-based Git push from this environment, and explain why network scanning cannot find `robot_client.py` (it's not a ROS node — it's a standalone Solana transaction script that calls the dashboard via ngrok).

## Current Context / Assumptions

**Environment:**
- WSL (Windows Subsystem for Linux) at `/home/amr01/fallback_protocol/`
- No SSH keys in `~/.ssh/` (only `known_hosts`)
- No GitHub CLI (`gh`) installed or authenticated
- Git remote: `git@github.com:razz492/Fallback-Protocol.git` (SSH)
- Git remote also works via HTTPS: `https://github.com/razz492/Fallback-Protocol.git`

**What works:**
- `vercel deploy --prod` works with the provided VERCEL_TOKEN — the dashboard is live at `https://operator-dashboard-wine.vercel.app`
- Local dev (`npm run dev`) works on localhost:3000

**What doesn't:**
- `git push origin main` fails over SSH (no keys) and over HTTPS (no credentials)
- 7 commits are ahead of `origin/main`

**Architecture of the robot/dashboard system:**

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  robot_client.py │     │  ngrok tunnel    │     │  Dashboard API   │
│  (Python, locally│────>│  gatherer-sho... │────>│  (Vercel/localhost)│
│   running)       │     │  .ngrok-free.dev │     │  /api/robot      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │
        │ Solana txs           │ REST POST
        │ (escrow, stakes)     │ (ready=true, etc.)
        ▼                       ▼
┌─────────────────┐     ┌──────────────────┐
│  Solana Devnet   │     │  session_config   │
│  (on-chain PDA)  │     │  .json (local)    │
└─────────────────┘     └──────────────────┘

Separate from above:
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dashboard UI    │────>│  ROSBridge (ws)  │────>│  ROS 2 nodes     │
│  (browser, Vercel│     │  ws://127.0.0.1: │     │  ( Gazebo,       │
│   or localhost)  │     │  9090            │     │   turtlebot3)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
      ▲                        ▲                        ▲
      │ WASD keys              │ /cmd_vel topic         │
      │                         │                        │
      └────────────────────────┴────────────────────────┘
                   Hardcoded to 127.0.0.1 (localhost only)
```

**Key insight — `robot_client.py` is NOT a ROS node:**
- It is a Python script that performs Solana on-chain transactions and calls the dashboard REST API
- It does NOT run `ros2 run`, does NOT register with ROS master, does NOT expose ROS services/topics
- Network scanning tools (`ros2 node list`, `ros2 service list`, `nmap`, etc.) will NOT find it because it's not a ROS entity
- If the user expects `robot_client.py` to appear in ROS network discovery, that's a misunderstanding of what the script is

**The ngrok tunnel's purpose:**
- Allows `robot_client.py` (running locally) to call the dashboard's `/api/robot` endpoint when the dashboard is deployed to Vercel or running on a different machine
- `DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"` is the tunnel URL
- This is a one-way notification channel (robot → dashboard), not a discovery mechanism

## Architecture / Proposed Approach

**For SSH key:**
1. Generate a new Ed25519 SSH key pair in `~/.ssh/`
2. Display the public key for the user to add to GitHub Settings → SSH Keys
3. Configure `~/.ssh/config` to use the key for github.com
4. Test `ssh -T git@github.com` and `git push`

**For the network scanning / robot_client.py question:**
1. Explain the architecture (above) — document in the README or a new doc
2. Optional: if the user wants `robot_client.py` to be discoverable, it would need to run as a ROS node (rosbridge or custom node), which is a significant redesign — recommend against it for now
3. Add a note to the README explaining the robot_client.py role and why it's not network-discoverable

## Step-by-Step Tasks

### Task 1: Generate SSH key pair

**Command:**
```bash
ssh-keygen -t ed25519 -C "amr01@NEXUS" -f ~/.ssh/id_ed25519_github -N ""
```

**Expected output:**
```
Generating public/private ed25519 key pair.
Your identification has been saved in ~/.ssh/id_ed25519_github
Your public key has been saved in ~/.ssh/id_ed25519_github.pub
```

**Verification:**
```bash
ls -la ~/.ssh/id_ed25519_github ~/.ssh/id_ed25519_github.pub
# Both files should exist
cat ~/.ssh/id_ed25519_github.pub
# Should print the public key (starts with ssh-ed25519 AAAA...)
```

---

### Task 2: Display public key for GitHub

**Command:**
```bash
cat ~/.ssh/id_ed25519_github.pub
```

**Expected output (example):**
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... amr01@NEXUS
```

**Action:** The user must copy this and add it to GitHub:
1. Go to https://github.com/settings/keys
2. Click "New SSH key"
3. Title: `NEXUS WSL` or similar
4. Key: paste the output above
5. Click "Add SSH key"

---

### Task 3: Configure SSH client

**File:** `~/.ssh/config` (create if not exists)

```text
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
    AddKeysToAgent yes
```

**Verification:**
```bash
chmod 600 ~/.ssh/config
ssh -T git@github.com
# Expected: "Hi amr01! You've successfully authenticated, but GitHub does not provide shell access."
```

---

### Task 4: Test Git push

**Command:**
```bash
cd /home/amr01/fallback_protocol
git push origin main
```

**Expected output:**
```
Everything up-to-date  (if no new commits)
# or
Enumerating objects: ... done.
...
To github.com:razz492/Fallback-Protocol.git
   <previous>..<new>  main -> main
```

---

### Task 5: Document the robot_client.py architecture

**File:** `operator-dashboard/README.md` (append a new section)

```markdown
## Robot Client Architecture

### What is robot_client.py?

`robot_client.py` is **not a ROS 2 node**. It is a standalone Python script that:

1. Performs Solana on-chain transactions (escrow, stakes, etc.) using `solders` and `solana.rpc`
2. Calls the dashboard's REST API (`/api/robot`) to notify it of state changes (ready, locked, resolved, slashed)
3. Uses an ngrok tunnel (`https://gatherer-shopping-yam.ngrok-free.dev`) to reach the dashboard when it's not on localhost

It does NOT:
- Run as a ROS 2 node
- Register with the ROS master
- Expose ROS services or topics
- Appear in `ros2 node list`, `ros2 service list`, or network scans

### Why network scanning can't find robot_client.py

Network scanning tools look for ROS-registered nodes and services. Since `robot_client.py` is not a ROS entity, it won't appear in any ROS discovery tool.

If you need to verify the robot client is running, check:
```bash
ps aux | grep robot_client.py
# Or check the ngrok tunnel status
curl -s https://gatherer-shopping-yam.ngrok-free.dev/api/robot
```

### The ROS 2 side (what IS discoverable)

The actual ROS 2 nodes run via `start_teleop.sh`:
- Gazebo simulation (`turtlebot3_gazebo`)
- ROSBridge WebSocket (`rosbridge_server` on port 9090)
- Web Video Server (`web_video_server` on port 8080)

These ARE discoverable via `ros2 node list` and the dashboard connects to them via:
- WebSocket: `ws://127.0.0.1:9090` (ROSBridge)
- HTTP stream: `http://127.0.0.1:8080/stream` (web_video_server)

### The ngrok tunnel

The ngrok tunnel (`gatherer-shopping-yam.ngrok-free.dev`) exists so that
`robot_client.py` can call the dashboard API when the dashboard runs on
Vercel or a different machine. It is a one-way notification channel
(robot → dashboard), not a bidirectional ROS connection.

The dashboard's ROS connection (WebSocket to port 9090) is always to
`127.0.0.1` (localhost) — this means the ROS nodes must run on the same
machine as the browser. For remote ROS access, rosbridge would need to
listen on a non-localhost interface or use a tunnel.
```

---

### Task 6: Verify the ngrok tunnel is still active (optional)

**Command:**
```bash
curl -s https://gatherer-shopping-yam.ngrok-free.dev/api/robot
```

**Expected output (if tunnel is up and robot_client.py has called it):**
```json
{"ready": true, "slashed": false, "resolved": false, "tx": null}
```

**Or if no one has called it yet:**
```json
{"ready": false}
```

**If the tunnel is down:**
```json
{"error":"ngrok http not found"}  # or similar
# or connection refused / 502
```

---

## Tests / Validation

### SSH key validation
```bash
# 1. Key exists
test -f ~/.ssh/id_ed25519_github && echo "PRIVATE KEY EXISTS" || echo "MISSING"
test -f ~/.ssh/id_ed25519_github.pub && echo "PUBLIC KEY EXISTS" || echo "MISSING"

# 2. SSH config exists
test -f ~/.ssh/config && echo "CONFIG EXISTS" || echo "MISSING"

# 3. GitHub auth (requires user to add key first)
ssh -T git@github.com 2>&1 | head -1
# Expected: "Hi amr01! You've successfully authenticated..."

# 4. Git push
cd /home/amr01/fallback_protocol
git push origin main 2>&1 | tail -3
# Expected: successful push or "Everything up-to-date"
```

### Network scanning validation
```bash
# These should show ROS nodes (if start_teleop.sh is running):
ros2 node list 2>/dev/null | head -10
# Should show /gazebo, /rosbridge_websocket, /web_video_server, etc.

# This should NOT show robot_client.py (by design):
ros2 node list 2>/dev/null | grep -i robot
# Expected: no results (robot_client.py is not a ROS node)

# Check if robot_client.py process is running:
ps aux | grep robot_client.py | grep -v grep
# Shows the Python process if running

# Check ngrok tunnel:
curl -s -o /dev/null -w "%{http_code}" https://gatherer-shopping-yam.ngrok-free.dev/api/robot
# 200 if tunnel is up
```

---

## Risks, Tradeoffs, and Open Questions

1. **SSH key security:** The Ed25519 key is stored in `~/.ssh/`. On WSL, this is accessible from the Windows filesystem at `\\wsl$\Ubuntu\home\amr01\.ssh\`. Ensure the Windows host is secure. The key has no passphrase (we used `-N ""`), which is convenient but means anyone with file access can use it.

2. **`-N ""` (no passphrase):** Convenient for automation, less secure. If the user wants a passphrase, regenerate with `-N "your-passphrase"` and use `ssh-agent` to cache it.

3. **ngrok free tier:** The tunnel `gatherer-shopping-yam.ngrok-free.dev` is on ngrok's free tier, which may expire or change. If it goes down, `robot_client.py` can still reach the dashboard via localhost (if the dashboard runs locally) but not via Vercel.

4. **ROS localhost-only:** The dashboard connects to `ws://127.0.0.1:9090` — always localhost. This means:
   - If the dashboard is on Vercel, the browser still connects to the user's local ROSBridge (because the browser runs on the user's machine)
   - If the user wants ROS to be accessible from another machine, rosbridge needs to listen on `0.0.0.0` or a specific interface, and the dashboard needs to know that address

5. **robot_client.py redesign (if discovery is wanted):** Making `robot_client.py` a ROS node would require:
   - Installing `ros2py` or using `rclpy` (Python ROS 2 client library)
   - Running it as a ROS node that registers with the ROS master
   - This is a significant change and may not be necessary — the current design (standalone script + REST API + ngrok) is simpler and works for the current use case

6. **GitHub SSH vs HTTPS:** SSH is more convenient (no password prompts) but requires key management. HTTPS with a personal access token is an alternative if SSH doesn't work.
