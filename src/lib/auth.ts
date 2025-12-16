import { JwtPayload } from 'jwt-decode';

export interface UserPayload extends JwtPayload {
    username: string;
    role: string;
    roles: Record<string, boolean>;
}

const API_URL = `http://${window.location.hostname}:3001/auth`;

// Clear per-user localStorage keys when a user logs in to avoid mixing saved lists
function clearLocalStreamCacheForUser(username?: string) {
    try {
        const key = `sm_saved_streams_v1_${username || 'anon'}`;
        localStorage.removeItem(key);
    } catch (e) {
        // ignore
    }
}

export const login = async (username: string, password: string) => {
    const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData && errorData.message) || 'Failed to login');
    }

    const data = await response.json();
    const token = data.token;
    const user = data.user || { username };

    // Save token in sessionStorage (short-lived) and store minimal user info
    sessionStorage.setItem('token', token);
    try { sessionStorage.setItem('user', JSON.stringify(user)); } catch (err) { void err; }

    // Clear any per-user local cached streams so frontend will fetch server list
    clearLocalStreamCacheForUser(user.username);
};

export const logout = () => {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
};

export const isAuthenticated = () => {
    const token = sessionStorage.getItem('token');
    if (!token) return false;
    try {
        // naive expiry check: decode base64 payload
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload && payload.exp && (payload.exp * 1000 > Date.now());
    } catch (e) {
        return false;
    }
};

export const getUser = (): UserPayload | null => {
    try {
        const raw = sessionStorage.getItem('user');
        if (raw) return JSON.parse(raw) as UserPayload;
        const token = sessionStorage.getItem('token');
        if (!token) return null;
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload as UserPayload;
    } catch (e) {
        return null;
    }
};

export const getToken = (): string | null => {
    try { return sessionStorage.getItem('token'); } catch { return null; }
};
