import { supabase } from "@/integrations/supabase/client";

export type UserPayload = {
  id: string;
  email: string;
  username: string;
  role: string;
  roles: Record<string, boolean>;
};

const SESSION_USER_KEY = "user";

/**
 * Clear per-user localStorage keys when a user logs in to avoid mixing saved lists
 */
function clearLocalStreamCacheForUser(usernameOrEmail?: string) {
  try {
    const key = `sm_saved_streams_v1_${usernameOrEmail || "anon"}`;
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Fetch user profile (role + roles) from DB.
 * You need a "profiles" table with:
 *  - id uuid primary key references auth.users(id)
 *  - username text
 *  - role text
 *  - roles jsonb
 */
async function fetchProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, role, roles")
    .eq("id", userId)
    .maybeSingle();

  // If table doesn't exist or RLS blocks, we fallback to defaults
  if (error || !data) {
    return {
      username: "user",
      role: "user",
      roles: {} as Record<string, boolean>,
    };
  }

  return {
    username: (data as any).username || "user",
    role: (data as any).role || "user",
    roles: ((data as any).roles || {}) as Record<string, boolean>,
  };
}

export const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;

  const session = data.session;
  const user = data.user;

  if (!session || !user) throw new Error("Login failed: no session returned");

  // Pull roles from profiles table (or fallback)
  const profile = await fetchProfile(user.id);

  const payload: UserPayload = {
    id: user.id,
    email: user.email || email,
    username: profile.username || user.email || email,
    role: profile.role || "user",
    roles: profile.roles || {},
  };

  // Keep compatibility with your existing code
  sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(payload));

  // Optional: clear per-user cached streams
  clearLocalStreamCacheForUser(payload.username || payload.email);

  return payload;
};

export const logout = async () => {
  try {
    await supabase.auth.signOut();
  } finally {
    sessionStorage.removeItem(SESSION_USER_KEY);
  }
};

/**
 * Returns true if Supabase session exists (and access token is valid/refreshable).
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
};

/**
 * Returns cached user payload (fast) OR builds it from Supabase user + profiles.
 */
export const getUser = async (): Promise<UserPayload | null> => {
  try {
    const raw = sessionStorage.getItem(SESSION_USER_KEY);
    if (raw) return JSON.parse(raw) as UserPayload;
  } catch {
    // ignore
  }

  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;

  const profile = await fetchProfile(u.id);

  const payload: UserPayload = {
    id: u.id,
    email: u.email || "",
    username: profile.username || u.email || "user",
    role: profile.role || "user",
    roles: profile.roles || {},
  };

  try {
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }

  return payload;
};

/**
 * Return Supabase access token for your backend API (Authorization: Bearer ...)
 */
export const getToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};
