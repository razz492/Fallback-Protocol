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

**robot_client.py is NOT a ROS 2 node.** It is a standalone Python script that:

1. Performs Solana on-chain transactions (escrow, stakes, slash)
2. Calls the dashboard's REST API (`/api/robot`, `/api/session`) via HTTP
3. Uses the Vercel deployment URL (`https://operator-dashboard-wine.vercel.app`) to reach the dashboard

**Why network scanning can't find robot_client.py:**
Network scanning tools (ros2 node list, nmap) look for ROS-registered nodes and services. Since `robot_client.py` is not a ROS entity, it won't appear in any ROS discovery tool. The ROS 2 nodes (Gazebo, ROSBridge on :9090, web_video_server on :8080) ARE discoverable — they're started by `start_teleop.sh`.

**Communication flow:**
```
robot_client.py (local) ──HTTP POST──> Vercel serverless functions
                                            │
                                            ▼ os.tmpdir() storage
                                            │
Browser ──GET /api/robot──> reads state ◄────┘
```

**ROS WebSocket:** The browser connects to `ws://127.0.0.1:9090` (ROSBridge) for teleoperation. This is always localhost — the browser runs on the user's machine alongside the ROS nodes. The dashboard HTML can be served from Vercel; the WebSocket connection is independent of hosting location.

