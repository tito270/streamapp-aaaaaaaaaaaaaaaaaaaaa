import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

/**
 * Updated ManagementDialog:
 * - Removes permissions completely (no roles json switches).
 * - Focuses on:
 *   1) Change YOUR password (current logged in user)
 *   2) View users list (optional)
 *   3) Delete user (admin-only via Edge Function if you keep it)
 *
 * NOTE:
 * - Client-side can only change password for the CURRENT user.
 * - If you want to change/delete other users, keep your Edge Function ("admin-users")
 *   and secure it (service role + auth check).
 */

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type DbProfile = {
  id: string; // uuid
  username: string | null;
  role: string | null; // optional (admin/user). Not used for permissions anymore.
};

type AuditAction =
  | "password_change"
  | "user_delete"
  | "user_create"
  | "management_open";

const logAction = async (
  action: AuditAction,
  payload: { entity_type?: string; entity_id?: string; details?: any } = {}
) => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  // If you don't have audit_logs table yet, this will fail silently in console.
  const { error } = await supabase.from("audit_logs").insert({
    user_id: user.id,
    action,
    entity_type: payload.entity_type ?? null,
    entity_id: payload.entity_id ?? null,
    details: payload.details ?? null,
  });

  if (error) console.warn("audit_logs insert error:", error.message);
};

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<DbProfile[]>([]);
  const [loading, setLoading] = useState(false);

  // Change my password UI
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  // Optional admin create user (still uses Edge Function)
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    username: "",
    role: "user" as "user" | "admin",
  });
  const [createBusy, setCreateBusy] = useState(false);

  // Delete user confirm
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  const sortedProfiles = useMemo(() => {
    const arr = [...profiles];
    arr.sort((a, b) => {
      const ar = (a.role || "user").toLowerCase();
      const br = (b.role || "user").toLowerCase();
      if (ar !== br) return ar === "admin" ? -1 : 1;
      return (a.username || "").localeCompare(b.username || "");
    });
    return arr;
  }, [profiles]);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      // If you don't want user listing at all, you can delete this entirely.
      // Ensure RLS matches your desired behavior.
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, role")
        .order("created_at", { ascending: true });

      if (error) {
        console.error(error);
        toast({
          title: "Error loading users",
          description: error.message,
          variant: "destructive",
        });
        setProfiles([]);
        return;
      }

      setProfiles((data || []) as DbProfile[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void fetchProfiles();
    void logAction("management_open", { entity_type: "ui" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleChangeMyPassword = async () => {
    if (pw.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }
    if (pw !== pw2) {
      toast({
        title: "Passwords do not match",
        description: "Please confirm your new password.",
        variant: "destructive",
      });
      return;
    }

    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;

      toast({ title: "Password updated" });
      setPw("");
      setPw2("");
      await logAction("password_change", { entity_type: "user" });
    } catch (e: any) {
      toast({
        title: "Failed to change password",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setPwBusy(false);
    }
  };

  const handleCreateUser = async () => {
    const email = newUser.email.trim().toLowerCase();
    const username = (newUser.username || "").trim();
    const password = newUser.password;

    if (!email.includes("@")) {
      toast({ title: "Invalid email", description: "Enter a valid email.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password too short", description: "Min 6 characters.", variant: "destructive" });
      return;
    }

    setCreateBusy(true);
    try {
      // Admin-only Edge Function (keep it only if you really need admin create)
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "create",
          email,
          password,
          role: newUser.role,
          username: username || email,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      toast({ title: "User created successfully" });

      await logAction("user_create", {
        entity_type: "user",
        details: { email, username: username || email, role: newUser.role },
      });

      setNewUser({ email: "", password: "", role: "user", username: "" });
      await fetchProfiles();
    } catch (e: any) {
      toast({
        title: "Error creating user",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      // Admin-only Edge Function (keep it only if you really need admin delete)
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", user_id: userId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));

      toast({ title: "User deleted successfully" });

      await logAction("user_delete", {
        entity_type: "user",
        entity_id: userId,
      });

      setConfirmDeleteUserId(null);
      await fetchProfiles();
    } catch (e: any) {
      toast({
        title: "Error deleting user",
        description: String(e?.message || e),
        variant: "destructive",
      });
    } finally {
      setConfirmDeleteUserId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10">
          <DialogTitle>Settings & User Management</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Change MY password */}
          <div className="rounded-xl border p-4">
            <h3 className="text-lg font-semibold mb-1">Change My Password</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This changes the password for the currently logged-in account.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="pw1" className="sm:col-span-1">New password</Label>
              <Input
                id="pw1"
                type="password"
                className="sm:col-span-3"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Minimum 6 characters"
                minLength={6}
              />

              <Label htmlFor="pw2" className="sm:col-span-1">Confirm</Label>
              <Input
                id="pw2"
                type="password"
                className="sm:col-span-3"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Repeat new password"
                minLength={6}
              />
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button onClick={() => void handleChangeMyPassword()} disabled={pwBusy || pw.length < 6 || pw !== pw2}>
                {pwBusy ? "Updating..." : "Update Password"}
              </Button>
            </div>
          </div>

          {/* Optional: Create User (admin-only if Edge Function is secured) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateUser();
            }}
            className="rounded-xl border p-4"
          >
            <h3 className="text-lg font-semibold mb-1">Create User (Admin)</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This requires the <span className="font-mono">admin-users</span> Edge Function and admin rights.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="new-email" className="sm:col-span-1">Email</Label>
              <Input
                id="new-email"
                className="sm:col-span-3"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="user@email.com"
                autoComplete="off"
              />

              <Label htmlFor="new-username" className="sm:col-span-1">Username</Label>
              <Input
                id="new-username"
                className="sm:col-span-3"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="Optional display name"
                autoComplete="off"
              />

              <Label htmlFor="new-password" className="sm:col-span-1">Password</Label>
              <Input
                id="new-password"
                type="password"
                className="sm:col-span-3"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Minimum 6 characters"
                minLength={6}
              />

              <Label htmlFor="new-role" className="sm:col-span-1">Role</Label>
              <select
                id="new-role"
                className="sm:col-span-3 h-10 rounded-md border bg-background px-3 text-sm"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as "user" | "admin" })}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="submit"
                disabled={createBusy || newUser.email.trim().length < 5 || newUser.password.length < 6}
              >
                {createBusy ? "Creating..." : "Create User"}
              </Button>
              {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
            </div>
          </form>

          {/* Users List (no permissions, full access for everyone) */}
          <div className="rounded-xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Users</h3>
                <p className="text-sm text-muted-foreground">
                  All users have full access. Permissions are disabled.
                </p>
              </div>

              <Button variant="outline" onClick={() => void fetchProfiles()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </Button>
            </div>

            <div className="mt-4 max-h-[45vh] overflow-y-auto pr-2">
              {sortedProfiles.map((p) => {
                const display = p.username || p.id;
                const isAdmin = (p.role || "user") === "admin";

                return (
                  <div key={p.id} className="mb-3 p-4 border rounded-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold truncate">{display}</h4>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full border ${
                              isAdmin ? "bg-green-500/15 border-green-500/30" : "bg-muted border-border"
                            }`}
                          >
                            {p.role || "user"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono break-all">{p.id}</p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isAdmin}
                          onClick={() => setConfirmDeleteUserId(p.id)}
                          title={isAdmin ? "Admin cannot be deleted from UI" : "Delete user (admin-only backend)"}
                        >
                          Delete User
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {sortedProfiles.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 border rounded-lg">
                  No users found (or you don’t have permission).
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
        <AlertDialog
          open={!!confirmDeleteUserId}
          onOpenChange={(open) => !open && setConfirmDeleteUserId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete user?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The user account will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDeleteUserId && void handleDeleteUser(confirmDeleteUserId)}
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
