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

  const handleTrack = (id: string) => {
    // TODO: Implement tracking logic
    console.log("Track:", id);
    setDiscoveries((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-4xl font-semibold text-slate-900">Discovery</h1>
        <p className="font-sans text-sm font-semibold text-slate-600">
          {discoveries.length} new movements to review
        </p>
      </div>

      {/* Discovery Feed */}
      <div className="flex flex-col gap-4">
        {discoveries.length === 0 ? (
          <div className="flex items-center justify-center rounded-2xl bg-white p-12 shadow-sm">
            <p className="font-sans text-sm text-slate-400">No new movements to review</p>
          </div>
        ) : (
          discoveries.map((discovery) => (
            <div
              key={discovery.id}
              className="flex gap-6 rounded-2xl bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              {/* Left: Content */}
              <div className="flex-1">
                {/* Meta row */}
                <div className="flex items-center gap-2 font-sans text-xs">
                  <span className="font-extrabold text-slate-900">{discovery.competitor}</span>
                  <span className="text-slate-400">·</span>
                  <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-600">
                    {discovery.type}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{discovery.detected}</span>
                </div>

                {/* Title */}
                <h3 className="mt-3 font-sans text-lg font-extrabold capitalize leading-snug text-slate-900">
                  {discovery.title}
                </h3>

                {/* Snippet */}
                <p className="mt-2 font-sans text-sm leading-relaxed text-slate-600">
                  {discovery.snippet}
                </p>

                {/* Source */}
                <div className="mt-3 flex items-center gap-2 font-sans text-xs">
                  <span className="text-slate-400">Source:</span>
                  <span className="font-semibold text-indigo-600">{discovery.source}</span>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleDismiss(discovery.id)}
                  className="rounded-lg bg-slate-100 px-4 py-2 font-sans text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => handleTrack(discovery.id)}
                  className="rounded-lg bg-indigo-600 px-4 py-2 font-sans text-sm font-bold text-white transition-colors hover:bg-indigo-700"
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
