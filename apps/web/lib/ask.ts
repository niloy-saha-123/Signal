// "Ask Signal about this" from anywhere: dispatch a prompt, and the chat panel in
// the app shell opens with it pre-filled (never auto-sent — the person can edit
// it first). A window event keeps callers free of any chat dependency.
export const ASK_EVENT = "signal:ask";

export function askSignal(prompt: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { prompt } }));
}

export function onAskSignal(handler: (prompt: string) => void): () => void {
  function listener(event: Event) {
    const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
    if (typeof prompt === "string") handler(prompt.slice(0, 2000));
  }
  window.addEventListener(ASK_EVENT, listener);
  return () => window.removeEventListener(ASK_EVENT, listener);
}
