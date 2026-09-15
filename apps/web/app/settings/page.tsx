// Company profile — one-time setup injected into every analysis agent's system prompt
// (apps/api/src/lib/company-context.ts). Whole page is "use client" (deliberate exception,
// same class as DiscoveryStatus's polling) — inherently a stateful, prefilled form.
"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  getCompanyProfile,
  listCompetitors,
  saveCompanyProfile,
  type Competitor,
} from "../../lib/api";
import type { CompanyProfile } from "@signal/shared";

interface PricingTierDraft {
  name: string;
  price: string;
  billing: "monthly" | "annual" | "custom";
}

const EMPTY_PROFILE = {
  product_description: "",
  icp_company_size: "",
  icp_industries: [] as string[],
  icp_buyer_role: "",
  pricing_tiers: [] as PricingTierDraft[],
  key_differentiators: [] as string[],
  primary_competitor_ids: [] as string[],
};

export default function Page() {
  const [loaded, setLoaded] = useState(false);
  const [hadNoProfile, setHadNoProfile] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [productDescription, setProductDescription] = useState("");
  const [icpCompanySize, setIcpCompanySize] = useState("");
  const [icpIndustries, setIcpIndustries] = useState("");
  const [icpBuyerRole, setIcpBuyerRole] = useState("");
  const [pricingTiers, setPricingTiers] = useState<PricingTierDraft[]>([]);
  const [keyDifferentiators, setKeyDifferentiators] = useState("");
  const [primaryCompetitorIds, setPrimaryCompetitorIds] = useState<string[]>(
    EMPTY_PROFILE.primary_competitor_ids
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCompanyProfile(), listCompetitors()]).then(([profile, competitorList]) => {
      setCompetitors(competitorList);
      if (profile) {
        setProductDescription(profile.product_description);
        setIcpCompanySize(profile.icp_company_size ?? "");
        setIcpIndustries(profile.icp_industries.join(", "));
        setIcpBuyerRole(profile.icp_buyer_role ?? "");
        setPricingTiers(
          profile.pricing_tiers.map((tier) => ({
            name: tier.name,
            price: String(tier.price),
            billing: tier.billing,
          }))
        );
        setKeyDifferentiators(profile.key_differentiators.join(", "));
        setPrimaryCompetitorIds(profile.primary_competitor_ids);
      } else {
        setHadNoProfile(true);
      }
      setLoaded(true);
    });
  }, []);

  function addPricingTier() {
    setPricingTiers((current) => [...current, { name: "", price: "0", billing: "monthly" }]);
  }

  function removePricingTier(index: number) {
    setPricingTiers((current) => current.filter((_, i) => i !== index));
  }

  function updatePricingTier(index: number, field: keyof PricingTierDraft, value: string) {
    setPricingTiers((current) =>
      current.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier))
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const payload: CompanyProfile = {
      product_description: productDescription,
      icp_company_size: icpCompanySize || undefined,
      icp_industries: icpIndustries
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      icp_buyer_role: icpBuyerRole || undefined,
      pricing_tiers: pricingTiers.map((tier) => ({
        name: tier.name,
        price: Number(tier.price) || 0,
        billing: tier.billing,
      })),
      key_differentiators: keyDifferentiators
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      primary_competitor_ids: primaryCompetitorIds,
    };
    try {
      await saveCompanyProfile(payload);
      setSaved(true);
      setHadNoProfile(false);
    } catch {
      setError("Couldn't save your profile. Check the form and try again.");
    }
  }

  if (!loaded) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Company profile</h1>
      {hadNoProfile ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Complete your company profile to get personalized intelligence instead of generic
          analysis.
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col text-sm text-slate-700">
          Product description
          <textarea
            value={productDescription}
            onChange={(event) => setProductDescription(event.target.value)}
            required
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          ICP company size
          <input
            value={icpCompanySize}
            onChange={(event) => setIcpCompanySize(event.target.value)}
            placeholder="10-200 employees"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          ICP industries (comma-separated)
          <input
            value={icpIndustries}
            onChange={(event) => setIcpIndustries(event.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <label className="flex flex-col text-sm text-slate-700">
          ICP buyer role
          <input
            value={icpBuyerRole}
            onChange={(event) => setIcpBuyerRole(event.target.value)}
            placeholder="Head of Product"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-slate-700">Pricing tiers</span>
          {pricingTiers.map((tier, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={tier.name}
                onChange={(event) => updatePricingTier(index, "name", event.target.value)}
                placeholder="Tier name"
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              <input
                value={tier.price}
                onChange={(event) => updatePricingTier(index, "price", event.target.value)}
                type="number"
                className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              <select
                value={tier.billing}
                onChange={(event) =>
                  updatePricingTier(index, "billing", event.target.value as PricingTierDraft["billing"])
                }
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="monthly">monthly</option>
                <option value="annual">annual</option>
                <option value="custom">custom</option>
              </select>
              <button type="button" onClick={() => removePricingTier(index)} className="text-sm text-red-600">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={addPricingTier} className="self-start text-sm text-indigo-600">
            + Add pricing tier
          </button>
        </div>
        <label className="flex flex-col text-sm text-slate-700">
          Key differentiators (comma-separated, max 3)
          <input
            value={keyDifferentiators}
            onChange={(event) => setKeyDifferentiators(event.target.value)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm outline-none"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-slate-700">Primary competitors</span>
          {competitors.map((competitor) => (
            <label key={competitor.id} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={primaryCompetitorIds.includes(competitor.id)}
                onChange={(event) =>
                  setPrimaryCompetitorIds((current) =>
                    event.target.checked
                      ? [...current, competitor.id]
                      : current.filter((id) => id !== competitor.id)
                  )
                }
              />
              {competitor.name}
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Save
        </button>
        {saved ? <p className="text-sm text-emerald-600">Saved.</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
    </div>
  );
}
