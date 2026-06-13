// CLI script that backfills historical Reddit and HN signals for a competitor over a date range.
import { logger } from "../src/lib/logger.js";

const args = process.argv.slice(2);
const competitorId = args.find((a) => a.startsWith("--competitor-id="))?.split("=")[1];
const days = Number(args.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);

if (!competitorId) {
  logger.error("Usage: npm run backfill -- --competitor-id=<id> --days=30");
  process.exit(1);
}

logger.info("Backfill started", { competitorId, days });
// TODO: implement historical data backfill
