import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type DbStreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  resolution: string | null;
  color: string | null;
};

type DbActivityLog = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_name: string | null;
  description: string | null;
  // ✅ details intentionally NOT included / NOT shown
};

const formatDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    // yyyy-mm-dd hh:mm:ss
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  } catch {
    return iso;
  }
};

const actionLabel = (a: string) => {
  const x = (a || "").toLowerCase();
  if (x === "add_stream") return "Add Stream";
  if (x === "delete_stream") return "Delete Stream";
  if (x === "edit_stream") return "Edit Stream";
  if (x === "save_list") return "Save List";
  if (x === "load_list") return "Load List";
  if (x === "change_password") return "Change Password";
  if (x === "login") return "Login";
  if (x === "logout") return "Logout";
  return a;
};

const safeTrim = (v: string) => v.trim().replace(/\s+/g, " ");

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  // --- Streams (edit) ---
  const [streams, setStreams] = useState<DbStreamRow[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [editingStreamId, setEditingStreamId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");

  const [confirmDeleteStreamId, setConfirmDeleteStreamId] = useState<string | null>(null);

  // --- Change password (current user) ---
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  // --- Activity logs (timeline table) ---
  const [logs, setLogs] = useState<DbActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLimit, setLogsLimit] = useState(200);

  const canSavePw = useMemo(() => {
    if (!pwOld || !pwNew || !pwConfirm) return false;
    if (pwNew.length < 6) return false;
    if (pwNew !== pwConfirm) return false;
    return true;
  }, [pwOld, pwNew, pwConfirm]);

  const isValidStreamUrl = (url: string) => {
    const u = url.trim().toLowerCase();
    return (
      u.startsWith("http://") ||
      u.startsWith("https://") ||
      u.includes(".m3u8") ||
      u.startsWith("rtmp://") ||
      u.startsWith("rtsp://") ||
      u.startsWith("udp://")
    );
  };

  const getActorEmail = async (): Promise<string> => {
    // Prefer auth user email (most reliable)
    const { data, error } = await supabase.auth.getUser();
    if (!error) return data.user?.email ?? "unknown";
    return "unknown";
  };

  const insertActivity = useCallback(
    async (action: string, target_type: string | null, target_name: string | null, description: string | null) => {
      try {
        const actor_email = await getActorEmail();
        await supabase.from("activity_logs").insert({
          actor_email,
          action,
          target_type,
          target_name,
          description,
        });
      } catch (e) {
        // non-blocking
        console.warn("activity_logs insert failed:", e);
      }
    },
    []
  );

  const fetchStreams = useCallback(async () => {
    setStreamsLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) {
        setStreams([]);
        return;
      }

      const { data, error } = await supabase
        .from("streams")
        .select("id, user_id, name, url, resolution, color")
        .order("created_at", { ascending: true });

      if (error) {
        toast({ title: "Failed to load streams", description: error.message, variant: "destructive" });
        setStreams([]);
        return;
      }

      setStreams((data || []) as DbStreamRow[]);
    } finally {
      setStreamsLoading(false);
    }
  }, [toast]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from("activity_logs")
        // ✅ details intentionally NOT selected
        .select("id, created_at, actor_email, action, target_type, target_name, description")
        .order("created_at", { ascending: false })
        .limit(logsLimit);

      if (error) {
        toast({ title: "Failed to load activity logs", description: error.message, variant: "destructive" });
        setLogs([]);
        return;
      }

      setLogs((data || []) as DbActivityLog[]);
    } finally {
      setLogsLoading(false);
    }
  }, [logsLimit, toast]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchStreams();
    void fetchLogs();

    // reset state each open (optional)
    setEditingStreamId(null);
    setConfirmDeleteStreamId(null);
    setPwOld("");
    setPwNew("");
    setPwConfirm("");
  }, [isOpen, fetchStreams, fetchLogs]);

  const beginEditStream = (s: DbStreamRow) => {
    setEditingStreamId(s.id);
    setEditName(s.name ?? "");
    setEditUrl(s.url ?? "");
  };

  const cancelEditStream = () => {
    setEditingStreamId(null);
    setEditName("");
    setEditUrl("");
  };

  const saveStreamEdit = async () => {
    const streamId = editingStreamId;
    if (!streamId) return;

    const name = safeTrim(editName);
    const url = safeTrim(editUrl);

    if (!name) {
      toast({ title: "Invalid name", description: "Stream name is required.", variant: "destructive" });
      return;
    }
    if (!url || !isValidStreamUrl(url)) {
      toast({
        title: "Invalid URL",
        description: "Enter a valid stream URL (HLS .m3u8 / HTTP / RTSP / RTMP / UDP).",
        variant: "destructive",
      });
      return;
    }

    const existing = streams.find((x) => x.id === streamId);
    const before = existing ? `${existing.name} — ${existing.url}` : "stream";

    const { error } = await supabase
      .from("streams")
      .update({ name, url })
      .eq("id", streamId);

    if (error) {
      toast({ title: "Failed to update stream", description: error.message, variant: "destructive" });
      return;
    }

    await insertActivity(
      "edit_stream",
      "stream",
      name,
      `Updated stream: ${before} -> ${name} — ${url}`
    );

    toast({ title: "Stream updated" });
    cancelEditStream();
    await fetchStreams();
    await fetchLogs();
  };

  const deleteStream = async (streamId: string) => {
    const target = streams.find((s) => s.id === streamId);
    const targetName = target?.name ?? "stream";

    const { error } = await supabase.from("streams").delete().eq("id", streamId);

    if (error) {
      toast({ title: "Failed to delete stream", description: error.message, variant: "destructive" });
      return;
    }

    await insertActivity("delete_stream", "stream", targetName, `Deleted stream: ${targetName}`);
    toast({ title: "Stream deleted" });

    setConfirmDeleteStreamId(null);
    await fetchStreams();
    await fetchLogs();
  };

  /**
   * ✅ Change password with old password verification:
   * Supabase requires re-auth to validate the old password.
   * We sign in with current email + old password, then update password.
   */
  const handleChangePassword = async () => {
    if (!canSavePw) return;

    setPwLoading(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) {
        toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
        return;
      }

      const email = userRes.user.email;
      if (!email) {
        toast({ title: "Missing email", description: "Your user has no email.", variant: "destructive" });
        return;
      }

      // Re-auth by signing in with old password (validates it)
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email,
        password: pwOld,
      });

      if (signInErr) {
        toast({ title: "Old password incorrect", description: signInErr.message, variant: "destructive" });
        return;
      }

      // Update password
      const { error: updErr } = await supabase.auth.updateUser({ password: pwNew });
      if (updErr) {
        toast({ title: "Failed to change password", description: updErr.message, variant: "destructive" });
        return;
      }

      await insertActivity("change_password", "user", email, "User changed password");

      toast({ title: "Password updated" });
      setPwOld("");
      setPwNew("");
      setPwConfirm("");
      await fetchLogs();
    } finally {
      setPwLoading(false);
    }
  };

  const logsRangeLabel = useMemo(() => {
    return logsLimit === 50 ? "Last 50" : logsLimit === 200 ? "Last 200" : "Last 500";
  }, [logsLimit]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[980px] max-h-[88vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-2">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Settings</DialogTitle>

            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Logs:</Label>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={String(logsLimit)}
                onChange={(e) => setLogsLimit(Number(e.target.value) as any)}
              >
                <option value="50">Last 50</option>
                <option value="200">Last 200</option>
                <option value="500">Last 500</option>
              </select>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void fetchStreams();
                  void fetchLogs();
                }}
              >
                Refresh
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          {/* ✅ Change Password */}
          <section className="rounded-xl border p-4">
            <h3 className="text-lg font-semibold mb-3">Change Password</h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="pw-old">Old password</Label>
                <Input
                  id="pw-old"
                  type="password"
                  value={pwOld}
                  onChange={(e) => setPwOld(e.target.value)}
                  placeholder="Old password"
                  autoComplete="current-password"
                />
              </div>

              <div>
                <Label htmlFor="pw-new">New password</Label>
                <Input
                  id="pw-new"
                  type="password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  placeholder="New password (min 6)"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <Label htmlFor="pw-confirm">Confirm</Label>
                <Input
                  id="pw-confirm"
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="Confirm new password"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button onClick={() => void handleChangePassword()} disabled={!canSavePw || pwLoading}>
                {pwLoading ? "Saving..." : "Save Password"}
              </Button>
              {!canSavePw && (
                <span className="text-xs text-muted-foreground">
                  New password must match and be at least 6 characters.
                </span>
              )}
            </div>
          </section>

          {/* ✅ Streams (edit name/url) */}
          <section className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Edit Streams</h3>
              {streamsLoading && <span className="text-sm text-muted-foreground">Loading…</span>}
            </div>

            <div className="mt-3 space-y-3">
              {streams.length === 0 ? (
                <div className="text-sm text-muted-foreground">No streams found.</div>
              ) : (
                streams.map((s) => {
                  const isEditing = editingStreamId === s.id;

                  return (
                    <div key={s.id} className="rounded-lg border p-3">
                      {!isEditing ? (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{s.name}</div>
                            <div className="text-xs text-muted-foreground font-mono truncate">{s.url}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => beginEditStream(s)}>
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setConfirmDeleteStreamId(s.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <Label>Name</Label>
                              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                            </div>
                            <div>
                              <Label>URL</Label>
                              <Input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} />
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button onClick={() => void saveStreamEdit()}>Save</Button>
                            <Button variant="outline" onClick={cancelEditStream}>
                              Cancel
                            </Button>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            Tip: For best results in Lovable without backend, use HLS (.m3u8) streams.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* ✅ Activity Logs (Timeline Style - Table) */}
          <section className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Activity Logs</h3>
                <p className="text-xs text-muted-foreground">Timeline style (Table Format) — {logsRangeLabel}</p>
              </div>

              <div className="flex items-center gap-2">
                {logsLoading && <span className="text-sm text-muted-foreground">Loading…</span>}
                <Button variant="outline" size="sm" onClick={() => void fetchLogs()}>
                  Refresh Logs
                </Button>
              </div>
            </div>

            <div className="mt-3 rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[190px]">Time</TableHead>
                    <TableHead className="w-[220px]">User</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead className="w-[220px]">Target</TableHead>
                    <TableHead>Description</TableHead>
                    {/* ✅ Details column removed */}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                        No activity logs yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs font-mono">{formatDateTime(l.created_at)}</TableCell>
                        <TableCell className="text-sm">{l.actor_email || "unknown"}</TableCell>
                        <TableCell className="text-sm font-semibold">{actionLabel(l.action)}</TableCell>
                        <TableCell className="text-sm">
                          {(l.target_type || "—") + (l.target_name ? ` — ${l.target_name}` : "")}
                        </TableCell>
                        <TableCell className="text-sm">{l.description || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>

        {/* Delete stream confirmation */}
        <AlertDialog
          open={!!confirmDeleteStreamId}
          onOpenChange={(open) => !open && setConfirmDeleteStreamId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete stream?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The stream will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDeleteStreamId && void deleteStream(confirmDeleteStreamId)}
              >
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
