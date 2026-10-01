"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CompanyAreaTabs } from "@/components/area-tabs";
import { GoalsList } from "@/components/GoalsList";
import { Icon } from "@/components/ui/icons";
import { Badge, Button, PageHeader, cx } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import type { CompanyProfile, Competitor, CompanyDocument } from "@/lib/api";
import { saveCompanyProfile, uploadCompanyDocument, getSignalGoal, saveSignalGoal } from "@/lib/api";
import { validateDocument, formatBytes, ACCEPTED_DOC_EXTENSIONS } from "@/lib/attachments";
import { formatDate } from "@/lib/format";

interface PricingTier {
  name: string;
  price: number;
  billing: "monthly" | "annual" | "custom";
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const DOC_STATUS: Record<string, { label: string; tone: "hit" | "accent" | "neutral" | "miss" }> = {
  structured: { label: "Merged into profile", tone: "hit" },
  embedded: { label: "Searchable", tone: "accent" },
  pending: { label: "Reading", tone: "neutral" },
  failed: { label: "Couldn't read", tone: "miss" },
};

const FIELD =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-ink focus:outline-none";
const LABEL = "flex flex-col gap-1.5 text-[13px] font-semibold text-ink";

export function CompanyClient({
  profile,
  competitors,
  documents,
}: {
  profile: CompanyProfile | null;
  competitors: Competitor[];
  documents: CompanyDocument[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productDescription, setProductDescription] = useState(profile?.product_description ?? "");
  const [icpCompanySize, setIcpCompanySize] = useState(profile?.icp_company_size ?? "");
  const [icpIndustries, setIcpIndustries] = useState((profile?.icp_industries ?? []).join(", "));
  const [icpBuyerRole, setIcpBuyerRole] = useState(profile?.icp_buyer_role ?? "");
  const [differentiators, setDifferentiators] = useState(
    (profile?.key_differentiators ?? []).join(", ")
  );
  const [tiers, setTiers] = useState<PricingTier[]>(
    (profile?.pricing_tiers ?? []).map((t) => ({
      name: t.name,
      price: Number(t.price),
      billing: t.billing as PricingTier["billing"],
    }))
  );
  const [primaryIds, setPrimaryIds] = useState<string[]>(profile?.primary_competitor_ids ?? []);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [goal, setGoal] = useState("");
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalSaving, setGoalSaving] = useState(false);

  useEffect(() => {
    getSignalGoal()
      .then((result) => {
        if (result.goal) setGoal(result.goal);
      })
      .catch(() => {})
      .finally(() => setGoalLoading(false));
  }, []);

  async function handleSaveGoal(event: FormEvent) {
    event.preventDefault();
    if (!goal.trim()) return;
    setGoalSaving(true);
    try {
      await saveSignalGoal(goal.trim());
      toast("Goal saved. Signal weighs new evidence against it from now on.", "success");
    } catch {
      toast("Couldn't save the goal. Try again in a moment.", "error");
    } finally {
      setGoalSaving(false);
    }
  }

  function togglePrimary(id: string) {
    setPrimaryIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  function updateTier(index: number, patch: Partial<PricingTier>) {
    setTiers((current) => current.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const body: CompanyProfile = {
      product_description: productDescription,
      icp_company_size: icpCompanySize || undefined,
      icp_industries: splitList(icpIndustries),
      icp_buyer_role: icpBuyerRole || undefined,
      pricing_tiers: tiers.filter((t) => t.name.trim().length > 0).map((t) => ({
        name: t.name,
        price: Number.isFinite(t.price) ? t.price : 0,
        billing: t.billing,
      })),
      key_differentiators: splitList(differentiators),
      primary_competitor_ids: primaryIds,
    };
    try {
      await saveCompanyProfile(body);
      toast("Company profile saved.", "success");
      router.refresh();
    } catch {
      toast("Couldn't save the profile. Try again in a moment.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const invalid = validateDocument(file);
        if (invalid) {
          setUploadError(invalid);
          continue;
        }
        await uploadCompanyDocument(file);
        toast(`Uploaded ${file.name}. Signal is reading it.`, "success");
      }
      router.refresh();
    } catch {
      setUploadError("Upload failed. Check the file and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Your company"
        description="What Signal knows about you. It judges every competitor move against this, so a sharper profile means sharper forecasts."
        action={<CompanyAreaTabs active="profile" />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <form onSubmit={handleSaveGoal} className="rounded-[14px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-semibold text-ink">What you&apos;re trying to do</h2>
            <p className="mt-1 text-[13.5px] text-ink-secondary">
              &ldquo;Defend the enterprise tier&rdquo; reads every signal differently from &ldquo;catch up in the
              mid-market.&rdquo;
            </p>
            <label className="mt-3 block">
              <span className="sr-only">Signal goal</span>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                disabled={goalLoading}
                placeholder="e.g. Win mid-market deals against the incumbent"
                className={cx(FIELD, "py-2.5 disabled:opacity-60")}
              />
            </label>
            <Button type="submit" variant="primary" size="sm" disabled={goalSaving || goalLoading} className="mt-3">
              {goalSaving ? "Saving…" : "Save goal"}
            </Button>
          </form>

          <form onSubmit={handleSave} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
            <h2 className="text-[15px] font-semibold text-ink">Profile</h2>

            <label className={LABEL}>
              What you sell
              <textarea
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                required
                rows={4}
                className={cx(FIELD, "py-2.5 font-normal")}
                placeholder="What your product does, and for whom."
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={LABEL}>
                Customer company size
                <input
                  value={icpCompanySize}
                  onChange={(e) => setIcpCompanySize(e.target.value)}
                  className={cx(FIELD, "h-11 font-normal")}
                  placeholder="e.g. 50–250 employees"
                />
              </label>
              <label className={LABEL}>
                Who buys it
                <input
                  value={icpBuyerRole}
                  onChange={(e) => setIcpBuyerRole(e.target.value)}
                  className={cx(FIELD, "h-11 font-normal")}
                  placeholder="e.g. Head of Product"
                />
              </label>
            </div>

            <label className={LABEL}>
              Industries you sell into
              <input
                value={icpIndustries}
                onChange={(e) => setIcpIndustries(e.target.value)}
                className={cx(FIELD, "h-11 font-normal")}
                placeholder="SaaS, fintech, healthcare (comma-separated)"
              />
            </label>

            <label className={LABEL}>
              What makes you different
              <input
                value={differentiators}
                onChange={(e) => setDifferentiators(e.target.value)}
                className={cx(FIELD, "h-11 font-normal")}
                placeholder="Faster onboarding, enterprise SSO (comma-separated)"
              />
            </label>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold text-ink">Pricing tiers</legend>
              {tiers.map((tier, index) => (
                <div key={index} className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <input
                    value={tier.name}
                    onChange={(e) => updateTier(index, { name: e.target.value })}
                    placeholder="Tier name"
                    aria-label={`Tier ${index + 1} name`}
                    className={cx(FIELD, "h-10 min-w-0 flex-1")}
                  />
                  <input
                    type="number"
                    min={0}
                    value={Number.isFinite(tier.price) ? tier.price : ""}
                    onChange={(e) => updateTier(index, { price: Number(e.target.value) })}
                    placeholder="Price"
                    aria-label={`Tier ${index + 1} price`}
                    className={cx(FIELD, "h-10 w-28")}
                  />
                  <select
                    value={tier.billing}
                    onChange={(e) => updateTier(index, { billing: e.target.value as PricingTier["billing"] })}
                    aria-label={`Tier ${index + 1} billing`}
                    className="h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink focus:border-ink focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                    <option value="custom">Custom</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-muted hover:bg-surface-sunken hover:text-ink"
                    aria-label={`Remove tier ${index + 1}`}
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                onClick={() => setTiers((current) => [...current, { name: "", price: 0, billing: "monthly" }])}
                className="self-start"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add a tier
              </Button>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-ink">Main competitors</legend>
              {competitors.length === 0 ? (
                <p className="text-[13.5px] text-ink-muted">Watch a competitor first, then mark the ones that matter most.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {competitors.map((competitor) => {
                    const checked = primaryIds.includes(competitor.id);
                    return (
                      <label
                        key={competitor.id}
                        className={cx(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                          checked ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:bg-surface-sunken"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePrimary(competitor.id)}
                          className="sr-only"
                        />
                        {checked ? <Icon name="check" className="h-3.5 w-3.5" /> : null}
                        {competitor.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <Button type="submit" variant="primary" disabled={saving} className="self-start">
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </div>

        <div className="flex flex-col gap-4">
          <GoalsList />

          <section aria-labelledby="docs-heading" className="rounded-[14px] border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="docs-heading" className="text-[15px] font-semibold text-ink">
                Documents
              </h2>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_DOC_EXTENSIONS.join(",")}
                className="hidden"
                onChange={(e) => {
                  handleUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Icon name="upload" className="h-4 w-4" />
                {uploading ? "Uploading…" : "Upload"}
              </Button>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">
              Decks, plans, pricing sheets. PDF, Word, text, CSV or JSON, up to {formatBytes(10 * 1024 * 1024)} each.
            </p>
            {uploadError && (
              <p role="alert" className="mt-2 text-[13.5px] text-miss-text">
                {uploadError}
              </p>
            )}

            {documents.length === 0 ? (
              <div className="mt-4 rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-center">
                <p className="text-[14px] font-semibold text-ink">No documents yet</p>
                <p className="mt-1 text-[13px] text-ink-muted">Signal reads what you upload and fills in your profile.</p>
              </div>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {documents.map((doc) => {
                  const status = DOC_STATUS[doc.extraction_status] ?? { label: doc.extraction_status, tone: "neutral" as const };
                  return (
                    <li key={doc.id} className="flex items-center justify-between gap-3 rounded-[10px] bg-sky px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-ink">{doc.filename}</p>
                        <p className="text-[12.5px] text-ink-muted">
                          {doc.doc_type ?? "Document"} · {formatDate(String(doc.created_at))}
                        </p>
                      </div>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
