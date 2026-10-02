"use client";

import { useState } from "react";
import { MAX_ROADMAP_LINKS_PER_PREDICTION, ROADMAP_STANCES } from "@signal/shared";
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

const STANCE_META: Record<RoadmapStance, { label: string; tone: "hit" | "miss" | "neutral" }> = {
  accelerate: { label: "Accelerate", tone: "hit" },
  deprioritize: { label: "Deprioritize", tone: "miss" },
  watching: { label: "Watching", tone: "neutral" },
};

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function addErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return `This forecast already has ${MAX_ROADMAP_LINKS_PER_PREDICTION} roadmap links.`;
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

  async function resync(onFailure?: () => void) {
    try {
      setLinks((await getPrediction(predictionId)).roadmap_links);
    } catch {
      onFailure?.();
    }
  }

  async function mutate(
    optimistic: RoadmapLink[],
    call: () => Promise<unknown>,
    goneIsSuccess = false,
  ) {
    const previous = links;
    setError(null);
    setBusy(true);
    setLinks(optimistic);
    try {
      await call();
    } catch (e) {
      if (goneIsSuccess && e instanceof ApiError && e.status === 404) {
        await resync();
      } else {
        setError("Couldn't save. Try again.");
        await resync(() => setLinks(previous));
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
      true,
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
      if (e instanceof ApiError && e.status === 409) await resync();
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
            const current = STANCE_META[link.stance] ?? STANCE_META.watching;
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
                      {ROADMAP_STANCES.map((value) => (
                        <option key={value} value={value}>
                          {STANCE_META[value].label}
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

      {readOnly || links.length >= MAX_ROADMAP_LINKS_PER_PREDICTION ? null : (
        <form
          onSubmit={add}
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto] sm:items-end"
        >
          <TextInput
            label="Title"
            value={title}
            disabled={busy}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <TextInput
            label="URL"
            type="url"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Select
            label="New link stance"
            value={stance}
            disabled={busy}
            onChange={(value) => setStance(value as RoadmapStance)}
          >
            {ROADMAP_STANCES.map((value) => (
              <option key={value} value={value}>
                {STANCE_META[value].label}
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
