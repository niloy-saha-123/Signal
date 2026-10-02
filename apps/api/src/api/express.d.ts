declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      workspaceId?: string | null;
      // Set by requireApiToken on /mcp only.
      apiTokenId?: string;
    }
  }
}
export {};
