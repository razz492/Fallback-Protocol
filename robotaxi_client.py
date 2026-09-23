import asyncio
import json
import struct
import hashlib
from pathlib import Path
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from session_manager import increment_session_id

def get_discriminator(instruction_name: str) -> bytes:
    preimage = f"global:{instruction_name}".encode('utf-8')
    return hashlib.sha256(preimage).digest()[:8]

async def main():
    print("Initialize Edge Client...")
    client = AsyncClient("https://api.devnet.solana.com")
    
    wallet_path = Path.home() / ".config" / "solana" / "id.json"
    with open(wallet_path, 'r') as f:
        secret_key = json.load(f)
    robot_keypair = Keypair.from_bytes(bytes(secret_key))
    
    program_id = Pubkey.from_string("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT")
    
    session_id = increment_session_id()
    print(f"🔄 Starting new test sequence with Session ID: {session_id}")
    session_id_bytes = session_id.to_bytes(8, 'little')
    
    session_pda, _ = Pubkey.find_program_address(
        [b"session", bytes(robot_keypair.pubkey()), session_id_bytes],
        program_id
    )
    
    print(f"🚨 [Robotaxi] CRITICAL: Traffic intersection deadlock! Passengers on board.")
    print(f"📡 Requesting immediate high-priority override...")
    
    # MASSIVE 1.0 SOL Priority Bounty!
    bounty_lamports = int(1.0 * 10**9) 
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
        
        sig = await client.send_transaction(tx)
        
        print(f"✅ Priority Escrow Locked! 1.0 SOL bounty transferred to PDA.")
        print(f"🔗 View transaction on Solscan:")
        print(f"   https://explorer.solana.com/tx/{sig.value}?cluster=devnet")
    except Exception as e:
        print(f"❌ Failed to request fallback: {e}")

    await client.close()

if __name__ == "__main__":
    asyncio.run(main())