// Company goals/plans panel — the manual-edit surface for the same company_goals
// table the chat agent reads/writes via update_company_goals. Inline create/edit/
// archive with native controls (no component library, per repo decision).
"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  createCompanyGoal,
  deleteCompanyGoal,
  listCompanyGoals,
  updateCompanyGoal,
  type CompanyGoal,
} from "@/lib/api";
import { Badge, Button, ErrorState, LoadingRows } from "./ui/primitives";

export function GoalsList() {
  const [goals, setGoals] = useState<CompanyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    try {
      const list = await listCompanyGoals();
      setGoals(list.filter((g) => g.status === "active"));
      setError(null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const content = newGoal.trim();
    if (!content) return;
    setAdding(true);
    try {
      await createCompanyGoal(content);
      setNewGoal("");
      await refresh();
    } catch {
      setError("Couldn't add that goal.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSave(id: string) {
    const content = editingText.trim();
    if (!content) return;
    setError(null);
    try {
      await updateCompanyGoal(id, { content });
      setEditingId(null);
      await refresh();
    } catch {
      setError("Couldn't save that goal.");
    }
  }

  async function handleArchive(id: string) {
    setError(null);
    try {
      await updateCompanyGoal(id, { status: "archived" });
      await refresh();
    } catch {
      setError("Couldn't archive that goal.");
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteCompanyGoal(id);
      await refresh();
    } catch {
      setError("Couldn't delete that goal.");
    }
  }

  const iconButton =
    "rounded-[8px] px-2 py-1 text-[12.5px] font-semibold text-ink-secondary hover:bg-surface hover:text-ink";

  return (
    <section aria-labelledby="goals-heading" className="rounded-[14px] border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="goals-heading" className="text-[15px] font-semibold text-ink">
          Goals and plans
        </h2>
        <span className="text-[12.5px] text-ink-muted">You and Signal can both edit these</span>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13.5px] text-status-critical">
          {error}
        </p>
      )}

      {loading ? (
        <div className="mt-4">
          <LoadingRows rows={2} />
        </div>
      ) : loadFailed ? (
        <div className="mt-4">
          <ErrorState
            message="Goals didn't load."
            onRetry={() => {
              setLoading(true);
              void refresh();
            }}
          />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {goals.map((goal) => (
            <li
              key={goal.id}
              data-testid={`goal-${goal.id}`}
              className="flex items-start gap-2 rounded-[10px] bg-sky px-3 py-2.5"
            >
              {editingId === goal.id ? (
                <div className="flex w-full items-center gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Edit goal</span>
                    <input
                      value={editingText}
                      autoFocus
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSave(goal.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-9 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-[14px] text-ink focus:border-ink focus:outline-none"
                    />
                  </label>
                  <Button variant="primary" size="sm" onClick={() => void handleSave(goal.id)}>
                    Save
                  </Button>
                </div>
              ) : (
                <>
                  <p className="min-w-0 flex-1 text-[14px] break-words text-ink">{goal.content}</p>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {goal.created_by === "agent" && <Badge tone="accent">Signal</Badge>}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(goal.id);
                        setEditingText(goal.content);
                      }}
                      className={iconButton}
                      aria-label="Edit goal"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleArchive(goal.id)}
                      className={iconButton}
                      aria-label="Archive goal"
                    >
                      Archive
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {goals.length === 0 && (
            <li className="rounded-[10px] border border-dashed border-line-strong px-3 py-4 text-[13.5px] text-ink-secondary">
              No goals yet. Add one, or ask Signal in chat to draft one from your company profile.
            </li>
          )}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-4 flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">New goal</span>
          <input
            value={newGoal}
            onChange={(e) => setNewGoal(e.target.value)}
            placeholder="Add a goal or plan…"
            className="h-10 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none"
          />
        </label>
        <Button type="submit" variant="primary" disabled={adding || newGoal.trim().length === 0}>
          Add
        </Button>
      </form>
    </section>
  );
}
