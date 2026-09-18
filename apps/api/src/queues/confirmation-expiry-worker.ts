// Worker for the pending-confirmation-expiry sweep: periodically auto-denies
// chat confirmations left unresolved past the TTL. Pure orchestration — the
// actual expiry logic lives in agents/chat/confirmation-expiry.ts (tested
// independently with fake deps); this only binds it to BullMQ.
import type { Job, Worker } from "bullmq";
import { autoDenyExpiredConfirmations } from "../agents/chat/confirmation-expiry";
import { registerWorker } from "./registry";

export function createConfirmationExpiryProcessor(
  expire: () => Promise<number> = () => autoDenyExpiredConfirmations()
) {
  return async function processConfirmationExpiry(_job: Job): Promise<void> {
    const expired = await expire();
    if (expired > 0) {
      // The count is the signal for an operator watching schedules; the per-thread
      // reason is already logged by autoDenyExpiredConfirmations' logExpiry.
      await _job.log(`auto-denied ${expired} stale confirmations`);
    }
  };
}

export const confirmationExpiryProcessor = createConfirmationExpiryProcessor();

export function initConfirmationExpiryWorker(): Worker {
  return registerWorker("pending-confirmation-expiry", confirmationExpiryProcessor);
}