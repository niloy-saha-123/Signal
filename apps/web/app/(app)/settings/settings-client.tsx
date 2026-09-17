"use client";
import { useState } from "react";

export function SettingsClient() {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [slackIntegration, setSlackIntegration] = useState(true);
  const [weeklySummary, setWeeklySummary] = useState(false);

  // Profile fields
  const [name, setName] = useState("Sarah Chen");
  const [email, setEmail] = useState("sarah@company.com");
  const [role, setRole] = useState("Product Manager");

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <h1 className="font-serif text-4xl font-semibold text-slate-900">Settings</h1>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[370px_1fr]">
        {/* Left: Profile Card */}
        <div className="flex flex-col gap-6 rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="font-sans text-xl font-extrabold text-slate-900">Profile</h2>

          {/* Avatar */}
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-600 font-sans text-3xl font-extrabold text-white">
            SC
          </div>

          {/* Profile Fields */}
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 font-sans">
              <span className="text-xs font-bold text-slate-400">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg bg-slate-100 px-3.5 py-2.5 font-sans text-sm font-semibold text-slate-900 outline-none focus:bg-slate-200"
              />
            </label>

            <label className="flex flex-col gap-1 font-sans">
              <span className="text-xs font-bold text-slate-400">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg bg-slate-100 px-3.5 py-2.5 font-sans text-sm font-semibold text-slate-900 outline-none focus:bg-slate-200"
              />
            </label>

            <label className="flex flex-col gap-1 font-sans">
              <span className="text-xs font-bold text-slate-400">Role</span>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="rounded-lg bg-slate-100 px-3.5 py-2.5 font-sans text-sm font-semibold text-slate-900 outline-none focus:bg-slate-200"
              />
            </label>

            <button className="mt-2 rounded-lg bg-indigo-600 px-6 py-3 font-sans text-sm font-bold text-white transition-colors hover:bg-indigo-700">
              Save changes
            </button>
          </div>
        </div>

        {/* Right: Preferences Card */}
        <div className="flex flex-col gap-6 rounded-2xl bg-white p-8 shadow-sm">
          <h2 className="font-sans text-xl font-extrabold text-slate-900">Preferences</h2>

          {/* Preference Toggles */}
          <div className="flex flex-col divide-y divide-slate-200">
            {/* Email notifications */}
            <div className="flex items-center justify-between py-5 first:pt-0">
              <div>
                <p className="font-sans text-sm font-bold text-slate-900">Email notifications</p>
                <p className="mt-1 font-sans text-xs text-slate-600">
                  Receive daily briefing emails
                </p>
              </div>
              <button
                onClick={() => setEmailNotifications(!emailNotifications)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  emailNotifications ? "bg-indigo-600" : "bg-slate-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    emailNotifications ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Slack integration */}
            <div className="flex items-center justify-between py-5">
              <div>
                <p className="font-sans text-sm font-bold text-slate-900">Slack integration</p>
                <p className="mt-1 font-sans text-xs text-slate-600">
                  Post high-signal movements to Slack
                </p>
              </div>
              <button
                onClick={() => setSlackIntegration(!slackIntegration)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  slackIntegration ? "bg-indigo-600" : "bg-slate-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    slackIntegration ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Weekly summary */}
            <div className="flex items-center justify-between py-5">
              <div>
                <p className="font-sans text-sm font-bold text-slate-900">Weekly summary</p>
                <p className="mt-1 font-sans text-xs text-slate-600">
                  Get a weekly competitive landscape summary
                </p>
              </div>
              <button
                onClick={() => setWeeklySummary(!weeklySummary)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  weeklySummary ? "bg-indigo-600" : "bg-slate-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    weeklySummary ? "translate-x-[22px]" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
