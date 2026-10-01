import { createCompetitor, resolveCompany, type Competitor } from "./api";
import { normalizeDomain } from "./domain";

// One way to start watching a company from a typed website. Name resolution is
// best-effort: if it fails, the name falls back to the domain's first label
// rather than blocking the add.
export async function addCompetitorByDomain(domain: string): Promise<Competitor> {
  const resolved = await resolveCompany(domain).catch(() => null);
  const name = resolved?.name?.trim() || domain.split(".")[0]!;
  return createCompetitor({ name, domain: normalizeDomain(resolved?.domain ?? "") ?? domain });
}
