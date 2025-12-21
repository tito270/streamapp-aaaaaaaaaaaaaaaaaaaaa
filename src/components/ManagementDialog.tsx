import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type StreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  resolution: string | null;
  color: string | null;
  created_at?: string;
};

type AuditLogRow = {
  id: string;
  created_at: string;
  user_id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: any;
};

type LogRange = "1h" | "24h" | "all";

const isoSince = (range: LogRange) => {
  const now = Date.now();
  if (range === "1h") return new Date(now - 60 * 60 * 1000).toISOString();
  if (range === "24h") return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  return null;
};

const fmt = (d: string) => {
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
};

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);

  // ---- Password form ----
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ---- Streams edit ----
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [editMap, setEditMap] = useState<Record<string, { name: string; url: string }>>({});

  // ---- Logs ----
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [logRange, setLogRange] = useState<LogRange>("24h");

  const resetForms = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const logAction = async (action: string, entity_type?: string, entity_id?: string, details?: any) => {
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) return;

    const { error } = await supabase.from("audit_logs").insert({
      user_id: user.id,
      action,
      entity_type: entity_type ?? null,
      entity_id: entity_id ?? null,
      details: details ?? null,
    });

    if (error) {
      // Don’t block UX if logging fails
      console.warn("audit_logs insert failed:", error.message);
    }
  };

  const fetchStreams = async () => {
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) {
      setStreams([]);
      return;
    }

    const { data, error } = await supabase
      .from("streams")
      .select("id,user_id,name,url,resolution,color,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Failed to load streams", description: error.message, variant: "destructive" });
      setStreams([]);
      return;
    }

    const rows = (data || []) as StreamRow[];
    setStreams(rows);

    // init editMap
    const next: Record<string, { name: string; url: string }> = {};
    rows.forEach((s) => (next[s.id] = { name: s.name, url: s.url }));
    setEditMap(next);
  };

  const fetchLogs = async (range: LogRange) => {
    const { data: u } = await supabase.auth.getUser();
    const user = u.user;
    if (!user) {
      setLogs([]);
      return;
    }

    let q = supabase
      .from("audit_logs")
      .select("id,created_at,user_id,action,entity_type,entity_id,details")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300);

    const since = isoSince(range);
    if (since) q = q.gte("created_at", since);

    const { data, error } = await q;
    if (error) {
      toast({ title: "Failed to load logs", description: error.message, variant: "destructive" });
      setLogs([]);
      return;
    }

    setLogs((data || []) as AuditLogRow[]);
  };

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    (async () => {
      try {
        await fetchStreams();
        await fetchLogs(logRange);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchLogs(logRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logRange, isOpen]);

  // ---- Password Change ----
  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      toast({ title: "Missing fields", description: "Fill old/new/confirm password.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Weak password", description: "New password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Mismatch", description: "New password and confirm password do not match.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: u, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const email = u.user?.email;
      if (!email) {
        toast({ title: "Missing email", description: "Cannot re-authenticate without email.", variant: "destructive" });
        return;
      }

      // Re-auth with old password
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPassword,
      });

      if (signInErr) {
        toast({ title: "Old password incorrect", description: signInErr.message, variant: "destructive" });
        return;
      }

      // Update password
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) {
        toast({ title: "Failed to update password", description: updErr.message, variant: "destructive" });
        return;
      }

      await logAction("password_change", "user", u.user?.id, { via: "settings_dialog" });

      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      resetForms();
      await fetchLogs(logRange);
    } catch (e: any) {
      toast({
        title: "Error",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // ---- Stream Update ----
  const handleSaveStream = async (streamId: string) => {
    const draft = editMap[streamId];
    if (!draft) return;

    const name = (draft.name || "").trim();
    const url = (draft.url || "").trim();

    if (!name) {
      toast({ title: "Invalid name", description: "Stream name is required.", variant: "destructive" });
      return;
    }
    if (!url || !(url.startsWith("http://") || url.startsWith("https://") || url.includes(".m3u8"))) {
      toast({
        title: "Invalid URL",
        description: "Use a valid HLS URL (.m3u8) or http(s) URL.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const current = streams.find((s) => s.id === streamId);
      if (!current) return;

      const { error } = await supabase
        .from("streams")
        .update({ name, url })
        .eq("id", streamId);

      if (error) {
        toast({ title: "Failed to update stream", description: error.message, variant: "destructive" });
        return;
      }

      await logAction("update_stream", "stream", streamId, {
        before: { name: current.name, url: current.url },
        after: { name, url },
      });

      toast({ title: "Stream updated" });
      await fetchStreams();
      await fetchLogs(logRange);
    } finally {
      setLoading(false);
    }
  };

  const logSummary = useMemo(() => {
    if (!logs.length) return "No logs yet.";
    const latest = logs[0];
    return `Last action: ${latest.action} (${fmt(latest.created_at)})`;
  }, [logs]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-2">
          <DialogTitle>Settings</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">{logSummary}</p>
        </DialogHeader>

        {/* PASSWORD */}
        <div className="border rounded-xl p-4 space-y-3">
          <h3 className="text-lg font-semibold">Change Password</h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Old password</Label>
              <Input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <Label>New password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <Label>Confirm new password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleChangePassword} disabled={loading}>
              Save Password
            </Button>
            <Button variant="outline" onClick={resetForms} disabled={loading}>
              Clear
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Note: Passwords are not stored in your database. We only log the action “password_change”.
          </p>
        </div>

        {/* STREAM EDIT */}
        <div className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Edit Streams</h3>
            <Button variant="outline" onClick={() => void fetchStreams()} disabled={loading}>
              Refresh
            </Button>
          </div>

          {streams.length === 0 ? (
            <div className="text-sm text-muted-foreground">No streams found.</div>
          ) : (
            <div className="space-y-3">
              {streams.map((s) => (
                <div key={s.id} className="rounded-lg border p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={editMap[s.id]?.name ?? s.name}
                        onChange={(e) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [s.id]: { ...(prev[s.id] || { name: s.name, url: s.url }), name: e.target.value },
                          }))
                        }
                        disabled={loading}
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <Label className="text-xs">URL</Label>
                      <Input
                        value={editMap[s.id]?.url ?? s.url}
                        onChange={(e) =>
                          setEditMap((prev) => ({
                            ...prev,
                            [s.id]: { ...(prev[s.id] || { name: s.name, url: s.url }), url: e.target.value },
                          }))
                        }
                        disabled={loading}
                      />
                    </div>

                    <div className="sm:col-span-1 flex sm:justify-end gap-2 pt-6 sm:pt-0">
                      <Button
                        onClick={() => void handleSaveStream(s.id)}
                        disabled={loading}
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground mt-2">
                    ID: <span className="font-mono">{s.id}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* LOGS */}
        <div className="border rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-lg font-semibold">Activity Logs</h3>

            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Range:</Label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={logRange}
                onChange={(e) => setLogRange(e.target.value as LogRange)}
                disabled={loading}
              >
                <option value="1h">Last 1 hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="all">All</option>
              </select>

              <Button variant="outline" onClick={() => void fetchLogs(logRange)} disabled={loading}>
                Refresh
              </Button>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No logs found.</div>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="font-semibold">{l.action}</div>
                    <div className="text-xs text-muted-foreground">{fmt(l.created_at)}</div>
                  </div>

                  <div className="text-xs text-muted-foreground mt-1">
                    {l.entity_type ? (
                      <>
                        Entity: <span className="font-mono">{l.entity_type}</span>
                        {l.entity_id ? <> / <span className="font-mono">{l.entity_id}</span></> : null}
                      </>
                    ) : (
                      <>Entity: <span className="font-mono">—</span></>
                    )}
                  </div>

                  {l.details ? (
                    <pre className="mt-2 text-xs bg-muted/30 border rounded-md p-2 overflow-x-auto">
{JSON.stringify(l.details, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
