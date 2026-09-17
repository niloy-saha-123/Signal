"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { CompanyProfile } from "@/lib/api";
import { getCompanyProfile, listCompetitors, saveCompanyProfile } from "@/lib/api";

function splitTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [productDescription, setProductDescription] = useState("");
  const [icpIndustries, setIcpIndustries] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCompanyProfile().catch(() => null), listCompetitors().catch(() => [])])
      .then(([profile]) => {
        if (!profile) return;
        setHasProfile(true);
        setProductDescription(profile.product_description);
        setIcpIndustries(profile.icp_industries.join(", "));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const profile: CompanyProfile = {
      product_description: productDescription,
      icp_industries: splitTags(icpIndustries),
      pricing_tiers: [],
      key_differentiators: [],
      primary_competitor_ids: [],
    };
    try {
      await saveCompanyProfile(profile);
      setHasProfile(true);
    } catch {
      setError("Could not save the company profile. Sign in and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-[-0.035em] text-studio-ink">
          Settings
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-studio-muted">
          Company context is what keeps briefings specific to your market instead of generic
          competitor news.
        </p>
      </div>

      {!loading && !hasProfile ? (
        <p className="rounded-[1.4rem] border border-studio-line bg-studio-sky-soft px-5 py-4 text-sm leading-relaxed text-studio-ink">
          Complete your company profile to get personalized intelligence instead of generic analysis.
        </p>
      ) : null}

      <form
        onSubmit={handleSave}
        className="flex max-w-2xl flex-col gap-5 rounded-[1.6rem] border border-studio-line bg-studio-paper p-8"
      >
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          Product description
          <textarea
            value={productDescription}
            onChange={(event) => setProductDescription(event.target.value)}
            required
            rows={5}
            className="rounded-2xl bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold text-studio-ink">
          ICP industries (comma-separated)
          <input
            value={icpIndustries}
            onChange={(event) => setIcpIndustries(event.target.value)}
            className="rounded-full bg-studio-sky-soft px-4 py-3 text-sm font-normal text-studio-ink outline-none focus:bg-studio-sky"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-full bg-studio-ink px-6 py-3 text-sm font-bold text-white hover:bg-[#071625] disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </div>
  );
}
