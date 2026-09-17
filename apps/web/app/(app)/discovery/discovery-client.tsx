"use client";
import { useState } from "react";

type Discovery = {
  id: string;
  competitor: string;
  type: string;
  title: string;
  source: string;
  detected: string;
  snippet: string;
  confidence: number;
};

export function DiscoveryClient({ discoveries: initialDiscoveries }: { discoveries: Discovery[] }) {
  const [discoveries, setDiscoveries] = useState(initialDiscoveries);

  const handleDismiss = (id: string) => {
    setDiscoveries((prev) => prev.filter((d) => d.id !== id));
  };

  const handleTrack = async (id: string) => {
    setDiscoveries((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Discovery
        </h1>
        <p className="text-sm font-semibold text-studio-muted">
          {discoveries.length} new movements to review
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {discoveries.length === 0 ? (
          <div className="flex items-center justify-center rounded-[1.6rem] border border-studio-line bg-studio-paper p-12">
            <p className="text-sm text-studio-muted">No new movements to review</p>
          </div>
        ) : (
          discoveries.map((discovery) => (
            <div
              key={discovery.id}
              className="flex gap-6 rounded-[1.6rem] border border-studio-line bg-studio-paper p-6"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-extrabold text-studio-ink">{discovery.competitor}</span>
                  <span className="rounded-full bg-studio-sky-soft px-2 py-0.5 font-bold text-studio-muted">
                    {discovery.type}
                  </span>
                  <span className="text-studio-muted">{discovery.detected}</span>
                </div>
                <h3 className="mt-3 text-lg leading-snug font-extrabold text-studio-ink capitalize">
                  {discovery.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-studio-muted">{discovery.snippet}</p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="text-studio-muted">Source</span>
                  <span className="font-semibold text-studio-action">{discovery.source}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleDismiss(discovery.id)}
                  className="rounded-full bg-studio-sky-soft px-4 py-2 text-sm font-semibold text-studio-muted hover:bg-studio-sky"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleTrack(discovery.id)}
                  className="rounded-full bg-studio-ink px-4 py-2 text-sm font-bold text-white hover:bg-[#071625]"
                >
                  Track
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
