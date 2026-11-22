import React, { useState } from 'react';
import { ArrowRight, Check, Lock, Moon, Sparkles, Sun } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import { DEFAULT_FEE_CONFIG } from '../engines/feeEngine';
import { formatRupeesFromPaise } from '../engines/istDate';
import type { BoardType, ClassLevel } from '../types';
import type { ThemePreference } from '../hooks/useTheme';

interface AuthOnboardingProps {
  initialized: boolean;
  onAuthenticated: (teacher: { id: string; email: string; name: string }) => void;
  theme: ThemePreference;
  onToggleTheme: () => void;
}

export const AuthOnboarding: React.FC<AuthOnboardingProps> = ({
  initialized,
  onAuthenticated,
  theme,
  onToggleTheme,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('Meera Deshmukh');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tuitionName, setTuitionName] = useState('Tuitio — Smart Tuition Management');
  const [sessionStart, setSessionStart] = useState('18:00');
  const [sessionEnd, setSessionEnd] = useState('20:00');
  const [boards, setBoards] = useState<BoardType[]>(['SSC', 'CBSE', 'ICSE']);
  const [includeDemoData, setIncludeDemoData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleBoard = (b: BoardType) => {
    setBoards((prev) => (prev.includes(b) ? (prev.length > 1 ? prev.filter((x) => x !== b) : prev) : [...prev, b]));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; teacher: { id: string; email: string; name: string } }>(
        '/api/auth/login',
        { method: 'POST', body: { email, password } },
      );
      setAuthToken(res.token);
      onAuthenticated(res.teacher);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError('Enter your name, a valid email, and a password of at least 6 characters.');
      setStep(1);
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; teacher: { id: string; email: string; name: string } }>(
        '/api/auth/setup',
        {
          method: 'POST',
          body: {
            name: name.trim(),
            email: email.trim(),
            password,
            tuitionName: tuitionName.trim(),
            sessionStart,
            sessionEnd,
            supportedBoards: boards,
            includeDemoData,
          },
        },
      );
      setAuthToken(res.token);
      onAuthenticated(res.teacher);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLaunch = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; teacher: { id: string; email: string; name: string } }>(
        '/api/auth/demo-bootstrap',
        { method: 'POST', body: {} },
      );
      setAuthToken(res.token);
      onAuthenticated(res.teacher);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open demo workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-600 dark:bg-white text-white dark:text-black flex items-center justify-center font-display font-extrabold text-lg">
            T
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            Tuitio
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Switch color theme"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium liquid-glass text-slate-700 dark:text-neutral-200 hover:bg-white dark:hover:bg-neutral-900 transition-colors whitespace-nowrap shrink-0"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>{theme === 'dark' ? 'Light Glass' : 'Monochrome Dark'}</span>
        </button>
      </header>

      <main className="max-w-5xl w-full mx-auto my-8 grid lg:grid-cols-12 gap-8 items-center">
        {/* Left Value Story */}
        <div className="lg:col-span-6 space-y-6">
          <p className="text-xs font-medium tracking-wide text-sky-700 dark:text-neutral-400">
            Personal Tuition Operating System · Classes 3–10 · IST 6:00 PM–8:00 PM
          </p>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-950 dark:text-white leading-[1.12]">
            One teacher. Every student, fee, and minute organized.
          </h1>
          <p className="text-base text-slate-600 dark:text-neutral-400 leading-relaxed max-w-xl">
            Open Tuitio at 5:30 PM to see who arrives when, swipe attendance in seconds, run parallel 6:00–8:00 PM study plans, track SSC/CBSE/ICSE fees automatically, and carry unfinished homework forward without clutter.
          </p>

          <div className="grid grid-cols-3 gap-4 pt-2 border-t border-sky-200/70 dark:border-white/15">
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-slate-900 dark:text-white">6–8 PM</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">Parallel IST Planner</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-slate-900 dark:text-white">₹500–₹1,200</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">Auto Class & Board Fees</p>
            </div>
            <div>
              <p className="font-mono tabular-nums text-xl font-semibold text-slate-900 dark:text-white">₹0 / mo</p>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">Cloudflare Free-Tier Ready</p>
            </div>
          </div>

          {!initialized && (
            <div className="pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleDemoLaunch}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-sky-300/80 dark:border-white/25 text-sky-800 dark:text-white hover:bg-sky-50 dark:hover:bg-white/10 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                <span>Explore Live Interactive Demo Batch</span>
              </button>
              <p className="text-xs text-slate-500 dark:text-neutral-500 mt-2">
                Loads 7 clearly flagged sample students (SSC, CBSE, ICSE) that you can clear anytime in Settings.
              </p>
            </div>
          )}
        </div>

        {/* Right Card: Sign In or Setup Wizard */}
        <div className="lg:col-span-6">
          <div className="liquid-glass-strong rounded-3xl p-6 sm:p-8">
            {initialized ? (
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Teacher Sign In</h2>
                  <p className="text-sm text-slate-500 dark:text-neutral-400 mt-1">
                    Private workspace. Sign in to access student profiles, attendance, and fees.
                  </p>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-neutral-900 border border-rose-200 dark:border-white/25 text-xs text-rose-700 dark:text-white">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                      Teacher Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="teacher@example.in"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  <Lock className="w-4 h-4" />
                  <span>{submitting ? 'Signing in...' : 'Sign In to Workspace'}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleSetup} className="space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white">First-Run Tuition Setup</h2>
                    <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                      Step {step} of 3 · {step === 1 ? 'Secure Teacher Account' : step === 2 ? 'Batch Timings & Boards' : 'Confirm Default Fee Matrix'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3].map((s) => (
                      <span
                        key={s}
                        className={`h-1.5 rounded-full transition-all ${
                          s <= step ? 'w-6 bg-sky-600 dark:bg-white' : 'w-3 bg-sky-200 dark:bg-neutral-800'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-neutral-900 border border-rose-200 dark:border-white/25 text-xs text-rose-700 dark:text-white">
                    {error}
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="setup-name" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                        Teacher Full Name
                      </label>
                      <input
                        id="setup-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="setup-email" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                        Login Email
                      </label>
                      <input
                        id="setup-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.in"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="setup-pass" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                        Password (min 6 characters)
                      </label>
                      <input
                        id="setup-pass"
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a strong teacher password"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!name.trim() || !email.trim() || password.length < 6) {
                          setError('Please complete name, email, and a 6+ character password first.');
                          return;
                        }
                        setError(null);
                        setStep(2);
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <span>Continue to Batch Timings</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="setup-tuition" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                        Tuition Brand Name (editable anytime)
                      </label>
                      <input
                        id="setup-tuition"
                        type="text"
                        value={tuitionName}
                        onChange={(e) => setTuitionName(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 dark:focus:ring-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="setup-start" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                          Daily Start (IST)
                        </label>
                        <input
                          id="setup-start"
                          type="time"
                          value={sessionStart}
                          onChange={(e) => setSessionStart(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label htmlFor="setup-end" className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-1.5">
                          Daily End (IST)
                        </label>
                        <input
                          id="setup-end"
                          type="time"
                          value={sessionEnd}
                          onChange={(e) => setSessionEnd(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/80 dark:bg-black border border-sky-200/80 dark:border-white/20 text-sm font-mono text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <span className="block text-xs font-medium text-slate-700 dark:text-neutral-300 mb-2">
                        Supported Boards
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {(['SSC', 'CBSE', 'ICSE'] as BoardType[]).map((b) => {
                          const active = boards.includes(b);
                          return (
                            <button
                              key={b}
                              type="button"
                              onClick={() => toggleBoard(b)}
                              className={`py-2.5 rounded-xl text-xs font-semibold border transition-colors ${
                                active
                                  ? 'bg-sky-600 text-white border-sky-600 dark:bg-white dark:text-black dark:border-white'
                                  : 'bg-white/60 dark:bg-black text-slate-600 dark:text-neutral-400 border-sky-200 dark:border-white/15'
                              }`}
                            >
                              {b}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-4 py-3 rounded-xl border border-sky-200 dark:border-white/20 text-sm font-medium text-slate-700 dark:text-neutral-300"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep(3)}
                        className="flex-1 py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black font-semibold text-sm flex items-center justify-center gap-2"
                      >
                        <span>Review Fee Structure</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-sky-200/70 dark:border-white/15 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-sky-50/90 dark:bg-neutral-900 text-slate-600 dark:text-neutral-300">
                          <tr>
                            <th className="py-2 px-3 text-left font-medium">Class</th>
                            <th className="py-2 px-3 text-right font-medium">SSC</th>
                            <th className="py-2 px-3 text-right font-medium">CBSE (+₹200)</th>
                            <th className="py-2 px-3 text-right font-medium">ICSE (+₹200)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sky-100/70 dark:divide-white/10 font-mono tabular-nums">
                          {([3, 4, 5, 6, 7, 8, 9, 10] as ClassLevel[]).map((cls) => {
                            const ssc = DEFAULT_FEE_CONFIG.classRatesPaise[cls];
                            return (
                              <tr key={cls} className="text-slate-800 dark:text-neutral-200">
                                <td className="py-1.5 px-3 font-sans font-medium">Class {cls}</td>
                                <td className="py-1.5 px-3 text-right">{formatRupeesFromPaise(ssc)}</td>
                                <td className="py-1.5 px-3 text-right">{formatRupeesFromPaise(ssc + 20_000)}</td>
                                <td className="py-1.5 px-3 text-right">{formatRupeesFromPaise(ssc + 20_000)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-xl bg-sky-50/70 dark:bg-neutral-900/90 border border-sky-200/60 dark:border-white/15 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeDemoData}
                        onChange={(e) => setIncludeDemoData(e.target.checked)}
                        className="mt-0.5 rounded accent-sky-600 dark:accent-white"
                      />
                      <span className="text-xs text-slate-700 dark:text-neutral-300 leading-relaxed">
                        Start with 7 sample Indian students (Classes 4–10, SSC/CBSE/ICSE) so I can test attendance, scheduling, and receipts right away. Sample records are tagged and removable in one click.
                      </span>
                    </label>

                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="px-4 py-3 rounded-xl border border-sky-200 dark:border-white/20 text-sm font-medium text-slate-700 dark:text-neutral-300"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <Check className="w-4 h-4" />
                        <span>{submitting ? 'Creating Workspace...' : 'Create Account & Launch'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-xs text-slate-500 dark:text-neutral-500 flex flex-wrap items-center justify-between gap-2">
        <span>Private single-teacher tuition OS · Asia/Kolkata (IST)</span>
        <span>Self-hosted SQLite & Cloudflare D1 Free-Tier Architecture</span>
      </footer>
    </div>
  );
};
