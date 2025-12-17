import { JwtPayload } from 'jwt-decode';
import { supabase } from './lib/supabaseClient';

export interface UserPayload extends JwtPayload {
  username: string;
  role: string;
  roles: Record<string, boolean>;
}

function clearLocalStreamCacheForUser(username?: string) {
  try {
    const key = `sm_saved_streams_v1_${username || 'anon'}`;
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Helper: decode JWT payload safely
function decodeJwtPayload(token: string): any | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

/**
 * LOGIN
 * IMPORTANT:
 * Supabase password verification happens inside Supabase Auth.
 * "username" here must be the user's email unless you implement a username->email lookup.
 */
export const login = async (username: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: username, // treat username as email
    password,
  });

  if (error) throw new Error(error.message);

  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('No session token returned');

  // Keep same behavior as your old file: store token + minimal user info
  const user = {
    username,
    // If you store role/roles in user_metadata, pull them in:
    ...(data.user?.user_metadata || {}),
  };

  sessionStorage.setItem('token', accessToken);
  try {
    sessionStorage.setItem('user', JSON.stringify(user));
  } catch {
    // ignore
  }

  clearLocalStreamCacheForUser(user.username);
};

export const logout = async () => {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  await supabase.auth.signOut();
};

export const isAuthenticated = () => {
  const token = sessionStorage.getItem('token');
  if (!token) return false;

  // naive expiry check (same idea as your original)
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 > Date.now();
};

export const getUser = (): UserPayload | null => {
  try {
    const raw = sessionStorage.getItem('user');
    if (raw) return JSON.parse(raw) as UserPayload;

    const token = sessionStorage.getItem('token');
    if (!token) return null;

    const payload = decodeJwtPayload(token);
    return payload as UserPayload;
  } catch {
    return null;
  }
};

export const getToken = (): string | null => {
  try {
    return sessionStorage.getItem('token');
  } catch {
    return null;
  }
};
