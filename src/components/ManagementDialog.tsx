import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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

type DbStreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  resolution: string | null;
  color: string | null;
  created_at?: string;
};

type ActivityLogRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  description: string | null;
  details: any | null;
};

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type LogRange = "1h" | "24h" | "all";

const isoSince = (range: LogRange) => {
  if (range === "all") return null;
  const ms = range === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const safeJson = (v: any) => {
  try {
    if (v == null) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  } catch {
    return "";
  }
};

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  // ---- tabs
  const [tab, setTab] = useState<"streams" | "password" | "logs">("streams");

  // ---- current user
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  // ---- streams
  const [streams, setStreams] = useState<DbStreamRow[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [editingStreamId, setEditingStreamId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [confirmDeleteStreamId, setConfirmDeleteStreamId] = useState<string | null>(null);

  // ---- password
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // ---- logs
  const [logRange, setLogRange] = useState<LogRange>("24h");
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchMe = useCallback(async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      setUserEmail("");
      setUserId(null);
      return;
    }
    setUserEmail(data.user?.email ?? "");
    setUserId(data.user?.id ?? null);
  }, []);

  const insertLog = useCallback(
    async (row: Partial<ActivityLogRow>) => {
      // If table/RLS is misconfigured, we silently ignore (no UI blocking)
      try {
        await supabase.from("activity_logs").insert({
          actor_user_id: userId,
          actor_email: userEmail || null,
          action: row.action ?? "unknown",
          target_type: row.target_type ?? null,
          target_id: row.target_id ?? null,
          target_name: row.target_name ?? null,
          description: row.description ?? null,
          details: row.details ?? null,
        } as any);
      } catch {
        // ignore
      }
    },
    [userEmail, userId]
  );

  const fetchStreams = useCallback(async () => {
    setLoadingStreams(true);
    try {
      const { data, error } = await supabase
        .from("streams")
        .select("id, user_id, name, url, resolution, color, created_at")
        .order("created_at", { ascending: true });

      if (error) {
        toast({
          title: "Failed to load streams",
          description: error.message,
          variant: "destructive",
        });
        setStreams([]);
        return;
      }
      setStreams((data || []) as DbStreamRow[]);
    } finally {
      setLoadingStreams(false);
    }
  }, [toast]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const since = isoSince(logRange);

      let q = supabase
        .from("activity_logs")
        .select(
          "id, created_at, actor_user_id, actor_email, action, target_type, target_id, target_name, description, details"
        )
        .order("created_at", { ascending: false })
        .limit(250);

      if (since) q = q.gte("created_at", since);

      const { data, error } = await q;

      if (error) {
        // not destructive (RLS might block)
        setLogs([]);
        return;
      }

      setLogs((data || []) as ActivityLogRow[]);
    } finally {
      setLoadingLogs(false);
    }
  }, [logRange]);

  // open dialog => load everything we need
  useEffect(() => {
    if (!isOpen) return;
    void fetchMe().then(() => {
      void fetchStreams();
      void fetchLogs();
    });
  }, [isOpen, fetchMe, fetchStreams, fetchLogs]);

  // range change => refresh logs
  useEffect(() => {
    if (!isOpen) return;
    void fetchLogs();
  }, [logRange, isOpen, fetchLogs]);

  const startEditStream = (s: DbStreamRow) => {
    setEditingStreamId(s.id);
    setEditName(s.name || "");
    setEditUrl(s.url || "");
  };

  const cancelEdit = () => {
    setEditingStreamId(null);
    setEditName("");
    setEditUrl("");
  };

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

  const saveEditStream = async () => {
    if (!editingStreamId) return;

    const name = editName.trim();
    const url = editUrl.trim();

    if (!name) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!url || !isValidStreamUrl(url)) {
      toast({
        title: "Invalid URL",
        description: "Enter a valid URL (HLS .m3u8 / HTTP / RTSP / RTMP / UDP).",
        variant: "destructive",
      });
      return;
    }

    const old = streams.find((x) => x.id === editingStreamId);

    const { error } = await supabase
      .from("streams")
      .update({ name, url })
      .eq("id", editingStreamId);

    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Stream updated" });

    await insertLog({
      action: "stream_update",
      target_type: "stream",
      target_id: editingStreamId,
      target_name: name,
      description: `Updated stream "${old?.name ?? name}"`,
      details: {
        before: { name: old?.name, url: old?.url },
        after: { name, url },
      },
    });

    setStreams((prev) =>
      prev.map((s) => (s.id === editingStreamId ? { ...s, name, url } : s))
    );
    cancelEdit();
  };

  const deleteStream = async (streamId: string) => {
    const s = streams.find((x) => x.id === streamId);
    const { error } = await supabase.from("streams").delete().eq("id", streamId);

    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Stream deleted" });

    await insertLog({
      action: "stream_delete",
      target_type: "stream",
      target_id: streamId,
      target_name: s?.name ?? null,
      description: `Deleted stream "${s?.name ?? streamId}"`,
      details: { name: s?.name, url: s?.url },
    });

    setStreams((prev) => prev.filter((x) => x.id !== streamId));
    setConfirmDeleteStreamId(null);
  };

  // ---- Password change (old/new/confirm)
  // NOTE: Supabase does NOT allow verifying old password client-side directly.
  // We verify old password by attempting signIn with current email + old password.
  const changePassword = async () => {
    const email = userEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: "Missing email", description: "Please login again.", variant: "destructive" });
      return;
    }

    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "Min 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!oldPassword) {
      toast({ title: "Old password is required", variant: "destructive" });
      return;
    }

    setSavingPassword(true);
    try {
      // verify old password
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email,
        password: oldPassword,
      });

      if (verifyErr) {
        toast({ title: "Old password is incorrect", description: verifyErr.message, variant: "destructive" });
        return;
      }

      // update to new password
      const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updErr) {
        toast({ title: "Failed to update password", description: updErr.message, variant: "destructive" });
        return;
      }

      toast({ title: "Password updated successfully" });

      await insertLog({
        action: "password_change",
        target_type: "auth",
        target_id: userId,
        target_name: userEmail,
        description: "Password changed",
        details: { via: "ManagementDialog" },
      });

      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // refresh logs tab quickly
      void fetchLogs();
    } finally {
      setSavingPassword(false);
    }
  };

  // small badge for action types
  const actionBadge = (action: string) => {
    const a = (action || "").toLowerCase();
    if (a.includes("delete")) return <Badge variant="destructive">DELETE</Badge>;
    if (a.includes("update") || a.includes("edit")) return <Badge variant="secondary">UPDATE</Badge>;
    if (a.includes("add") || a.includes("create")) return <Badge>ADD</Badge>;
    if (a.includes("load") || a.includes("import")) return <Badge variant="outline">LOAD</Badge>;
    if (a.includes("save") || a.includes("export")) return <Badge variant="outline">SAVE</Badge>;
    if (a.includes("password")) return <Badge variant="secondary">SECURITY</Badge>;
    return <Badge variant="outline">INFO</Badge>;
  };

  const logsEmptyText = useMemo(() => {
    if (loadingLogs) return "Loading…";
    return "No activity logs yet.";
  }, [loadingLogs]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[980px] max-h-[88vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-2">
          <DialogTitle>Settings & Activity</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="streams">Streams</TabsTrigger>
            <TabsTrigger value="password">Change Password</TabsTrigger>
            <TabsTrigger value="logs">Activity Logs</TabsTrigger>
          </TabsList>

          {/* ---------- Streams Tab ---------- */}
          <TabsContent value="streams" className="pt-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm text-muted-foreground">
                  Edit stream <b>Name</b> or <b>Link</b> here. Changes apply immediately.
                </div>
              </div>
              <Button variant="outline" onClick={() => void fetchStreams()} disabled={loadingStreams}>
                Refresh
              </Button>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Name</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="w-[120px]">Resolution</TableHead>
                    <TableHead className="w-[220px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {streams.map((s) => {
                    const isEditing = editingStreamId === s.id;

                    return (
                      <TableRow key={s.id}>
                        <TableCell className="align-top">
                          {isEditing ? (
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Stream name"
                            />
                          ) : (
                            <div className="font-medium">{s.name}</div>
                          )}
                        </TableCell>

                        <TableCell className="align-top">
                          {isEditing ? (
                            <Input
                              value={editUrl}
                              onChange={(e) => setEditUrl(e.target.value)}
                              placeholder="https://...m3u8"
                            />
                          ) : (
                            <div className="text-xs font-mono text-muted-foreground break-all">
                              {s.url}
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="align-top">
                          <span className="text-sm text-muted-foreground">{s.resolution ?? "—"}</span>
                        </TableCell>

                        <TableCell className="text-right align-top">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={cancelEdit}>
                                Cancel
                              </Button>
                              <Button onClick={() => void saveEditStream()}>
                                Save
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                onClick={() => startEditStream(s)}
                              >
                                Edit
                              </Button>

                              <Button
                                variant="destructive"
                                onClick={() => setConfirmDeleteStreamId(s.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {!loadingStreams && streams.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground py-6">
                        No streams found.
                      </TableCell>
                    </TableRow>
                  )}

                  {loadingStreams && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground py-6">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Delete stream confirm */}
            <AlertDialog
              open={!!confirmDeleteStreamId}
              onOpenChange={(open) => !open && setConfirmDeleteStreamId(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete stream?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the stream from the database. It cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      confirmDeleteStreamId && void deleteStream(confirmDeleteStreamId)
                    }
                  >
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* ---------- Password Tab ---------- */}
          <TabsContent value="password" className="pt-4">
            <div className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold">Change password</div>
                  <div className="text-sm text-muted-foreground">
                    Enter your old password, then your new password.
                  </div>
                  {userEmail && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Account: <span className="font-mono">{userEmail}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 mt-4 max-w-[520px]">
                <div className="grid gap-1.5">
                  <Label>Old password</Label>
                  <Input
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label>New password</Label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    autoComplete="new-password"
                  />
                </div>

                <div className="grid gap-1.5">
                  <Label>Confirm new password</Label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    autoComplete="new-password"
                  />
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <Button onClick={() => void changePassword()} disabled={savingPassword}>
                    {savingPassword ? "Saving..." : "Save password"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOldPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                    }}
                    disabled={savingPassword}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ---------- Logs Tab ---------- */}
          <TabsContent value="logs" className="pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
              <div>
                <div className="text-lg font-semibold">Activity Logs — Timeline Style (Table Format)</div>
                <div className="text-sm text-muted-foreground">
                  Latest actions done in the app (add/delete/load/save/edit/password…).
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={logRange}
                  onChange={(e) => setLogRange(e.target.value as LogRange)}
                >
                  <option value="1h">Last 1 hour</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="all">All time</option>
                </select>

                <Button variant="outline" onClick={() => void fetchLogs()} disabled={loadingLogs}>
                  Refresh
                </Button>
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Time</TableHead>
                    <TableHead className="w-[160px]">User</TableHead>
                    <TableHead className="w-[150px]">Action</TableHead>
                    <TableHead className="w-[220px]">Target</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[220px]">Details</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {fmtTime(l.created_at)}
                      </TableCell>

                      <TableCell className="align-top">
                        <div className="text-sm font-medium">
                          {l.actor_email || "Unknown"}
                        </div>
                      </TableCell>

                      <TableCell className="align-top">
                        <div className="flex items-center gap-2">
                          {actionBadge(l.action)}
                          <span className="text-xs text-muted-foreground font-mono">
                            {l.action}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="align-top">
                        <div className="text-sm">
                          <span className="text-muted-foreground">{l.target_type ?? "—"}</span>
                          {l.target_name ? (
                            <div className="font-medium">{l.target_name}</div>
                          ) : l.target_id ? (
                            <div className="text-xs font-mono text-muted-foreground break-all">
                              {l.target_id}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">—</div>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="align-top text-sm">
                        {l.description ?? "—"}
                      </TableCell>

                      <TableCell className="align-top">
                        <div className="text-xs font-mono text-muted-foreground break-all">
                          {safeJson(l.details)}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}

                  {!loadingLogs && logs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground py-6">
                        {logsEmptyText}
                      </TableCell>
                    </TableRow>
                  )}

                  {loadingLogs && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground py-6">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="text-xs text-muted-foreground mt-2">
              Tip: If logs are empty, check RLS policies on <span className="font-mono">activity_logs</span>.
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
