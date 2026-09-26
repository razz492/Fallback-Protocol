import { Connection, Commitment } from "@solana/web3.js";

export type ConfirmationResult =
  | { status: "confirmed"; signature: string; blockNumber: number }
  | { status: "finalized"; signature: string; blockNumber: number }
  | { status: "expired"; signature: string; reason: string }
  | { status: "timeout"; signature: string; reason: string };

const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 40; // ~60 seconds total

export async function pollSignatureConfirmation(
  connection: Connection,
  signature: string,
  commitment: Commitment = "confirmed",
  timeoutMs: number = 30000
): Promise<ConfirmationResult> {
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (Date.now() - startTime > timeoutMs) {
      return { status: "timeout", signature, reason: `Timed out after ${timeoutMs / 1000}s` };
    }

    try {
      const result = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      const status = result.value;

      if (!status) {
        // Not found in recent slots — wait and retry
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      if (status.err) {
        return { status: "expired", signature, reason: `Transaction failed: ${status.err}` };
      }

      if (status.confirmationStatus) {
        if (commitment === "finalized" && status.confirmationStatus === "finalized") {
          return { status: "finalized", signature, blockNumber: status.slot };
        }
        if (commitment === "confirmed" && status.confirmationStatus === "confirmed") {
          return { status: "confirmed", signature, blockNumber: status.slot };
        }
        if (
          commitment === "processed" &&
          ["processed", "confirmed", "finalized"].includes(status.confirmationStatus)
        ) {
          return { status: "confirmed", signature, blockNumber: status.slot };
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } catch {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return { status: "timeout", signature, reason: `Exceeded ${MAX_ATTEMPTS} polling attempts` };
}
