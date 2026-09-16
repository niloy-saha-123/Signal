declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
      workspaceId?: string | null;
    }
  }
}
export {};
