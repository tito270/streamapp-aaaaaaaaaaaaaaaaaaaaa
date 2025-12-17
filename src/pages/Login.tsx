import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock, Loader2, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";

const Login: React.FC = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const navigate = useNavigate();

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate("/");
    };
    void checkAuth();
  }, [navigate]);

  // Load remembered email on mount
  useEffect(() => {
    const remembered = localStorage.getItem("rememberedEmail");
    if (remembered) {
      setEmail(remembered);
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
  const emailError =
    touched.email && !email.trim()
      ? "Email is required"
      : touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Please enter a valid email"
      : "";

  const passwordError = touched.password && !password ? "Password is required" : "";
  const isFormValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && password;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });

    if (!isFormValid) return;

    setError("");
    setIsLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) throw signInError;

      // Remember email
      if (rememberMe) localStorage.setItem("rememberedEmail", email);
      else localStorage.removeItem("rememberedEmail");

      navigate("/");
    } catch (err: any) {
      const msg = err?.message || "Failed to login";
      if (msg.includes("Invalid login credentials")) {
        setError("Invalid email or password. Please try again.");
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBlur = (field: "email" | "password") => {
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
              style={{ backgroundColor: "#cfc79a", transform: "skewX(-24deg)" }}
            />
            <div
              className="absolute top-[18px] left-[208px] h-[52px] w-[185px]"
              style={{ backgroundColor: "#1b3240", opacity: 0.9, transform: "skewX(-24deg)" }}
            />
            <div
              className="absolute top-[8px] left-[250px] h-[48px] w-[170px]"
              style={{ backgroundColor: "#4b7a78", opacity: 0.45, transform: "skewX(-24deg)" }}
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
              WELCOME IN STREAMWALL
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="w-full bg-card rounded-2xl shadow-2xl p-8 pt-16">
          <form onSubmit={handleLogin} className="space-y-5" noValidate>
            {/* Email */}
            <div>
              <label htmlFor="email" className="sr-only">Email</label>
              <div
                className={`flex items-center gap-3 bg-input rounded px-3 py-2.5 transition-all focus-within:ring-2 focus-within:ring-primary ${
                  emailError ? "ring-2 ring-destructive" : ""
                }`}
              >
                <Mail className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => handleBlur("email")}
                  placeholder="Email address"
                  autoComplete="email"
                  aria-invalid={!!emailError}
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                />
              </div>
              {emailError && (
                <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {emailError}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
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
                  aria-invalid={!!passwordError}
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
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {passwordError && (
                <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
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

            {/* Remember me */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  disabled={isLoading}
                />
                <label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer select-none">
                  Remember me
                </label>
              </div>
              <Link to="/forgot-password" className="text-sm text-primary hover:text-primary/80 transition-colors">
                Forgot password?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <div role="alert" className="text-sm text-destructive text-center bg-destructive/10 rounded-md py-2 px-3">
                {error}
              </div>
            )}

            {/* Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded shadow hover:bg-primary/90 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/register" className="text-primary hover:text-primary/80 transition-colors font-medium">
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
