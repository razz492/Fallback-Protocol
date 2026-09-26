This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Live Deployment

**https://operator-dashboard-wine.vercel.app**

### Environment Variables

| Variable | Value | Description |
|---|---|---|
| `NEXT_PUBLIC_SOLANA_RPC` | `https://solana-devnet.g.alchemy.com/v2/alch_18IfjxfhzdbYvYEbUivwJ` | Solana Devnet RPC (Alchemy) |

### Local Development

```bash
cd operator-dashboard
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Wallet warnings on localhost:** Phantom and Solflare show security warnings
for `localhost` because it's an unrecognized origin. Click through ("Confirm
Unsafe" / "Proceed") — this is expected and does not indicate a problem with
the app. These warnings disappear on the deployed HTTPS domain.

## Robot Client Architecture

### What is robot_client.py?

`robot_client.py` is **not a ROS 2 node**. It is a standalone Python script that:

1. Performs Solana on-chain transactions (escrow, stakes) using `solders` and `solana.rpc`
2. Calls the dashboard's REST API (`/api/robot`) to notify it of state changes (ready, locked, resolved, slashed)
3. Uses an ngrok tunnel (`https://gatherer-shopping-yam.ngrok-free.dev`) to reach the dashboard when it's not on localhost

It does NOT:
- Run as a ROS 2 node
- Register with the ROS master
- Expose ROS services or topics
- Appear in `ros2 node list`, `ros2 service list`, or network scans

### Why network scanning can't find robot_client.py

Network scanning tools look for ROS-registered nodes and services. Since `robot_client.py` is not a ROS entity, it won't appear in any ROS discovery tool.

If you need to verify the robot client is running:
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

