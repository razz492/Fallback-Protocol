import asyncio
import json
import struct
import hashlib
import os
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import ID as SYS_PROGRAM_ID
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from session_manager import get_current_session_id

def get_discriminator(instruction_name: str) -> bytes:
    preimage = f"global:{instruction_name}".encode('utf-8')
    return hashlib.sha256(preimage).digest()[:8]

async def main():
    print("Initialize Operator Dashboard...")
    client = AsyncClient("https://api.devnet.solana.com")
    
    # 1. Load the Operator's Wallet
    with open("operator.json", 'r') as f:
        secret_key = json.load(f)
    operator_keypair = Keypair.from_bytes(bytes(secret_key))
    
    # NOTE: We need the Robot's pubkey to derive the same PDA.
    # In a real app, the operator would read this from an on-chain index.
    # For now, we load it locally.
    with open(os.path.expanduser("~/.config/solana/id.json"), 'r') as f:
        robot_secret = json.load(f)
    robot_pubkey = Keypair.from_bytes(bytes(robot_secret)).pubkey()

    program_id = Pubkey.from_string("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT")
    
    # 2. Derive the exact same PDA
    session_id = get_current_session_id()
    session_id_bytes = session_id.to_bytes(8, 'little')
    
    session_pda, _ = Pubkey.find_program_address(
        [b"session", bytes(robot_pubkey), session_id_bytes],
        program_id
    )
    
    print(f"📡 Found Open Session {session_id} from Robot {robot_pubkey}")
    print(f"🔒 Staking 0.05 SOL Bond to claim task...")

    # --- PHASE 1: ACCEPT TASK ---
    bond_lamports = int(0.05 * 10**9) # 0.05 SOL
    discriminator = get_discriminator("accept_task")
    
    # Pack the u64 bond argument
    args = struct.pack("<Q", bond_lamports)
    instruction_data = discriminator + args
    
    keys = [
        AccountMeta(pubkey=operator_keypair.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=session_pda, is_signer=False, is_writable=True),
        AccountMeta(pubkey=SYS_PROGRAM_ID, is_signer=False, is_writable=False),
    ]
    
    ix_accept = Instruction(program_id=program_id, accounts=keys, data=instruction_data)
    
    recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
    msg = MessageV0.try_compile(
        payer=operator_keypair.pubkey(),
        instructions=[ix_accept],
        address_lookup_table_accounts=[],
        recent_blockhash=recent_blockhash,
    )
    tx = VersionedTransaction(msg, [operator_keypair])
    await client.send_transaction(tx)
    print("✅ Task Accepted! Bond secured in escrow.")
    
    """
    # Give the Devnet time to finalize Phase 1 before resolving!
    await asyncio.sleep(15)
    print("🛠️  Operator resolved the navigation deadlock. Submitting clearance hash...")

    # --- PHASE 2: RESOLVE TASK ---
    telemetry_hash = os.urandom(32) # Dummy SHA-256 hash
    discriminator_resolve = get_discriminator("resolve_task")
    
    # Pack the 32-byte hash
    instruction_data_resolve = discriminator_resolve + telemetry_hash
    
    keys_resolve = [
        AccountMeta(pubkey=operator_keypair.pubkey(), is_signer=True, is_writable=True),
        AccountMeta(pubkey=session_pda, is_signer=False, is_writable=True),
    ]
    
    ix_resolve = Instruction(program_id=program_id, accounts=keys_resolve, data=instruction_data_resolve)
    
    recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
    msg_resolve = MessageV0.try_compile(
        payer=operator_keypair.pubkey(),
        instructions=[ix_resolve],
        address_lookup_table_accounts=[],
        recent_blockhash=recent_blockhash,
    )
    tx_resolve = VersionedTransaction(msg_resolve, [operator_keypair])
    
    sig = await client.send_transaction(tx_resolve)
    print(f"🎉 Edge case closed! 0.1 SOL Bounty + 0.05 SOL Bond refunded to Operator.")
    print(f"🔗 View final transaction: https://solscan.io/tx/{sig.value}?cluster=devnet")

    """
    
    await client.close()

if __name__ == "__main__":
    asyncio.run(main())