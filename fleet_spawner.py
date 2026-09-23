import asyncio
import random
import os
from termcolor import colored # You might need to run: pip install termcolor

async def main():
    print(colored("🌐 Scanning global fleet for anomalies...", "cyan"))
    await asyncio.sleep(2)
    
    # Randomly pick a vehicle type
    vehicle_type = random.choice(["delivery", "robotaxi"])
    
    if vehicle_type == "delivery":
        print(colored("🚨 [ALERT] Delivery Robot #01 detected a deadlock!", "yellow"))
        # Execute the python script you already wrote
        os.system("python robot_client.py")
        print(colored("👉 Switch Next.js Toggle to 'Delivery Robot' to Accept!", "cyan"))
        
    else:
        print(colored("🚨 [CRITICAL] Robotaxi #01 blocked in active traffic!", "red", attrs=['bold']))
        # Execute the python script you already wrote
        os.system("python robotaxi_client.py")
        print(colored("👉 Switch Next.js Toggle to 'Robotaxi' to Accept!", "cyan"))

if __name__ == "__main__":
    asyncio.run(main())