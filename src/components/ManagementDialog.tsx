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
};

type StreamRow = {
  id: string;
  name: string;
  url: string;
  resolution: string;
  user_id: string;
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

  // ---------- Password ----------
  const [pw, setPw] = useState({ pass1: "", pass2: "", show: false });
  const [pwBusy, setPwBusy] = useState(false);

  // ---------- Streams ----------
  const [streams, setStreams] = useState<StreamRow[]>([]);
  const [streamsLoading, setStreamsLoading] = useState(false);

  // editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    url: "",
    resolution: "480p",
  });
  const [saveBusy, setSaveBusy] = useState(false);

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
        .select("id, user_id, name, url, resolution, color")
        .order("created_at", { ascending: true });

      if (error) {
        toast({
          title: "Error loading streams",
          description: error.message,
          variant: "destructive",
        });
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

  useEffect(() => {
    if (isOpen) void fetchStreams();
  }, [isOpen, fetchStreams]);

  const openEdit = (s: StreamRow) => {
    setEditingId(s.id);
    setEditForm({
      name: s.name || "",
      url: s.url || "",
      resolution: s.resolution || "480p",
    });
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
      toast({
        title: "Invalid URL",
        description: "Enter a valid HLS (.m3u8), RTMP, RTSP, HTTP, or UDP URL.",
        variant: "destructive",
      });
      return;
    }

    setSaveBusy(true);
    try {
      const { error } = await supabase
        .from("streams")
        .update({
          name,
          url,
          resolution: editForm.resolution,
        })
        .eq("id", editingId);

      if (error) {
        toast({
          title: "Failed to update stream",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Stream updated" });
      setStreams((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? { ...s, name, url, resolution: editForm.resolution }
            : s
        )
      );
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
      toast({
        title: "Failed to delete stream",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setStreams((prev) => prev.filter((s) => s.id !== id));
    toast({ title: "Stream deleted" });
  };

  // ✅ Change password for CURRENT logged-in user (no Edge function needed)
  const changeMyPassword = async () => {
    if (pw.pass1.length < 6) {
      toast({
        title: "Password too short",
        description: "Min 6 characters.",
        variant: "destructive",
      });
      return;
    }
    if (pw.pass1 !== pw.pass2) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: pw.pass1,
      });

      if (error) {
        toast({
          title: "Failed to update password",
          description: error.message,
          variant: "destructive",
        });
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
      <DialogContent className="sm:max-w-[880px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-3">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Settings</DialogTitle>

            {/* Theme toggle */}
            <div className="flex items-center gap-2">
              <Label htmlFor="theme-toggle" className="text-sm">
                Dark
              </Label>
              <Switch
                id="theme-toggle"
                checked={theme === "dark"}
                onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
              />
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          {/* Change My Password */}
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
                <Switch
                  id="showpw"
                  checked={pw.show}
                  onCheckedChange={(v) => setPw((s) => ({ ...s, show: !!v }))}
                />
                <Label htmlFor="showpw" className="text-sm">
                  Show password
                </Label>
              </div>

              <Button
                onClick={() => void changeMyPassword()}
                disabled={pwBusy || pw.pass1.length < 6 || pw.pass1 !== pw.pass2}
              >
                Update Password
              </Button>
            </div>
          </div>

          {/* Stream Editor */}
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
                            <div className="text-xs text-muted-foreground font-mono truncate">
                              {s.url}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Resolution: {s.resolution}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
                              Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => void deleteStream(s.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-center">
                            <Label className="sm:col-span-1">Name</Label>
                            <Input
                              className="sm:col-span-3"
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                              placeholder="Stream name"
                            />

                            <Label className="sm:col-span-1">URL</Label>
                            <Input
                              className="sm:col-span-3"
                              value={editForm.url}
                              onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                              placeholder="Stream URL"
                            />

                            <Label className="sm:col-span-1">Resolution</Label>
                            <div className="sm:col-span-3">
                              <Select
                                value={editForm.resolution}
                                onValueChange={(v) => setEditForm((f) => ({ ...f, resolution: v }))}
                              >
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
                            <Button variant="outline" onClick={cancelEdit}>
                              Cancel
                            </Button>
                            <Button onClick={() => void saveStream()} disabled={saveBusy}>
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Note */}
          <div className="text-xs text-muted-foreground">
            Permissions are removed because all users are treated as admin in this app.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
