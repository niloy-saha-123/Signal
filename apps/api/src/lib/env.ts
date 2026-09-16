import { existsSync } from "node:fs";
import path from "node:path";

// Every entrypoint (API server, worker, scripts) that touches process.env
// should call this before reading a repo-root .env value, so loading it here
// once covers all of them. A real environment variable (CI, prod) always
// wins — loadEnvFile never overwrites an already-set process.env key.
export function loadRootEnv(): void {
  const rootEnvPath = path.resolve(__dirname, "../../../../.env");
  if (existsSync(rootEnvPath)) {
    process.loadEnvFile(rootEnvPath);
  }
}
