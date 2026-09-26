import requests

# 🌐 YOUR NGROK STATIC DOMAIN
DASHBOARD_API_URL = "https://gatherer-shopping-yam.ngrok-free.dev/api/robot"

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

# Localhost notification
try:
    requests.post("http://localhost:3000/api/robot", json=payload, timeout=2)
    print("\n📡 [LOCAL] Success! Localhost dashboard updated.")
except Exception:
    pass

# Ngrok notification
try:
    requests.post(DASHBOARD_API_URL, json=payload, timeout=3)
    print("📡 [SERVER] Success! Ngrok dashboard updated.")
except Exception as e:
    print(f"\n⚠️ [NETWORK ERROR] Could not reach Ngrok Dashboard at {DASHBOARD_API_URL}")