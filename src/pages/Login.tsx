import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../lib/auth";
import { Eye, EyeOff, User, Lock, Loader2, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

const Login: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false });
  const navigate = useNavigate();

  // Load remembered username on mount
  useEffect(() => {
    const remembered = localStorage.getItem("rememberedUsername");
    if (remembered) {
      setUsername(remembered);
      setRememberMe(true);
    }
  }, []);

  // Detect caps lock
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    setCapsLockOn(e.getModifierState("CapsLock"));
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    setCapsLockOn(e.getModifierState("CapsLock"));
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Validation
  const usernameError = touched.username && !username.trim() ? "Username is required" : "";
  const passwordError = touched.password && !password ? "Password is required" : "";
  const isFormValid = username.trim() && password;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ username: true, password: true });
    
    if (!isFormValid) return;
    
    setError("");
    setIsLoading(true);
    
    try {
      await login(username, password);
      
      // Handle remember me
      if (rememberMe) {
        localStorage.setItem("rememberedUsername", username);
      } else {
        localStorage.removeItem("rememberedUsername");
      }
      
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message || "Failed to login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBlur = (field: "username" | "password") => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
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
        <div className="w-full bg-card rounded-2xl shadow-2xl p-8 pt-16">
          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            {/* Username field */}
            <div>
              <label htmlFor="username" className="sr-only">
                Username
              </label>
              <div
                className={`flex items-center gap-3 bg-input rounded px-3 py-2.5 transition-all focus-within:ring-2 focus-within:ring-primary ${
                  usernameError ? "ring-2 ring-destructive" : ""
                }`}
              >
                <User className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => handleBlur("username")}
                  placeholder="Username"
                  autoComplete="username"
                  aria-required="true"
                  aria-invalid={!!usernameError}
                  aria-describedby={usernameError ? "username-error" : undefined}
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                />
              </div>
              {usernameError && (
                <p id="username-error" className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {usernameError}
                </p>
              )}
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div
                className={`flex items-center gap-3 bg-input rounded px-3 py-2.5 transition-all focus-within:ring-2 focus-within:ring-primary ${
                  passwordError ? "ring-2 ring-destructive" : ""
                }`}
              >
                <Lock className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => handleBlur("password")}
                  placeholder="Password"
                  autoComplete="current-password"
                  aria-required="true"
                  aria-invalid={!!passwordError}
                  aria-describedby={passwordError ? "password-error" : undefined}
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {passwordError && (
                <p id="password-error" className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {passwordError}
                </p>
              )}
              {capsLockOn && !passwordError && (
                <p className="text-sm text-[hsl(var(--stream-warning))] mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Caps Lock is on
                </p>
              )}
            </div>

            {/* Remember me & Forgot password */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  disabled={isLoading}
                  aria-label="Remember my username"
                />
                <label
                  htmlFor="remember"
                  className="text-sm text-muted-foreground cursor-pointer select-none"
                >
                  Remember me
                </label>
              </div>
              <Link
                to="/forgot-password"
                className="text-sm text-primary hover:text-primary/80 transition-colors"
                tabIndex={isLoading ? -1 : 0}
              >
                Forgot password?
              </Link>
            </div>

            {/* Error message */}
            {error && (
              <div 
                role="alert" 
                className="text-sm text-destructive text-center bg-destructive/10 rounded-md py-2 px-3"
              >
                {error}
              </div>
            )}

            {/* Login button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded shadow hover:bg-primary/90 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "LOGIN"
              )}
            </button>

            {/* Register link */}
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link
                to="/register"
                className="text-primary hover:text-primary/80 transition-colors font-medium"
                tabIndex={isLoading ? -1 : 0}
              >
                Register
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
