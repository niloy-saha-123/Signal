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

export function GoalsList() {
  const [goals, setGoals] = useState<CompanyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [adding, setAdding] = useState(false);

  async function refresh() {
    try {
      const list = await listCompanyGoals();
      setGoals(list.filter((g) => g.status === "active"));
      setError(null);
    } catch {
      setError("Couldn't load goals.");
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

  return (
    <section className="rounded-[10px] bg-surface p-6">
      <div className="flex items-baseline justify-between">
        <h2 className=" text-xl font-semibold tracking-tight text-ink">
          Goals &amp; plans
        </h2>
        <span className="text-xs font-medium text-ink-secondary">Editable by you and Signal</span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-ink-secondary">Loading…</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {goals.map((goal) => (
            <li
              key={goal.id}
              data-testid={`goal-${goal.id}`}
              className="flex items-start gap-2 rounded-[10px] border border-line bg-surface-sunken px-3 py-2.5"
            >
              {editingId === goal.id ? (
                <div className="flex w-full items-center gap-2">
                  <input
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSave(goal.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full rounded-[10px] border border-line bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSave(goal.id)}
                    className="shrink-0 rounded-[10px] bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <p className="flex-1 text-sm text-ink">{goal.content}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {goal.created_by === "agent" && (
                      <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[10px] font-semibold text-accent">
                        Signal
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(goal.id);
                        setEditingText(goal.content);
                      }}
                      className="rounded-full p-1 text-ink-secondary hover:bg-white hover:text-ink"
                      aria-label="Edit goal"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleArchive(goal.id)}
                      className="rounded-full p-1 text-ink-secondary hover:bg-white hover:text-ink"
                      aria-label="Archive goal"
                    >
                      ⌫
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
          {goals.length === 0 && (
            <li className="rounded-[10px] border border-dashed border-line px-3 py-4 text-sm text-ink-secondary">
              No goals yet — add one, or ask Signal in chat to draft one.
            </li>
          )}
        </ul>
      )}

      <form onSubmit={handleAdd} className="mt-4 flex items-center gap-2">
        <input
          value={newGoal}
          onChange={(e) => setNewGoal(e.target.value)}
          placeholder="Add a goal or plan…"
          className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={adding || newGoal.trim().length === 0}
          className="shrink-0 rounded-[10px] bg-accent px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          Add
        </button>
      </form>
    </section>
  );
}