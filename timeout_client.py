import asyncio
import json
import struct
import hashlib
from pathlib import Path
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
    print("Initialize Timeout Client...")
    client = AsyncClient("https://api.devnet.solana.com")
    
    # Load the Robot's Wallet
    wallet_path = Path.home() / ".config" / "solana" / "id.json"
    with open(wallet_path, 'r') as f:
        secret_key = json.load(f)
    robot_keypair = Keypair.from_bytes(bytes(secret_key))
    
    program_id = Pubkey.from_string("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT")
    
    # Target a new session ID for the test
    session_id = get_current_session_id()
    session_id_bytes = session_id.to_bytes(8, 'little')
    
    session_pda, _ = Pubkey.find_program_address(
        [b"session", bytes(robot_keypair.pubkey()), session_id_bytes],
        program_id
    )
    
    print(f"⚖️  Robot attempting to cancel Session {session_id} and slash operator bond...")
    
    # Construct the CancelTimeout Instruction
    discriminator = get_discriminator("cancel_timeout")
    
    # The CancelTimeout instruction takes no arguments, so we only need the discriminator
    instruction_data = discriminator
    
    # Map the Accounts exactly as they appear in the Rust CancelTimeout struct
    keys = [
        AccountMeta(pubkey=robot_keypair.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=session_pda, is_signer=False, is_writable=True),
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
        
        print(f"🚨 Timeout Cancelled! Operator bond slashed. Robot reclaimed 0.15 SOL.")
        print(f"🔗 View transaction on Solscan:")
        print(f"   https://solscan.io/tx/{sig.value}?cluster=devnet")
    except Exception as e:
        print(f"❌ Failed to cancel timeout: {e}")

    await client.close()

if __name__ == "__main__":
    asyncio.run(main())