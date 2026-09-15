// apps/web/app/board-client.tsx
// Freeform drag-and-drop canvas — native HTML5 DnD, no new dependency (per the design spec's
// own ruling). First pass: card positions are local state only, in-session, no persistence
// endpoint exists for this yet.
"use client";
import { useRef, useState, type DragEvent } from "react";
import { SignalScoreCard } from "../components/SignalScoreCard";

export interface BoardCardState {
  id: string;
  name: string;
  score: number;
  x: number;
  y: number;
}

export function Board({ initialCards }: { initialCards: BoardCardState[] }) {
  const [cards, setCards] = useState(initialCards);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  function onDragStart(event: DragEvent<HTMLDivElement>, cardId: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.dataTransfer.setData("text/plain", cardId);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const x = event.clientX - containerRect.left - dragOffset.current.x;
    const y = event.clientY - containerRect.top - dragOffset.current.y;
    setCards((current) => current.map((card) => (card.id === id ? { ...card, x, y } : card)));
  }

  return (
    <div
      ref={containerRef}
      data-testid="board-canvas"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="relative h-[600px] w-full rounded-lg border border-dashed border-slate-300 bg-slate-50"
    >
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`board-card-${card.id}`}
          draggable
          onDragStart={(event) => onDragStart(event, card.id)}
          style={{ position: "absolute", left: card.x, top: card.y, cursor: "grab" }}
          className="w-56"
        >
          <SignalScoreCard competitorName={card.name} score={card.score} delta7d={null} history={[]} />
        </div>
      ))}
    </div>
  );
}
