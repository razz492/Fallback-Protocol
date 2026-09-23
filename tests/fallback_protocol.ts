import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FallbackProtocol } from "../target/types/fallback_protocol";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import crypto from "crypto";

describe("fallback_protocol", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FallbackProtocol as Program<FallbackProtocol>;

  // Use the same wallet to play both roles for local testing
  const robot = provider.wallet;
  const operator = provider.wallet;
  
  const sessionId = new anchor.BN(1);
  const bounty = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
  const bond = new anchor.BN(0.05 * LAMPORTS_PER_SOL);
  
  // Dummy telemetry hash representing the clearance proof (32 bytes)
  const telemetryHash = Array.from(crypto.randomBytes(32));

  // Find the PDA (Program Derived Address) for this session
  const [sessionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("session"),
      robot.publicKey.toBuffer(),
      sessionId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  it("1. Robot requests fallback", async () => {
    await program.methods
      .requestFallback(sessionId, bounty)
      .accounts({
        robot: robot.publicKey,
        session: sessionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sessionAccount = await program.account.session.fetch(sessionPda);
    assert.ok(sessionAccount.status === 0);
    assert.ok(sessionAccount.bounty.eq(bounty));
    console.log("✅ Robot escrowed 0.1 SOL for rescue.");
  });

  it("2. Operator accepts the task", async () => {
    await program.methods
      .acceptTask(bond)
      .accounts({
        operator: operator.publicKey,
        session: sessionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sessionAccount = await program.account.session.fetch(sessionPda);
    assert.ok(sessionAccount.status === 1);
    assert.ok(sessionAccount.operator.equals(operator.publicKey));
    console.log("✅ Operator staked 0.05 SOL bond and claimed task.");
  });

  it("3. Operator resolves task and gets paid", async () => {
    await program.methods
      .resolveTask(telemetryHash)
      .accounts({
        operator: operator.publicKey,
        session: sessionPda,
      })
      .rpc();

    const sessionAccount = await program.account.session.fetch(sessionPda);
    assert.ok(sessionAccount.status === 2);
    console.log("✅ Edge case resolved! Bounty & Bond paid out to Operator.");
  });
});
