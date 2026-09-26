#!/usr/bin/env bash

if [ ! -d "venv" ]; then
    echo "❌ Error: 'venv' folder not found."
    exit 1
fi
source venv/bin/activate

echo "========================================="
echo "   FALLBACK PROTOCOL - ROBOT LAUNCHER    "
echo "========================================="
echo "  1 : Trigger Deadlock   (robot_client.py)"
echo "  2 : Trigger Robotaxi   (robotaxi_client.py)"
echo "  3 : 🟢 Signal Resolved (task_resolved.py)"
echo "  4 : 🔴 Signal Slashed  (task_failed.py)"
echo "========================================="
read -p "Enter your choice (1-4): " choice
echo ""

case "$choice" in
    1) python robot_client.py ;;
    2) python robotaxi_client.py ;;
    3) python task_resolved.py ;;
    4) python task_failed.py ;;
    *) echo "❌ Invalid choice." ;;
esac
