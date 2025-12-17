import { JwtPayload } from "jwt-decode";
import { supabase } from "./supabaseClient";

/**
 * Payload shape your app expects
 */
export interface UserPayload extends JwtPayload {
  username: string;
  role: string;
  roles: Record<string, boolean>;
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

/**
 * Decode JWT payload safely
 */
function decodeJwt(token: string): any | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

/**
 * LOGIN
 * Supabase validates password against DB (secure)
 * username == email
 */
export const login = async (username: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: username.trim().toLowerCase(),
    password,
  });

  if (error) throw new Error(error.message);

  const session = data.session;
  if (!session?.access_token) {
    throw new Error("Login failed: no session returned");
  }

  const accessToken = session.access_token;

  // Fetch profile from DB (role + permissions)
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, role, roles")
    .eq("id", data.user.id)
    .maybeSingle();

  const user = {
    username:
      profile?.username ||
      data.user.email ||
      username,
    role: profile?.role || "user",
    roles: (profile?.roles || {}) as Record<string, boolean>,
  };

  // Store session token (short-lived)
  sessionStorage.setItem("token", accessToken);
  sessionStorage.setItem("user", JSON.stringify(user));

  clearLocalStreamCacheForUser(user.username);
};

/**
 * LOGOUT
 */
export const logout = async () => {
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore
  }
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
};

/**
 * AUTH CHECK
 */
export const isAuthenticated = (): boolean => {
  const token = sessionStorage.getItem("token");
  if (!token) return false;

  const payload = decodeJwt(token);
  if (!payload?.exp) return false;

  return payload.exp * 1000 > Date.now();
};

/**
 * GET USER (DB-backed, fallback to token)
 */
export const getUser = (): UserPayload | null => {
  try {
    const raw = sessionStorage.getItem("user");
    if (raw) return JSON.parse(raw) as UserPayload;

    const token = sessionStorage.getItem("token");
    if (!token) return null;

    const payload = decodeJwt(token);
    if (!payload) return null;

    return {
      username: payload.email || payload.username || "user",
      role: payload.role || "user",
      roles: payload.roles || {},
    } as UserPayload;
  } catch {
    return null;
  }
};

/**
 * GET ACCESS TOKEN
 */
export const getToken = (): string | null => {
  try {
    return sessionStorage.getItem("token");
  } catch {
    return null;
  }
};
