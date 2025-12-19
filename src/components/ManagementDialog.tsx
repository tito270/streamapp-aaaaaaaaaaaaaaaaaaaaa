import React, { useEffect, useMemo, useState, useCallback } from "react";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  created_at?: string;
};

type StreamRow = {
  id: string;
  name: string;
  url: string;
  resolution: string;
  user_id: string;
};

type ProfileRow = {
  id: string;
  username: string | null;
  role: string | null;
  roles: any | null;
  created_at: string;
  updated_at: string;
};

type BitrateRow = {
  id: number;
  user_id: string;
  stream_id: string | null;
  stream_name: string;
  stream_url: string;
  bitrate_mbps: number;
  created_at: string;
};

function getInitialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  return "light";
}
function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

const isValidStreamUrl = (url: string): boolean => {
  const u = url.trim().toLowerCase();
  return (
    u.startsWith("http://") ||
    u.startsWith("https://") ||
    u.startsWith("rtmp://") ||
    u.startsWith("rtsp://") ||
    u.startsWith("udp://") ||
    u.includes(".m3u8")
  );
};

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  // ---------- Theme ----------
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  useEffect(() => applyTheme(theme), [theme]);

  // ---------- Tabs ----------
  const [tab, setTab] = useState<"settings" | "db">("settings");

  // ---------- Password ----------
  const [pw, setPw] = useState({ pass1: "", pass2: "", show: false });
  const [pwBusy, setPwBusy] = useState(false);

  // ---------- Streams ----------
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", url: "", resolution: "480p" });
  const [saveBusy, setSaveBusy] = useState(false);

  // ---------- DB Viewer ----------
  const [dbBusy, setDbBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [myProfile, setMyProfile] = useState<ProfileRow | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [bitrateLogs, setBitrateLogs] = useState<BitrateRow[]>([]);
  const [counts, setCounts] = useState<{ profiles: number; streams: number; bitrate: number } | null>(null);

  const sortedStreams = useMemo(() => {
    const arr = [...streams];
    arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return arr;
  }, [streams]);

  const fetchStreams = useCallback(async () => {
    setStreamsLoading(true);
    try {
      const { data, error } = await supabase
        .from("streams")
        .select("id, user_id, name, url, resolution, color, created_at")
        .order("created_at", { ascending: true });

      if (error) {
        toast({ title: "Error loading streams", description: error.message, variant: "destructive" });
        setStreams([]);
        return;
      }

      const mapped: StreamRow[] = (data || []).map((row: DbStreamRow) => ({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        url: row.url,
        resolution: row.resolution || "480p",
      }));

      setStreams(mapped);
    } finally {
      setStreamsLoading(false);
    }
  }, [toast]);

  const refreshDbViewer = useCallback(async () => {
    setDbBusy(true);
    try {
      // 1) session
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const user = sessionData.session?.user;
      setSessionEmail(user?.email ?? null);

      if (!user) {
        toast({ title: "Not logged in", description: "No session found.", variant: "destructive" });
        setMyProfile(null);
        setProfiles([]);
        setBitrateLogs([]);
        setCounts(null);
        return;
      }

      // 2) my profile
      const { data: myP, error: myPErr } = await supabase
        .from("profiles")
        .select("id, username, role, roles, created_at, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (myPErr) {
        toast({ title: "profiles read error", description: myPErr.message, variant: "destructive" });
        setMyProfile(null);
      } else {
        setMyProfile((myP as ProfileRow) ?? null);
      }

      // 3) all profiles (if RLS allows)
      const { data: allP, error: allPErr } = await supabase
        .from("profiles")
        .select("id, username, role, roles, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (allPErr) {
        // If RLS blocks, show friendly info
        toast({
          title: "profiles table is protected",
          description: allPErr.message,
          variant: "destructive",
        });
        setProfiles([]);
      } else {
        setProfiles((allP as ProfileRow[]) ?? []);
      }

      // 4) bitrate logs (last 200)
      const { data: br, error: brErr } = await supabase
        .from("bitrate_logs")
        .select("id, user_id, stream_id, stream_name, stream_url, bitrate_mbps, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (brErr) {
        toast({ title: "bitrate_logs read error", description: brErr.message, variant: "destructive" });
        setBitrateLogs([]);
      } else {
        setBitrateLogs((br as BitrateRow[]) ?? []);
      }

      // 5) counts (cheap approximate with head + count)
      const [pc, sc, bc] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("streams").select("id", { count: "exact", head: true }),
        supabase.from("bitrate_logs").select("id", { count: "exact", head: true }),
      ]);

      setCounts({
        profiles: pc.count ?? 0,
        streams: sc.count ?? 0,
        bitrate: bc.count ?? 0,
      });
    } catch (e: any) {
      toast({ title: "DB check failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setDbBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchStreams();
    void refreshDbViewer();
  }, [isOpen, fetchStreams, refreshDbViewer]);

  const openEdit = (s: StreamRow) => {
    setEditingId(s.id);
    setEditForm({ name: s.name || "", url: s.url || "", resolution: s.resolution || "480p" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: "", url: "", resolution: "480p" });
  };

  const saveStream = async () => {
    if (!editingId) return;
    const name = editForm.name.trim() || "Stream";
    const url = editForm.url.trim();

    if (!isValidStreamUrl(url)) {
      toast({ title: "Invalid URL", description: "Enter a valid stream URL.", variant: "destructive" });
      return;
    }

    setSaveBusy(true);
    try {
      const { error } = await supabase
        .from("streams")
        .update({ name, url, resolution: editForm.resolution })
        .eq("id", editingId);

      if (error) {
        toast({ title: "Failed to update stream", description: error.message, variant: "destructive" });
        return;
      }

      setStreams((prev) => prev.map((s) => (s.id === editingId ? { ...s, name, url, resolution: editForm.resolution } : s)));
      toast({ title: "Stream updated" });
      cancelEdit();
    } finally {
      setSaveBusy(false);
    }
  };

  const deleteStream = async (id: string) => {
    const confirmed = window.confirm("Delete this stream?");
    if (!confirmed) return;

    const { error } = await supabase.from("streams").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to delete stream", description: error.message, variant: "destructive" });
      return;
    }

    setStreams((prev) => prev.filter((s) => s.id !== id));
    toast({ title: "Stream deleted" });
  };

  const changeMyPassword = async () => {
    if (pw.pass1.length < 6) {
      toast({ title: "Password too short", description: "Min 6 characters.", variant: "destructive" });
      return;
    }
    if (pw.pass1 !== pw.pass2) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.pass1 });
      if (error) {
        toast({ title: "Failed to update password", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Password updated successfully" });
      setPw({ pass1: "", pass2: "", show: false });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[980px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-3">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Settings</DialogTitle>

            <div className="flex items-center gap-2">
              <Button variant={tab === "settings" ? "default" : "outline"} size="sm" onClick={() => setTab("settings")}>
                Settings
              </Button>
              <Button variant={tab === "db" ? "default" : "outline"} size="sm" onClick={() => setTab("db")}>
                Database
              </Button>

              <div className="ml-3 flex items-center gap-2">
                <Label htmlFor="theme-toggle" className="text-sm">Dark</Label>
                <Switch id="theme-toggle" checked={theme === "dark"} onCheckedChange={(v) => setTheme(v ? "dark" : "light")} />
              </div>
            </div>
          </div>
        </DialogHeader>

        {tab === "settings" ? (
          <div className="grid gap-6 py-2">
            {/* Change Password */}
            <div className="rounded-xl border p-4">
              <h3 className="text-lg font-semibold mb-3">Change Password</h3>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
                <Label className="sm:col-span-1">New password</Label>
                <Input
                  className="sm:col-span-3"
                  type={pw.show ? "text" : "password"}
                  value={pw.pass1}
                  onChange={(e) => setPw((s) => ({ ...s, pass1: e.target.value }))}
                  placeholder="Min 6 characters"
                  autoComplete="new-password"
                />

                <Label className="sm:col-span-1">Confirm</Label>
                <Input
                  className="sm:col-span-3"
                  type={pw.show ? "text" : "password"}
                  value={pw.pass2}
                  onChange={(e) => setPw((s) => ({ ...s, pass2: e.target.value }))}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch id="showpw" checked={pw.show} onCheckedChange={(v) => setPw((s) => ({ ...s, show: !!v }))} />
                  <Label htmlFor="showpw" className="text-sm">Show password</Label>
                </div>

                <Button onClick={() => void changeMyPassword()} disabled={pwBusy || pw.pass1.length < 6 || pw.pass1 !== pw.pass2}>
                  Update Password
                </Button>
              </div>
            </div>

            {/* Manage Streams */}
            <div className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-lg font-semibold">Manage Streams</h3>
                <Button variant="secondary" onClick={() => void fetchStreams()} disabled={streamsLoading}>
                  Refresh
                </Button>
              </div>

              {streamsLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : sortedStreams.length === 0 ? (
                <div className="text-sm text-muted-foreground">No streams found.</div>
              ) : (
                <div className="grid gap-3">
                  {sortedStreams.map((s) => {
                    const isEditing = editingId === s.id;
                    return (
                      <div key={s.id} className="rounded-lg border p-3">
                        {!isEditing ? (
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{s.name}</div>
                              <div className="text-xs text-muted-foreground font-mono truncate">{s.url}</div>
                              <div className="text-xs text-muted-foreground mt-1">Resolution: {s.resolution}</div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                              <Button variant="destructive" size="sm" onClick={() => void deleteStream(s.id)}>Delete</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
                              <Label className="sm:col-span-1">Name</Label>
                              <Input className="sm:col-span-3" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />

                              <Label className="sm:col-span-1">URL</Label>
                              <Input className="sm:col-span-3" value={editForm.url} onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))} />

                              <Label className="sm:col-span-1">Resolution</Label>
                              <div className="sm:col-span-3">
                                <Select value={editForm.resolution} onValueChange={(v) => setEditForm((f) => ({ ...f, resolution: v }))}>
                                  <SelectTrigger className="w-[160px] bg-input border-stream-border">
                                    <SelectValue placeholder="Resolution" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="480p">480p</SelectItem>
                                    <SelectItem value="720p">720p</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
                              <Button onClick={() => void saveStream()} disabled={saveBusy}>Save</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Permissions removed — all users are treated as admin in this app.
            </div>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Session: <span className="text-foreground font-medium">{sessionEmail ?? "—"}</span>
              </div>
              <Button onClick={() => void refreshDbViewer()} disabled={dbBusy}>
                {dbBusy ? "Checking..." : "Refresh DB"}
              </Button>
            </div>

            {counts && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Profiles</div>
                  <div className="text-xl font-semibold">{counts.profiles}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Streams</div>
                  <div className="text-xl font-semibold">{counts.streams}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Bitrate Logs</div>
                  <div className="text-xl font-semibold">{counts.bitrate}</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border p-4">
              <h3 className="text-lg font-semibold mb-2">My Profile Row</h3>
              {!myProfile ? (
                <div className="text-sm text-muted-foreground">No profile row found for this user.</div>
              ) : (
                <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
{JSON.stringify(myProfile, null, 2)}
                </pre>
              )}
            </div>

            <div className="rounded-xl border p-4">
              <h3 className="text-lg font-semibold mb-2">Profiles (latest 200)</h3>
              {profiles.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No rows visible (maybe RLS blocks reading all users).
                </div>
              ) : (
                <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
{JSON.stringify(profiles, null, 2)}
                </pre>
              )}
            </div>

            <div className="rounded-xl border p-4">
              <h3 className="text-lg font-semibold mb-2">Bitrate Logs (latest 200)</h3>
              {bitrateLogs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No logs found.</div>
              ) : (
                <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
{JSON.stringify(bitrateLogs, null, 2)}
                </pre>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              If “Profiles (latest 200)” is empty but My Profile works → RLS is enabled for profiles.
              You can either allow read-all, or keep it private.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
