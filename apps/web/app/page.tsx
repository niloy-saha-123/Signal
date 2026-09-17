// Public landing page
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Temporary landing page - will be replaced with full design */}
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-slate-900">Signal</h1>
          <p className="mb-8 text-lg text-slate-600">Competitive Intelligence Platform</p>
          <div className="space-x-4">
            <a
              href="/login"
              className="rounded-lg bg-indigo-600 px-6 py-3 text-white hover:bg-indigo-700"
            >
              Sign In
            </a>
            <a
              href="/signup"
              className="rounded-lg border border-indigo-600 px-6 py-3 text-indigo-600 hover:bg-indigo-50"
            >
              Sign Up
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
