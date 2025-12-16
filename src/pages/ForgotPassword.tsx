import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Loader2, AlertTriangle, ArrowLeft, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [touched, setTouched] = useState(false);

  // Validation
  const emailError =
    touched && !email.trim()
      ? "Email is required"
      : touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "Please enter a valid email"
      : "";

  const isFormValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);

    if (!isFormValid) return;

    setError("");
    setIsLoading(true);

    try {
      const redirectUrl = `${window.location.origin}/login`;
      
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (resetError) {
        throw resetError;
      }

      setIsSuccess(true);
    } catch (err: any) {
      setError(err?.message || "Failed to send reset email");
    } finally {
      setIsLoading(false);
    }
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
              className="absolute left-[60px] top-1/2 -translate-y-1/2"
              style={{ color: "#21313a", fontWeight: 700, fontSize: "14px", letterSpacing: "0.32em" }}
            >
              PASSWORD RESET
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="w-full bg-card rounded-2xl shadow-2xl p-8 pt-16">
          {isSuccess ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 bg-[hsl(var(--stream-success))]/20 rounded-full flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-[hsl(var(--stream-success))]" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Check your email</h2>
              <p className="text-muted-foreground text-sm">
                We've sent a password reset link to <strong className="text-foreground">{email}</strong>. 
                Please check your inbox and follow the instructions.
              </p>
              <p className="text-muted-foreground text-xs">
                Didn't receive the email? Check your spam folder or{" "}
                <button
                  onClick={() => {
                    setIsSuccess(false);
                    setEmail("");
                    setTouched(false);
                  }}
                  className="text-primary hover:text-primary/80 transition-colors"
                >
                  try again
                </button>
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors text-sm font-medium mt-4"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="text-center mb-6">
                <p className="text-muted-foreground text-sm">
                  Enter your email address and we'll send you a link to reset your password.
                </p>
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
                    onBlur={() => setTouched(true)}
                    placeholder="Email address"
                    autoComplete="email"
                    aria-required="true"
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? "email-error" : undefined}
                    disabled={isLoading}
                    className="flex-1 bg-transparent text-foreground placeholder-muted-foreground outline-none disabled:opacity-50"
                  />
                </div>
                {emailError && (
                  <p id="email-error" className="text-sm text-destructive mt-1.5 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {emailError}
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
                    Sending...
                  </>
                ) : (
                  "SEND RESET LINK"
                )}
              </button>

              {/* Back to login */}
              <Link
                to="/login"
                className="flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
                tabIndex={isLoading ? -1 : 0}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;