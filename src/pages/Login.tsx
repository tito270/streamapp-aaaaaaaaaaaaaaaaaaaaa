import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../lib/auth";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
      // After login, reload so root will read server-side saved streams for this user
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message || "Failed to login");
    }
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
              USER LOGIN  STREAMWALL
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="w-full bg-[#111827] rounded-2xl shadow-2xl p-8 pt-16">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Username field with icon */}
            <div className="flex items-center gap-3 bg-[#1f2937] rounded px-3 py-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-cyan-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
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
                required
                placeholder="Username"
                className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none"
              />
            </div>

            {/* Password field with icon */}
            <div className="flex items-center gap-3 bg-[#1f2937] rounded px-3 py-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-cyan-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
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
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Password"
                className="flex-1 bg-transparent text-white placeholder-gray-400 outline-none"
              />
            </div>

            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            {/* Login button */}
            <div>
              <button
                type="submit"
                className="w-full py-2 bg-cyan-500 text-white font-semibold rounded shadow hover:bg-cyan-600"
              >
                LOGIN
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
