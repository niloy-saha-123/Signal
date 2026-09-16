// apps/web/app/login/page.tsx
// Thin server shell around LoginForm — no data fetching, no session check (middleware already
// keeps an authenticated visitor from reaching this route).
import { LoginForm } from "./login-form";

export default function Page() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-16">
      <div className="text-center">
        <span className="text-lg font-semibold text-indigo-600">Signal</span>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">Log in</h1>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <LoginForm />
      </div>
    </div>
  );
}
