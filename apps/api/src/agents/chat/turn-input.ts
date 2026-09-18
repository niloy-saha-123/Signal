import type { TurnDocument, TurnImage } from "./turn-attachments";

export interface ChatTurnInput {
  documents: TurnDocument[];
  images: TurnImage[];
}

const EMPTY: ChatTurnInput = { documents: [], images: [] };
const byRun = new Map<string, ChatTurnInput>();

export function setChatTurnInput(runId: string, input: ChatTurnInput): void {
  byRun.set(runId, input);
}

export function getChatTurnInput(runId: string): ChatTurnInput {
  return byRun.get(runId) ?? EMPTY;
}

export function clearChatTurnInput(runId: string): void {
  byRun.delete(runId);
}
