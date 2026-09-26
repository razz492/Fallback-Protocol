import { Connection, Commitment, Finality, PublicKey } from "@solana/web3.js";

export type ConfirmationResult =
  | { status: "confirmed"; signature: string; slot: number }
  | { status: "finalized"; signature: string; slot: number }
  | { status: "expired"; signature: string; reason: string }
  | { status: "timeout"; signature: string; reason: string };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 80; // ~120 seconds total

export async function pollSignatureConfirmation(
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed",
  timeoutMs: number = 60000,
  publicKey?: PublicKey
): Promise<ConfirmationResult> {
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (Date.now() - startTime > timeoutMs) {
      return { status: "timeout", signature, reason: `Timed out after ${timeoutMs / 1000}s` };
    }

    try {
      // Primary: getSignatureStatus (fast, checks recent status cache)
      const statusResult = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      const status = statusResult.value;

      if (status) {
        if (status.err) {
          return { status: "expired", signature, reason: `Transaction failed: ${status.err}` };
        }

        if (status.confirmationStatus) {
          if (commitment === "finalized" && status.confirmationStatus === "finalized") {
            return { status: "finalized", signature, slot: status.slot };
          }
          if (commitment === "confirmed" && status.confirmationStatus === "confirmed") {
            return { status: "confirmed", signature, slot: status.slot };
          }
          if (
            commitment === "processed" &&
            ["processed", "confirmed", "finalized"].includes(status.confirmationStatus)
          ) {
            return { status: "confirmed", signature, slot: status.slot };
          }
        }
      }

      // Fallback: getTransaction — more reliable for recently-submitted txs
      // getSignatureStatus can return null for transactions not yet in the status cache
      if (publicKey) {
        try {
          const tx = await connection.getTransaction(signature, {
            commitment: commitment as Finality,
            maxSupportedTransactionVersion: 0,
          });
          if (tx) {
            // Transaction found on-chain — check its status
            if (tx.meta?.err) {
              return { status: "expired", signature, reason: `Transaction failed in block` };
            }
            // Found and executed successfully — treat as confirmed
            return { status: "confirmed", signature, slot: tx.slot };
          }
        } catch {
          // getTransaction not found yet or error — keep polling
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return { status: "timeout", signature, reason: `Exceeded ${MAX_ATTEMPTS} polling attempts` };
}
