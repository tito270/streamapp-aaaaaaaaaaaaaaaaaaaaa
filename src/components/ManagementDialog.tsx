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
import { Switch } from "@/components/ui/switch";
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

type DbProfile = {
  id: string; // uuid
  username: string | null;
  role: string | null; // 'admin' | 'user' ...
  roles: Record<string, boolean> | null; // jsonb
};

const allRoles = [
  "add_streams",
  "save_lists",
  "load_lists",
  "download_logs",
  "delete_streams",
] as const;

type RoleKey = (typeof allRoles)[number];

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<DbProfile[]>([]);
  const [loading, setLoading] = useState(false);

  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role: "user" as "user" | "admin",
    username: "",
  });

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
      // Only admins should be able to list all profiles (enforce via RLS or Edge Function if you prefer)
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, role, roles")
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
    if (isOpen) void fetchProfiles();
  }, [isOpen]);

  const handleCreateUser = async () => {
    const email = newUser.email.trim().toLowerCase();
    const username = (newUser.username || "").trim();
    const password = newUser.password;

    if (!email.includes("@")) {
      return toast({
        title: "Invalid email",
        description: "Enter a valid email address.",
        variant: "destructive",
      });
    }
    if (password.length < 6) {
      return toast({
        title: "Password too short",
        description: "Min 6 characters.",
        variant: "destructive",
      });
    }

    try {
      // Create user via Edge Function (admin only)
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "create",
          email,
          password,
          role: newUser.role,
          username: username || email,
        },
      });

      if (error) {
        console.error(error);
        toast({
          title: "Error creating user",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      if (data?.error) {
        toast({
          title: "Error creating user",
          description: String(data.error),
          variant: "destructive",
        });
        return;
      }

      toast({ title: "User created successfully" });
      setNewUser({ email: "", password: "", role: "user", username: "" });
      await fetchProfiles();
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Error creating user",
        description: String(e?.message || e),
        variant: "destructive",
      });
    }
  };

  const handleTogglePermission = async (profile: DbProfile, key: RoleKey, value: boolean) => {
    if ((profile.role || "user") === "admin") return; // admins always allowed

    const nextRoles = { ...(profile.roles || {}) };
    nextRoles[key] = value;

    const { error } = await supabase
      .from("profiles")
      .update({ roles: nextRoles })
      .eq("id", profile.id);

    if (error) {
      toast({
        title: "Error updating permission",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Permissions updated" });
    // optimistic update
    setProfiles((prev) =>
      prev.map((p) => (p.id === profile.id ? { ...p, roles: nextRoles } : p))
    );
  };

  const handleChangePassword = async (profile: DbProfile) => {
    const label = profile.username || profile.id;
    const newPassword = prompt(`Enter new password for ${label}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      return toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
    }

    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: {
        action: "set_password",
        user_id: profile.id,
        password: newPassword,
      },
    });

    if (error) {
      toast({
        title: "Error updating password",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    if (data?.error) {
      toast({
        title: "Error updating password",
        description: String(data.error),
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Password updated successfully" });
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", user_id: userId },
      });

      if (error) {
        toast({
          title: "Error deleting user",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      if (data?.error) {
        toast({
          title: "Error deleting user",
          description: String(data.error),
          variant: "destructive",
        });
        return;
      }

      toast({ title: "User deleted successfully" });
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
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10">
          <DialogTitle>User Management (Supabase)</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Create User */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateUser();
            }}
            className="rounded-xl border p-4"
          >
            <h3 className="text-lg font-semibold mb-2">Create User</h3>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="new-email" className="sm:col-span-1">
                Email
              </Label>
              <Input
                id="new-email"
                className="sm:col-span-3"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="user@email.com"
                autoComplete="off"
                required
              />

              <Label htmlFor="new-username" className="sm:col-span-1">
                Username
              </Label>
              <Input
                id="new-username"
                className="sm:col-span-3"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="Optional display name"
                autoComplete="off"
              />

              <Label htmlFor="new-password" className="sm:col-span-1">
                Password
              </Label>
              <Input
                id="new-password"
                type="password"
                className="sm:col-span-3"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Minimum 6 characters"
                required
                minLength={6}
              />

              <Label htmlFor="new-role" className="sm:col-span-1">
                Role
              </Label>
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
                disabled={newUser.email.trim().length < 5 || newUser.password.length < 6}
              >
                Create User
              </Button>
              {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
            </div>
          </form>

          {/* Users List */}
          <div className="mt-2">
            <h3 className="text-lg font-semibold mb-3">Users and Permissions</h3>

            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {sortedProfiles.map((p) => {
                const display = p.username || p.id;
                const isAdmin = (p.role || "user") === "admin";
                const roles = p.roles || {};

                return (
                  <div key={p.id} className="mb-4 p-4 border rounded-lg">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold">
                        {display} ({p.role || "user"})
                      </h4>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleChangePassword(p)}
                        >
                          Change Password
                        </Button>

                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isAdmin}
                          onClick={() => setConfirmDeleteUserId(p.id)}
                        >
                          Delete User
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                      {allRoles.map((rk) => (
                        <div key={rk} className="flex items-center space-x-2">
                          <Switch
                            id={`${p.id}-${rk}`}
                            checked={isAdmin ? true : Boolean(roles[rk])}
                            onCheckedChange={(value) => void handleTogglePermission(p, rk, !!value)}
                            disabled={isAdmin}
                          />
                          <Label htmlFor={`${p.id}-${rk}`}>{rk.replace(/_/g, " ")}</Label>
                        </div>
                      ))}
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
              <AlertDialogAction onClick={() => confirmDeleteUserId && void handleDeleteUser(confirmDeleteUserId)}>
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
