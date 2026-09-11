// Opaque keyset-pagination cursor shared by the signal and alert feeds.
//
// A cursor is base64url(JSON({ created_at, id })) — the two columns the feed
// queries sort on, so a page boundary is deterministic even when many rows
// share a created_at. It is deliberately opaque to clients: they echo back
// whatever `next_cursor` the previous page returned and never construct one.
// decodeCursor throws on anything malformed; the route layer maps that to 400.
import { z } from "zod";

export interface FeedCursor {
  created_at: Date;
  id: string;
}

const CursorSchema = z.object({
  created_at: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

export function encodeCursor(c: FeedCursor): string {
  const json = JSON.stringify({ created_at: c.created_at.toISOString(), id: c.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(s: string): FeedCursor {
  let json: string;
  try {
    json = Buffer.from(s, "base64url").toString("utf8");
  } catch {
    throw new Error("malformed cursor");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("malformed cursor");
  }

  const parsed = CursorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("malformed cursor");
  }
  return { created_at: new Date(parsed.data.created_at), id: parsed.data.id };
}
