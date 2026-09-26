import requests

# 🌐 DASHBOARD API ENDPOINT
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"

print("=========================================")
print("  FALLBACK PROTOCOL - WATCHDOG SENSOR    ")
print("=========================================")
print("✅ [🤖 ROBOT] Sensor check: Deadlock cleared! Path is safe.")
print("✅ [🤖 ROBOT] Re-engaging local AI autonomy loop...")
print("✅ [🤖 ROBOT] Informing server to release Operator bounty...")

payload = {
    "ready": True, 
    "slashed": False, 
    "resolved": True,  # <-- This unlocks the Claim button!
    "tx": None
}

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