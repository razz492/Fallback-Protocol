import asyncio
import json
import os
import hashlib
import urllib.request # --- NEW: to send the signal to Next.js ---
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from session_manager import get_current_session_id

def get_discriminator(instruction_name: str) -> bytes:
    preimage = f"global:{instruction_name}".encode('utf-8')
    return hashlib.sha256(preimage).digest()[:8]

async def main():
    print("🤖 [Robot] Watchdog Process Started...")
    client = AsyncClient("https://api.devnet.solana.com")
    
    with open(os.path.expanduser("~/.config/solana/id.json"), 'r') as f:
        robot_secret = json.load(f)
    robot_keypair = Keypair.from_bytes(bytes(robot_secret))
    
    program_id = Pubkey.from_string("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT")
    session_id = get_current_session_id()
    session_id_bytes = session_id.to_bytes(8, 'little')
    
    session_pda, _ = Pubkey.find_program_address(
        [b"session", bytes(robot_keypair.pubkey()), session_id_bytes],
        program_id
    )
    
    print(f"📡 Checking Session {session_id} for Operator Timeout...")
    discriminator = get_discriminator("cancel_timeout")
    keys = [
        AccountMeta(pubkey=robot_keypair.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=session_pda, is_signer=False, is_writable=True),
    ]
    
    ix_cancel = Instruction(program_id=program_id, accounts=keys, data=discriminator)
    print("⚠️  Operator exceeded time limit. Executing SLASH protocol...")
    
    try:
        recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
        msg = MessageV0.try_compile(
            payer=robot_keypair.pubkey(),
            instructions=[ix_cancel],
            address_lookup_table_accounts=[],
            recent_blockhash=recent_blockhash,
        )
        tx = VersionedTransaction(msg, [robot_keypair])
        sig = await client.send_transaction(tx)
        
        print("✅ SLASH SUCCESSFUL!")
        print("💰 Robot reclaimed 0.1 SOL Bounty + stole Operator's 0.05 SOL Bond.")
        print(f"🔗 View on Solscan: https://solscan.io/tx/{sig.value}?cluster=devnet")

        # --- NEW: Send the exact signature to the Next.js UI ---
        try:
            url = "http://localhost:3000/api/robot"
            payload = json.dumps({"slashed": True, "tx": str(sig.value)}).encode('utf-8')
            req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req)
            print("📡 Alerted Operator UI of the Slash Transaction!")
        except Exception as api_e:
            print(f"⚠️ Could not notify Next.js UI: {api_e}")

    except Exception as e:
        print(f"❌ Slashing Failed. Operator might have resolved it in time. Error: {e}")

    await client.close()

if __name__ == "__main__":
    asyncio.run(main())