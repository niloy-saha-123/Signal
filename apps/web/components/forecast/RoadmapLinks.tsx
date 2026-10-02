"use client";

import { useState } from "react";
import { Badge, Button, Select, TextInput } from "@/components/ui/primitives";
import {
  ApiError,
  createRoadmapLink,
  deleteRoadmapLink,
  getPrediction,
  updateRoadmapLink,
  type RoadmapLink,
  type RoadmapStance,
} from "@/lib/api";

const MAX_LINKS = 10;

const STANCES: Array<{
  value: RoadmapStance;
  label: string;
  tone: "hit" | "miss" | "neutral";
}> = [
  { value: "accelerate", label: "Accelerate", tone: "hit" },
  { value: "deprioritize", label: "Deprioritize", tone: "miss" },
  { value: "watching", label: "Watching", tone: "neutral" },
];

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function addErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return `This forecast already has ${MAX_LINKS} roadmap links.`;
  if (error instanceof ApiError && error.status === 400)
    return "Enter a title and an http(s) link.";
  return "Couldn't save. Try again.";
}

export function RoadmapLinks({
  predictionId,
  initialLinks,
  readOnly = false,
}: {
  predictionId: string;
  initialLinks: RoadmapLink[];
  readOnly?: boolean;
}) {
  const [links, setLinks] = useState(initialLinks);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [stance, setStance] = useState<RoadmapStance>("watching");

  async function mutate(
    optimistic: RoadmapLink[],
    call: () => Promise<unknown>,
  ) {
    const previous = links;
    setError(null);
    setBusy(true);
    setLinks(optimistic);
    try {
      await call();
    } catch {
      setError("Couldn't save. Try again.");
      try {
        setLinks((await getPrediction(predictionId)).roadmap_links);
      } catch {
        setLinks(previous);
      }
    } finally {
      setBusy(false);
    }
  }

  function changeStance(link: RoadmapLink, next: RoadmapStance) {
    return mutate(
      links.map((l) => (l.id === link.id ? { ...l, stance: next } : l)),
      () => updateRoadmapLink(predictionId, link.id, { stance: next }),
    );
  }

  function remove(link: RoadmapLink) {
    return mutate(
      links.filter((l) => l.id !== link.id),
      () => deleteRoadmapLink(predictionId, link.id),
    );
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createRoadmapLink(predictionId, {
        title: title.trim(),
        url: url.trim(),
        stance,
      });
      setLinks((current) => [...current, created]);
      setTitle("");
      setUrl("");
      setStance("watching");
    } catch (e) {
      setError(addErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {links.length === 0 ? (
        <p className="text-[14px] text-ink-muted">
          Link the roadmap items this forecast affects.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((link) => {
            const current =
              STANCES.find((s) => s.value === link.stance) ?? STANCES[2];
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[15px] font-semibold text-ink hover:underline"
                  >
                    {link.title}
                  </a>
                  <span className="ml-2 text-[13px] text-ink-muted">
                    {host(link.url)}
                  </span>
                </div>
                {readOnly ? (
                  <Badge tone={current.tone}>{current.label}</Badge>
                ) : (
                  <>
                    <Badge tone={current.tone}>{current.label}</Badge>
                    <Select
                      label={`Stance for ${link.title}`}
                      value={link.stance}
                      disabled={busy}
                      onChange={(value) =>
                        void changeStance(link, value as RoadmapStance)
                      }
                    >
                      {STANCES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove ${link.title}`}
                      onClick={() => void remove(link)}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-miss-text">
          {error}
        </p>
      ) : null}

      {readOnly || links.length >= MAX_LINKS ? null : (
        <form
          onSubmit={add}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end"
        >
          <TextInput
            label="Title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <TextInput
            label="URL"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Select
            label="New link stance"
            value={stance}
            onChange={(value) => setStance(value as RoadmapStance)}
          >
            {STANCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" disabled={busy}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
