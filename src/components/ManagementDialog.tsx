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

type ActivityLogRow = {
  id: string;
  created_at: string;
  action: string; // e.g. add_stream, update_stream, delete_stream, password_change, load_list, save_list, login, logout
  target_type: string; // e.g. stream, account, list
  target_name: string | null; // e.g. "CCTV Entrance"
  description: string | null; // short message
  details: any | null; // jsonb
  actor_user_id: string | null;
  actor_email: string | null;
};

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// ---------- helpers ----------
const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
};

const actionMeta = (action: string) => {
  const a = (action || "").toLowerCase();

  // ICON + LABEL + “dot” color (Tailwind)
  if (a === "add_stream")
    return { icon: "🟢", label: "Stream Added", dot: "bg-green-500" };
  if (a === "update_stream")
    return { icon: "🟡", label: "Stream Updated", dot: "bg-yellow-500" };
  if (a === "delete_stream")
    return { icon: "🔴", label: "Stream Deleted", dot: "bg-red-500" };
  if (a === "password_change")
    return { icon: "🔐", label: "Password Changed", dot: "bg-purple-500" };
  if (a === "load_list")
    return { icon: "📂", label: "List Loaded", dot: "bg-blue-500" };
  if (a === "save_list")
    return { icon: "💾", label: "List Saved", dot: "bg-cyan-500" };
  if (a === "login")
    return { icon: "🔑", label: "Login", dot: "bg-zinc-400" };
  if (a === "logout")
    return { icon: "🚪", label: "Logout", dot: "bg-zinc-400" };

  return { icon: "📝", label: action || "Activity", dot: "bg-zinc-400" };
};

const prettyTarget = (row: ActivityLogRow) => {
  if (row.target_name) return row.target_name;
  const t = (row.target_type || "").toLowerCase();
  if (t === "account") return "Account";
  if (t === "stream") return "Stream";
  if (t === "list") return "List";
  return "—";
};

const prettyDesc = (row: ActivityLogRow) => {
  if (row.description) return row.description;
  // fallback from action
  const a = (row.action || "").toLowerCase();
  if (a === "add_stream") return "Stream URL added";
  if (a === "update_stream") return "Stream updated";
  if (a === "delete_stream") return "Stream removed";
  if (a === "password_change") return "Security update";
  if (a === "load_list") return "Streams imported";
  if (a === "save_list") return "Saved locally";
  return "—";
};

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  // Password change form (current user)
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // Logs
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [filter, setFilter] = useState<"1h" | "24h" | "all">("24h");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sinceIso = useMemo(() => {
    if (filter === "all") return null;
    const ms = filter === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
  }, [filter]);

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      let q = supabase
        .from("activity_logs")
        .select(
          "id, created_at, action, target_type, target_name, description, details, actor_user_id, actor_email"
        )
        .order("created_at", { ascending: false })
        .limit(300);

      if (sinceIso) q = q.gte("created_at", sinceIso);

      const { data, error } = await q;

      if (error) {
        toast({
          title: "Error loading logs",
          description: error.message,
          variant: "destructive",
        });
        setLogs([]);
        return;
      }

      setLogs((data || []) as ActivityLogRow[]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, filter]);

  const logTableRows = useMemo(() => {
    return logs.map((r) => ({
      ...r,
      meta: actionMeta(r.action),
    }));
  }, [logs]);

  // Change password: verify old password by re-auth then update
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!oldPassword || !newPassword || !confirmNewPassword) {
      toast({
        title: "Missing fields",
        description: "Fill old password + new password + confirm.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Minimum 6 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({
        title: "Passwords do not match",
        description: "Confirm password must match the new password.",
        variant: "destructive",
      });
      return;
    }

    setPwLoading(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const email = userRes.user?.email;
      if (!email) {
        toast({
          title: "Not logged in",
          description: "Please login again.",
          variant: "destructive",
        });
        return;
      }

      // re-authenticate with old password
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPassword,
      });
      if (signInErr) {
        toast({
          title: "Old password incorrect",
          description: "Please check your old password.",
          variant: "destructive",
        });
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updErr) throw updErr;

      // Log action in DB (requires activity_logs table + insert policy)
      const { data: u2 } = await supabase.auth.getUser();
      const uid = u2.user?.id ?? null;
      const uemail = u2.user?.email ?? null;

      await supabase.from("activity_logs").insert({
        action: "password_change",
        target_type: "account",
        target_name: "Account",
        description: "Password changed",
        actor_user_id: uid,
        actor_email: uemail,
        details: { method: "self-service" },
      });

      toast({ title: "Password updated" });

      setOldPassword("");
      setNewPassword("");
      setConfirmNewPassword("");

      // refresh logs
      void fetchLogs();
    } catch (err: any) {
      toast({
        title: "Failed to update password",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[920px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-2">
          <DialogTitle>Management</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          {/* ---------------- Change Password (self) ---------------- */}
          <form
            onSubmit={handleChangePassword}
            className="rounded-xl border p-4"
          >
            <h3 className="text-lg font-semibold mb-3">Change Password</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
              <div className="space-y-2">
                <Label htmlFor="old-pwd">Old password</Label>
                <Input
                  id="old-pwd"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={pwLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-pwd">New password</Label>
                <Input
                  id="new-pwd"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={pwLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-pwd">Confirm new password</Label>
                <Input
                  id="confirm-pwd"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={pwLoading}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button type="submit" disabled={pwLoading}>
                {pwLoading ? "Updating..." : "Update Password"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Tip: you will stay logged in after changing your password.
              </span>
            </div>
          </form>

          {/* ---------------- Activity Logs ---------------- */}
          <div className="rounded-xl border p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">Activity Logs</h3>

              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Range:</Label>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                >
                  <option value="1h">Last 1 hour</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="all">All</option>
                </select>

                <Button variant="outline" onClick={() => void fetchLogs()} disabled={logsLoading}>
                  Refresh
                </Button>
              </div>
            </div>

            {/* Timeline-style table */}
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 text-left w-[44px]"> </th>
                    <th className="py-2 pr-3 text-left min-w-[180px]">Action</th>
                    <th className="py-2 pr-3 text-left min-w-[160px]">Target</th>
                    <th className="py-2 pr-3 text-left">Description</th>
                    <th className="py-2 text-left min-w-[180px]">Date &amp; Time</th>
                  </tr>
                </thead>

                <tbody>
                  {logTableRows.map((row) => {
                    const isExpanded = expandedId === row.id;
                    const target = prettyTarget(row);
                    const desc = prettyDesc(row);
                    const dt = fmtDateTime(row.created_at);

                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className="border-b hover:bg-muted/40 transition-colors cursor-pointer"
                          onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                          title="Click to expand details"
                        >
                          <td className="py-3 pr-3 align-top">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{row.meta.icon}</span>
                              <span className={`inline-block h-2 w-2 rounded-full ${row.meta.dot}`} />
                            </div>
                          </td>

                          <td className="py-3 pr-3 align-top">
                            <div className="font-semibold text-foreground">{row.meta.label}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.actor_email ? `by ${row.actor_email}` : ""}
                            </div>
                          </td>

                          <td className="py-3 pr-3 align-top">
                            <div className="font-medium">{target}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.target_type ? row.target_type : ""}
                            </div>
                          </td>

                          <td className="py-3 pr-3 align-top text-muted-foreground">
                            {desc}
                          </td>

                          <td className="py-3 align-top text-muted-foreground">
                            {dt}
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="border-b bg-muted/20">
                            <td />
                            <td colSpan={4} className="py-3 pr-3">
                              <div className="text-xs text-muted-foreground mb-2">
                                Details (JSON)
                              </div>
                              <pre className="text-xs bg-background border rounded-md p-3 overflow-x-auto">
                                {JSON.stringify(row.details ?? {}, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {!logsLoading && logTableRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No activity logs found for this range.
                      </td>
                    </tr>
                  )}

                  {logsLoading && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        Loading logs…
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              Tip: click a row to expand technical details.
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
