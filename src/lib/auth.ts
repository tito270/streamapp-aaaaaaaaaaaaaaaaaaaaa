import { supabase } from "@/integrations/supabase/client";

export interface UserPayload {
  id: string;
  email: string;
  username?: string;
  role?: string;
  roles?: Record<string, boolean>;
}

/**
 * Clear per-user cached streams on login
 */
function clearLocalStreamCacheForUser(username?: string) {
  try {
    const key = `sm_saved_streams_v1_${username || "anon"}`;
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  if (data.user) {
    // ensure profile exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile) {
      await supabase.from("profiles").insert({
        id: data.user.id,
        email: data.user.email,
        role: "user",
        roles: {},
      });
    }

    clearLocalStreamCacheForUser(data.user.email || undefined);
  }

  return data;
};

export const logout = async () => {
  await supabase.auth.signOut();
};

export const getUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
};

export const getSession = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
};

export const isAuthenticated = async () => {
  const session = await getSession();
  return !!session;
};
