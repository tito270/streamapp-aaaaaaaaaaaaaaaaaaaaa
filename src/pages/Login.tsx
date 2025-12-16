import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { login } from "../lib/auth";

const REMEMBER_KEY = "streamwall.rememberedUsername";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState<{ username: boolean; password: boolean }>({
    username: false,
    password: false,
  });

  // Load remembered username
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) setUsername(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Persist / clear remembered username
  useEffect(() => {
    try {
      if (rememberMe && username.trim()) localStorage.setItem(REMEMBER_KEY, username.trim());
      if (!rememberMe) localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // ignore storage errors
    }
  }, [rememberMe, username]);

  const usernameError = useMemo(() => {
    if (!touched.username) return "";
    if (!username.trim()) return "Username is required.";
    if (username.trim().length < 3) return "Username must be at least 3 characters.";
    return "";
  }, [username, touched.username]);

  const passwordError = useMemo(() => {
    if (!touched.password) return "";
    if (!password) return "Password is required.";
    if (password.length < 6) return "Password must be at least 6 characters.";
    return "";
  }, [password, touched.password]);

  const canSubmit = !loading && !usernameError && !passwordError && username.trim() && password;

  const parseError = (err: unknown) => {
    if (err instanceof Error) return err.message || "Failed to login";
    if (typeof err === "string") return err;
    return "Failed to login";
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setTouched({ username: true, password: true });

    if (!canSubmit) return;

    setLoading(true);
    try {
      await login(username.trim(), password);

      // After login, reload so root will read server-side saved streams for this user
      window.location.href = "/";
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Works on modern browsers
    const on = e.getModifierState?.("CapsLock") ?? false;
    setCapsLockOn(on);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1620]">
      <div className="relative w-[420px]">
        {/* Banner */}
        <div className="absolute -top-12 -left-10 h-[74px] w-[370px]">
          <div className="relative h-full w-full">
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: "#cfc79a",
                transform: "skewX(-24deg)",
              }}
            />
            <div
              className="absolute top-[18px] left-[208px] h-[52px] w-[185px]"
              style={{
                backgroundColor: "#1b3240",
                opacity: 0.9,
                transform: "skewX(-24deg)",
              }}
            />
            <div
              className="absolute top-[8px] left-[250px] h-[48px] w-[170px]"
              style={{
                backgroundColor: "#4b7a78",
                opacity: 0.45,
                transform: "skewX(-24deg)",
              }}
            />
            <span
              className="absolute left-[82px] top-1/2 -translate-y-1/2"
              style={{
                color: "#21313a",
                fontWeight: 700,
                fontSize: "14px",
                letterSpacing: "0.32em",
              }}
            >
              USER LOGIN&nbsp;&nbsp;STREAMWALL
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="w-full bg-[#111827] rounded-2xl shadow-2xl p-8 pt-16">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Username */}
            <div>
              <label htmlFor="username" className="sr-only">
                Username
              </label>
              <div className="flex items-center gap-3 bg-[#1f2937] rounded px-3 py-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-cyan-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5.121 17.804A9 9 0 1112 21a9 9 0 01-6.879-3.196z"
                  />
                </svg>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, username: true }))}
                  required
                  placeholder="Username"
                  autoComplete="username"
                  className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none"
                />
              </div>
              {usernameError && (
                <p className="mt-1 text-xs text-red-400" role="alert">
                  {usernameError}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div className="flex items-center gap-3 bg-[#1f2937] rounded px-3 py-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-cyan-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 11c-1.657 0-3 1.343-3 3v1h6v-1c0-1.657-1.343-3-3-3z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 11V9a5 5 0 10-10 0v2"
                  />
                </svg>

                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  onKeyUp={handleCapsLock}
                  onKeyDown={handleCapsLock}
                  required
                  placeholder="Password"
                  autoComplete="current-password"
                  className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "HIDE" : "SHOW"}
                </button>
              </div>

              {capsLockOn && (
                <p className="mt-1 text-xs text-amber-300" role="status">
                  Caps Lock is ON.
                </p>
              )}

              {passwordError && (
                <p className="mt-1 text-xs text-red-400" role="alert">
                  {passwordError}
                </p>
              )}
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-sm text-gray-300 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 accent-cyan-500"
                />
                Remember me
              </label>

              {/* Change routes as needed */}
              <Link
                to="/forgot-password"
                className="text-sm text-cyan-400 hover:text-cyan-300"
              >
                Forgot password?
              </Link>
            </div>

            {error && <p className="text-sm text-red-400 text-center" role="alert">{error}</p>}

            {/* Login button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={!canSubmit}
                className={[
                  "w-full py-2 font-semibold rounded shadow",
                  canSubmit
                    ? "bg-cyan-500 hover:bg-cyan-600 text-white"
                    : "bg-cyan-500/40 text-white/70 cursor-not-allowed",
                ].join(" ")}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Logging in...
                  </span>
                ) : (
                  "LOGIN"
                )}
              </button>
            </div>

            {/* Optional: sign up link */}
            <div className="text-center text-sm text-gray-400 pt-1">
              Don’t have an account?{" "}
              <Link to="/register" className="text-cyan-400 hover:text-cyan-300">
                Create one
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
