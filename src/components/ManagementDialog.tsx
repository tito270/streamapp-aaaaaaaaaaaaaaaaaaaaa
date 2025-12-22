import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
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
  onStreamsChanged?: () => void;
}

type DbStreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  color: string | null;
};

const safeTrim = (v: string) => v.trim().replace(/\s+/g, " ");

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose, onStreamsChanged }) => {
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

      // ✅ resolution removed from select
      const { data, error } = await supabase
        .from("streams")
        .select("id, user_id, name, url, color")
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

  useEffect(() => {
    if (!isOpen) return;

    void fetchStreams();

    setEditingStreamId(null);
    setConfirmDeleteStreamId(null);
    setPwOld("");
    setPwNew("");
    setPwConfirm("");
  }, [isOpen, fetchStreams]);

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

    const { error } = await supabase.from("streams").update({ name, url }).eq("id", streamId);

    if (error) {
      toast({ title: "Failed to update stream", description: error.message, variant: "destructive" });
      return;
    }

    await insertActivity("edit_stream", "stream", name, `Updated stream: ${before} -> ${name} — ${url}`);

    toast({ title: "Stream updated" });
    cancelEditStream();
    await fetchStreams();
    onStreamsChanged?.();
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
    onStreamsChanged?.();
  };

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

      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pwOld });
      if (signInErr) {
        toast({ title: "Old password incorrect", description: signInErr.message, variant: "destructive" });
        return;
      }

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
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[980px] max-h-[88vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-2">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Settings</DialogTitle>
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
                <span className="text-xs text-muted-foreground">New password must match and be at least 6 characters.</span>
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
                            <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteStreamId(s.id)}>
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
                            Tip: For best results without backend, use HLS (.m3u8) streams.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Delete stream confirmation */}
        <AlertDialog open={!!confirmDeleteStreamId} onOpenChange={(open) => !open && setConfirmDeleteStreamId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete stream?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone. The stream will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => confirmDeleteStreamId && void deleteStream(confirmDeleteStreamId)}>
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
