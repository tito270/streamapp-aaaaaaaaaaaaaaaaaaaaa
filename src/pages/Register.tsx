import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Eye,
  EyeOff,
  User,
  Lock,
  Mail,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const Register: React.FC = () => {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [touched, setTouched] = useState({
    username: false,
    email: false,
    password: false,
    confirmPassword: false,
  });

  const navigate = useNavigate();
  const { toast } = useToast();

  // If already logged in -> go home
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate("/");
    };
    void checkAuth();
  }, [navigate]);

  // Caps lock detection
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
  const usernameError =
    touched.username && !username.trim()
      ? "Username is required"
      : touched.username && username.trim().length < 3
      ? "Username must be at least 3 characters"
      : "";

  const emailError =
    touched.email && !email.trim()
      ? "Email is required"
      : touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Please enter a valid email"
      : "";

  const passwordError =
    touched.password && !password
      ? "Password is required"
      : touched.password && password.length < 6
      ? "Password must be at least 6 characters"
      : "";

  const confirmPasswordError =
    touched.confirmPassword && !confirmPassword
      ? "Please confirm your password"
      : touched.confirmPassword && password !== confirmPassword
      ? "Passwords do not match"
      : "";

  const isFormValid =
    username.trim().length >= 3 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    password.length >= 6 &&
    password === confirmPassword;

  // Password strength
  const getPasswordStrength = () => {
    if (!password) return { label: "", color: "", width: "0%" };

    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;

    if (strength <= 2) return { label: "Weak", color: "bg-destructive", width: "33%" };
    if (strength <= 3) return { label: "Medium", color: "bg-[hsl(var(--stream-warning))]", width: "66%" };
    return { label: "Strong", color: "bg-[hsl(var(--stream-success))]", width: "100%" };
  };

  const passwordStrength = getPasswordStrength();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ username: true, email: true, password: true, confirmPassword: true });
    if (!isFormValid) return;

    setError("");
    setIsLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanUsername = username.trim();

      // IMPORTANT:
      // With "Confirm email" turned OFF in Supabase, this should return a session immediately.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { username: cleanUsername },
        },
      });

      if (signUpError) throw signUpError;

      const user = data.user;

      if (!user) {
        throw new Error("Signup failed: no user returned");
      }

      // Create profile row (DB permissions storage)
      // Requires profiles table + RLS insert policy allowing auth.uid() = id
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          username: cleanUsername || cleanEmail,
          role: "user",
          roles: {},
        },
        { onConflict: "id" }
      );

      // If confirm email is OFF => session exists => user is logged in
      if (data.session) {
        toast({
          title: "Registration Successful",
          description: "Your account has been created!",
        });
        navigate("/");
        return;
      }

      // If confirm email is still ON by mistake
      toast({
        title: "Registration Successful",
        description: "Please check your email to confirm your account.",
      });
      navigate("/login");
    } catch (err: any) {
      const msg = err?.message || "Failed to register";

      if (msg.toLowerCase().includes("signups not allowed") || msg.toLowerCase().includes("email signups are disabled")) {
        setError("Account creation is disabled. Please contact the administrator.");
      } else if (msg.toLowerCase().includes("already registered")) {
        setError("An account with this email already exists. Please login instead.");
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBlur = (field: keyof typeof touched) => {
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
              className="absolute left-[70px] top-1/2 -translate-y-1/2"
              style={{
                color: "#21313a",
                fontWeight: 700,
                fontSize: "14px",
                letterSpacing: "0.32em",
              }}
            >
              CREATE ACCOUNT
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="w-full bg-card rounded-2xl shadow-2xl p-8 pt-16">
          <form onSubmit={handleRegister} className="space-y-4" noValidate>
            {/* Username */}
            <div>
              <label htmlFor="username" className="sr-only">Username</label>
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
                  aria-invalid={!!usernameError}
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                />
              </div>
              {usernameError && (
                <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {usernameError}
                </p>
              )}
            </div>

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
                  autoComplete="new-password"
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

              {password && !passwordError && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Password strength</span>
                    <span
                      className={
                        passwordStrength.label === "Strong"
                          ? "text-[hsl(var(--stream-success))]"
                          : passwordStrength.label === "Medium"
                          ? "text-[hsl(var(--stream-warning))]"
                          : "text-destructive"
                      }
                    >
                      {passwordStrength.label}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrength.color} transition-all duration-300`}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                </div>
              )}

              {capsLockOn && !passwordError && (
                <p className="text-sm text-[hsl(var(--stream-warning))] mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Caps Lock is on
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="sr-only">Confirm Password</label>
              <div
                className={`flex items-center gap-3 bg-input rounded px-3 py-2.5 transition-all focus-within:ring-2 focus-within:ring-primary ${
                  confirmPasswordError ? "ring-2 ring-destructive" : ""
                }`}
              >
                <Lock className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => handleBlur("confirmPassword")}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  aria-invalid={!!confirmPasswordError}
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  disabled={isLoading}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {confirmPasswordError && (
                <p className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {confirmPasswordError}
                </p>
              )}

              {confirmPassword && !confirmPasswordError && password === confirmPassword && (
                <p className="text-sm text-[hsl(var(--stream-success))] mt-1.5 flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Passwords match
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div role="alert" className="text-sm text-destructive text-center bg-destructive/10 rounded-md py-2 px-3">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded shadow hover:bg-primary/90 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                "CREATE ACCOUNT"
              )}
            </button>

            {/* Login link */}
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                to="/login"
                className="text-primary hover:text-primary/80 transition-colors font-medium"
                tabIndex={isLoading ? -1 : 0}
              >
                Login
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Register;
