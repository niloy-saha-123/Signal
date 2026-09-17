"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CompanyProfile, Competitor, CompanyDocument } from "@/lib/api";
import { saveCompanyProfile, uploadCompanyDocument } from "@/lib/api";
import { validateDocument, formatBytes, ACCEPTED_DOC_EXTENSIONS } from "@/lib/attachments";

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

const STATUS_BADGE: Record<string, string> = {
  structured: "bg-emerald-100 text-emerald-700",
  embedded: "bg-studio-sky text-studio-ink",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};

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
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
    setMessage(null);
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
      setMessage("Company profile saved.");
      router.refresh();
    } catch {
      setMessage("Couldn't save. Sign in and try again.");
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
      }
      router.refresh();
    } catch {
      setUploadError("Upload failed. Check the file and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Company
        </h1>
        <p className="text-sm text-studio-muted">
          The context Signal uses to decide what matters to you — plus the documents it learned from.
        </p>
      </div>

      {/* Profile */}
      <form
        onSubmit={handleSave}
        className="flex max-w-2xl flex-col gap-5 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8"
      >
        <h2 className="text-sm font-bold text-studio-ink">Company profile</h2>

        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Product description
          <textarea
            value={productDescription}
            onChange={(e) => setProductDescription(e.target.value)}
            required
            rows={4}
            className="rounded-2xl bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            placeholder="What your product does, and for whom."
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
            ICP company size
            <input
              value={icpCompanySize}
              onChange={(e) => setIcpCompanySize(e.target.value)}
              className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
              placeholder="e.g. 50–250 employees"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
            ICP buyer role
            <input
              value={icpBuyerRole}
              onChange={(e) => setIcpBuyerRole(e.target.value)}
              className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
              placeholder="e.g. Head of Product"
            />
          </label>
        </div>

        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          ICP industries (comma-separated)
          <input
            value={icpIndustries}
            onChange={(e) => setIcpIndustries(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            placeholder="SaaS, fintech, healthcare"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Key differentiators (comma-separated)
          <input
            value={differentiators}
            onChange={(e) => setDifferentiators(e.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
            placeholder="Cheaper, faster onboarding, enterprise SSO"
          />
        </label>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-studio-ink">Pricing tiers</p>
          {tiers.map((tier, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={tier.name}
                onChange={(e) => updateTier(index, { name: e.target.value })}
                placeholder="Tier name"
                className="min-w-0 flex-1 rounded-full bg-studio-sky-soft px-4 py-2.5 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
              />
              <input
                type="number"
                value={Number.isFinite(tier.price) ? tier.price : ""}
                onChange={(e) => updateTier(index, { price: Number(e.target.value) })}
                placeholder="Price"
                className="w-24 rounded-full bg-studio-sky-soft px-4 py-2.5 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
              />
              <select
                value={tier.billing}
                onChange={(e) => updateTier(index, { billing: e.target.value as PricingTier["billing"] })}
                className="rounded-full bg-studio-sky-soft px-3 py-2.5 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
              >
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="custom">Custom</option>
              </select>
              <button
                type="button"
                onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
                className="rounded-full px-3 text-studio-muted hover:text-studio-ink"
                aria-label="Remove tier"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTiers((current) => [...current, { name: "", price: 0, billing: "monthly" }])}
            className="self-start rounded-full bg-studio-sky-soft px-4 py-2 text-sm font-semibold text-studio-action hover:bg-studio-sky"
          >
            + Add tier
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-studio-ink">Primary competitors</p>
          {competitors.length === 0 ? (
            <p className="text-xs text-studio-muted">Add competitors first, then flag the primary ones.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {competitors.map((competitor) => {
                const checked = primaryIds.includes(competitor.id);
                return (
                  <label
                    key={competitor.id}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      checked
                        ? "border-studio-action bg-studio-action-soft text-studio-action"
                        : "border-studio-line bg-studio-paper text-studio-muted"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePrimary(competitor.id)}
                      className="hidden"
                    />
                    {competitor.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {message && <p className="text-sm text-studio-muted">{message}</p>}
        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-full bg-studio-ink px-6 py-3 text-sm font-bold text-white hover:bg-[#071625] disabled:opacity-50"
        >
          Save profile
        </button>
      </form>

      {/* Documents */}
      <section className="flex max-w-2xl flex-col gap-4 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-bold text-studio-ink">Documents</h2>
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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-full bg-studio-action px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-studio-action-hover disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload documents"}
          </button>
        </div>
        <p className="text-xs text-studio-muted">
          PDF, TXT, MD, DOC, DOCX, CSV, JSON, or RTF — up to {formatBytes(10 * 1024 * 1024)} each.
          Structured content merges into your profile; narrative text is embedded for retrieval.
        </p>
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

        {documents.length === 0 ? (
          <p className="text-sm text-studio-muted">No documents yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-4 rounded-2xl bg-studio-sky-soft px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-studio-ink">{doc.filename}</p>
                  <p className="text-xs text-studio-muted">
                    {doc.doc_type ?? "document"} · {new Date(doc.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    STATUS_BADGE[doc.extraction_status] ?? "bg-studio-sky-soft text-studio-muted"
                  }`}
                >
                  {doc.extraction_status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}