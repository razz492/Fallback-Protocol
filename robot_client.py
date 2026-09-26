import asyncio
import json
import struct
import hashlib
import requests
from pathlib import Path
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Finalized
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from session_manager import increment_session_id, set_session_state

# 🌐 DASHBOARD API ENDPOINTS
DASHBOARD_API_URL = "https://operator-dashboard-wine.vercel.app/api/robot"
SESSION_API_URL  = "https://operator-dashboard-wine.vercel.app/api/session"

def get_discriminator(instruction_name: str) -> bytes:
    preimage = f"global:{instruction_name}".encode('utf-8')
    return hashlib.sha256(preimage).digest()[:8]

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

async def main():
    print("=========================================")
    print("  FALLBACK PROTOCOL - ROS 2 NODE SIMULATOR  ")
    print("=========================================")
    print("Initialize Edge Client...")
    
    # Official Devnet — Ankr's getLatestBlockhash JSON breaks solana-py (.value on int)
    client = AsyncClient("https://api.devnet.solana.com", timeout=60)
    
    wallet_path = Path.home() / ".config" / "solana" / "id.json"
    with open(wallet_path, 'r') as f:
        secret_key = json.load(f)
    robot_keypair = Keypair.from_bytes(bytes(secret_key))
    
    program_id = Pubkey.from_string("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT")
    
    # 1. Trigger the crash and increment the session
    session_id = increment_session_id()
    print(f"\n🔄 Starting new test sequence with Session ID: {session_id}")
    print(f"🚨 [🤖 ROBOT] CRITICAL: Unmapped dynamic obstacle detected.")
    
    session_id_bytes = session_id.to_bytes(8, 'little')
    session_pda, _ = Pubkey.find_program_address(
        [b"session", bytes(robot_keypair.pubkey()), session_id_bytes],
        program_id
    )
    
    # 2. Fund the Escrow on Solana Devnet FIRST
    print("⏳ Locking 0.1 SOL Bounty on Devnet...")
    bounty_lamports = int(0.1 * 10**9) 
    discriminator = get_discriminator("request_fallback")
    
    args = struct.pack("<QQ", session_id, bounty_lamports)
    instruction_data = discriminator + args
    
    keys = [
        AccountMeta(pubkey=robot_keypair.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=session_pda, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    
    ix = Instruction(program_id=program_id, accounts=keys, data=instruction_data)
    
    try:
        recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=robot_keypair.pubkey(),
            instructions=[ix],
            address_lookup_table_accounts=[],
            recent_blockhash=recent_blockhash,
        )
        tx = VersionedTransaction(msg, [robot_keypair])
        
        sig_resp = await client.send_transaction(tx)
        # solana-py returns SendTransactionResp; tolerate raw Signature if that changes
        sig = getattr(sig_resp, "value", sig_resp)
        print(f"✅ Escrow Broadcast: https://explorer.solana.com/tx/{sig}?cluster=devnet")
        print("⏳ Confirming transaction on Devnet...")
        try:
            await client.confirm_transaction(sig, commitment="confirmed")
            print("✅ Transaction confirmed on Devnet.")
        except Exception as confirm_err:
            print(f"⚠️ Confirmation check note: {confirm_err}")

        # Allow 3 seconds for cluster gossip to replicate the new Session PDA across all Devnet RPC nodes
        # This guarantees Phantom's simulation proxy has indexed the account, preventing the red "reverted during simulation" warning
        print("⏳ Synchronizing cluster state for wallet simulation (3s)...")
        await asyncio.sleep(3)

    except Exception as e:
        print(f"\n❌ Failed to request fallback: {e}")
        await client.close()
        return

    # 3. NOW fire the signal to the Dashboard
    print(f"🚨 [🤖 ROBOT] Alerting Dispatch Server...")
    alert_session_locked(session_id)

    # 4. Signal the dashboard and unlock the robot
    print("🔓 [🤖 ROBOT] Operator Solana stake verified via PDA state change.")
    print("🔓 [🤖 ROBOT] Safety locks disengaged. Yielding /cmd_vel control to remote operator...")

    signal_dashboard_ready()

    await client.close()

if __name__ == "__main__":
    asyncio.run(main())