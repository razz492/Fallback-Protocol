import urllib.request
import json

def main():
    print("🤖 [Robot] Teleoperation successful!")
    print("📡 Sending clearance signal to Operator Command Center...")
    
    url = "http://localhost:3000/api/robot"
    data = json.dumps({"ready": True}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    
    try:
        urllib.request.urlopen(req)
        print("✅ Signal received! The Operator UI has unlocked the 'Claim Bounty' button.")
    except Exception as e:
        print(f"❌ Failed to send signal to Next.js API: {e}")
        print("Make sure your Next.js server is running on localhost:3000")

if __name__ == "__main__":
    main()