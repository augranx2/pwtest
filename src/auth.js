import { useState, useEffect, useCallback } from "react";
import { login as apiLogin, logout as apiLogout, whoami as apiWhoami } from "./api";

const STORAGE_KEY = "spa_dashboard_session";

const ROLE_LEVEL = { Staff: 1, Supervisor: 2, Manager: 3, "Assistant Manager": 3, Administrator: 4 };

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStored(session) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage tidak tersedia (mode privat dsb) — abaikan, sesi hanya bertahan di memori
  }
}

export function useAuth() {
  const [session, setSession] = useState(null); // { token, username, nama, role, departemen }
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const stored = readStored();
      if (!stored || !stored.token) {
        setChecking(false);
        return;
      }
      try {
        const res = await apiWhoami(stored.token);
        if (cancelled) return;
        if (res.ok) {
          setSession({ ...stored, ...res });
        } else {
          writeStored(null);
        }
      } catch {
        if (!cancelled) writeStored(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }
    restore();
    return () => { cancelled = true; };
  }, []);

  const doLogin = useCallback(async (username, password) => {
    setError("");
    const res = await apiLogin(username, password);
    const next = {
      token: res.token,
      username: res.username,
      nama: res.nama,
      role: res.role,
      departemen: res.departemen,
    };
    setSession(next);
    writeStored(next);
    return next;
  }, []);

  const doLogout = useCallback(async () => {
    if (session?.token) apiLogout(session.token);
    setSession(null);
    writeStored(null);
  }, [session]);

  return { session, checking, error, login: doLogin, logout: doLogout };
}

export function roleLevel(role) {
  return ROLE_LEVEL[role] || 0;
}

export function hasAccess(session, minRole, departemen) {
  if (!session) return false;
  if (session.role === "Administrator") return true; // akses penuh, lintas departemen
  if (departemen && session.departemen !== departemen) return false;
  return roleLevel(session.role) >= roleLevel(minRole);
}
