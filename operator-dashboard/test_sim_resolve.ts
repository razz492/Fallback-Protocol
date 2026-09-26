import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import crypto from "crypto";
import fs from "fs";
import os from "os";

async function main() {
    const connection = new Connection("https://api.devnet.solana.com");
    const PROGRAM_ID = new PublicKey("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT");
    const ROBOT_PUBKEY = new PublicKey("9kRjRmidhpzdCUckaG4wRKXmqfnDixT4xz6uppEga6b7");
    
    // Check latest session
    const sessionConfig = JSON.parse(fs.readFileSync("../session_config.json", "utf-8"));
    const sessionId = BigInt(sessionConfig.session_id);
    console.log("Simulating Resolve for session_id:", sessionId);
    
    const sessionIdBuffer = Buffer.alloc(8);
    sessionIdBuffer.writeBigUInt64LE(sessionId);
    const [sessionPda] = PublicKey.findProgramAddressSync([Buffer.from("session"), ROBOT_PUBKEY.toBuffer(), sessionIdBuffer], PROGRAM_ID);
    
    // Resolve discriminator
    const hash = crypto.createHash("sha256").update("global:resolve_task").digest();
    const discriminator = hash.slice(0, 8);
    
    const telemetryHash = new Uint8Array(32);
    crypto.randomFillSync(telemetryHash);
    
    const resolveTaskIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: ROBOT_PUBKEY, isSigner: true, isWritable: true },
            { pubkey: sessionPda, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([discriminator, Buffer.from(telemetryHash)]),
    });

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
    
    const transaction = new Transaction().add(computeBudgetIx).add(resolveTaskIx);
    transaction.feePayer = ROBOT_PUBKEY;
    
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    
    const secret = JSON.parse(fs.readFileSync(os.homedir() + "/.config/solana/id.json", "utf-8"));
    const robotKeypair = Keypair.fromSecretKey(new Uint8Array(secret));
    transaction.sign(robotKeypair);
    
    console.log("Simulating transaction...");
    const simRes = await connection.simulateTransaction(transaction);
    console.log(JSON.stringify(simRes, null, 2));
}

main().catch(console.error);
