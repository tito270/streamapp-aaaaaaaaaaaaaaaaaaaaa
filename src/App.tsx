import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ProtectedRoute from "./lib/ProtectedRoute";

import { supabase } from "@/integrations/supabase/client";

const queryClient = new QueryClient();

/**
 * Handles Supabase auth redirects (signup / reset password / magic link)
 */
const SupabaseAuthHandler = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Process access_token from URL hash if present
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        // If user just confirmed email or logged in via link
        navigate("/", { replace: true });
      }
    });

    // Clean URL after auth redirect
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session && window.location.hash.includes("access_token")) {
          window.history.replaceState(
            null,
            "",
            window.location.pathname
          );
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* 🔑 Important: this MUST be inside BrowserRouter */}
        <SupabaseAuthHandler />

        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Index />} />
          </Route>

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
