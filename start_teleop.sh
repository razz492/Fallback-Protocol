#!/bin/bash

echo "🚀 Starting Fallback Protocol ROS 2 Nodes..."

export TURTLEBOT3_MODEL=waffle

# 1. Start Gazebo in the background
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py &
GAZEBO_PID=$!

# 2. Start WebSocket Bridge in the background
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &
ROSBRIDGE_PID=$!

# 3. Start Video Stream Server in the background
ros2 run web_video_server web_video_server &
VIDEO_PID=$!

echo "✅ All nodes are running in this terminal!"
echo "🛑 Press [CTRL+C] to shut everything down cleanly."

# This traps the Ctrl+C signal and ensures all 3 background processes are killed
trap "echo 'Shutting down nodes...'; kill $GAZEBO_PID $ROSBRIDGE_PID $VIDEO_PID; exit" SIGINT

# Wait keeps the script running so the trap can catch the Ctrl+C
wait
