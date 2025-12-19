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

const roleMeta: Record<
  RoleKey,
  { label: string; description: string; group: "Streams" | "Lists" | "Logs" }
> = {
  add_streams: {
    label: "Add streams",
    description: "Allow creating/adding streams to monitoring.",
    group: "Streams",
  },
  delete_streams: {
    label: "Delete streams",
    description: "Allow removing streams from monitoring.",
    group: "Streams",
  },
  save_lists: {
    label: "Save lists",
    description: "Allow saving stream lists/presets.",
    group: "Lists",
  },
  load_lists: {
    label: "Load lists",
    description: "Allow loading saved stream lists/presets.",
    group: "Lists",
  },
  download_logs: {
    label: "Download logs",
    description: "Allow downloading/exporting logs and reports.",
    group: "Logs",
  },
};

function getInitialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // ignore
  }
  return "light";
}

function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // ignore
  }
}

function makeRandomPassword(len = 12) {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%";
  const arr = new Uint8Array(len);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((n) => chars.charAt(n % chars.length))
      .join("");
  }
  // fallback
  return Math.random().toString(36).slice(2) + "!A1";
}

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [profiles, setProfiles] = useState<DbProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // NEW: theme toggle
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  // NEW: search + filter
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [showOnlyWithAnyPerm, setShowOnlyWithAnyPerm] = useState(false);

  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role: "user" as "user" | "admin",
    username: "",
  });

  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(
    null
  );

  // NEW: password dialog (better UX than prompt)
  const [pwDialog, setPwDialog] = useState<{ open: boolean; user?: DbProfile }>({
    open: false,
    user: undefined,
  });
  const [pwForm, setPwForm] = useState({
    pass1: "",
    pass2: "",
    show: false,
    copyAfterGenerate: false,
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    // get current user to prevent self-delete
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      setCurrentUserId(data?.user?.id ?? null);
    };
    void run();
  }, []);

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

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedProfiles.filter((p) => {
      const isAdmin = (p.role || "user") === "admin";
      if (roleFilter !== "all") {
        if (roleFilter === "admin" && !isAdmin) return false;
        if (roleFilter === "user" && isAdmin) return false;
      }

      if (showOnlyWithAnyPerm && !isAdmin) {
        const roles = p.roles || {};
        const anyTrue = allRoles.some((rk) => Boolean(roles[rk]));
        if (!anyTrue) return false;
      }

      if (!q) return true;
      const hay = `${p.username || ""} ${p.id} ${p.role || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedProfiles, search, roleFilter, showOnlyWithAnyPerm]);

  const groupedRoleKeys = useMemo(() => {
    const groups: Record<"Streams" | "Lists" | "Logs", RoleKey[]> = {
      Streams: [],
      Lists: [],
      Logs: [],
    };
    for (const rk of allRoles) groups[roleMeta[rk].group].push(rk);
    return groups;
  }, []);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
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

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "create",
          email,
          password,
          role: newUser.role,
          username: username || email,
        },
      });

      if (error || data?.error) {
        toast({
          title: "Error creating user",
          description: error?.message || String(data?.error),
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
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePermission = async (
    profile: DbProfile,
    key: RoleKey,
    value: boolean
  ) => {
    if ((profile.role || "user") === "admin") return; // admins always allowed
    setBusyUserId(profile.id);

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
      setBusyUserId(null);
      return;
    }

    toast({ title: "Permissions updated" });
    setProfiles((prev) =>
      prev.map((p) => (p.id === profile.id ? { ...p, roles: nextRoles } : p))
    );
    setBusyUserId(null);
  };

  const openPasswordDialog = (profile: DbProfile) => {
    setPwForm({ pass1: "", pass2: "", show: false, copyAfterGenerate: false });
    setPwDialog({ open: true, user: profile });
  };

  const handleUpdatePassword = async () => {
    const user = pwDialog.user;
    if (!user) return;

    if (pwForm.pass1.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }
    if (pwForm.pass1 !== pwForm.pass2) {
      toast({
        title: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    setBusyUserId(user.id);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: {
        action: "set_password",
        user_id: user.id,
        password: pwForm.pass1,
      },
    });

    if (error || data?.error) {
      toast({
        title: "Error updating password",
        description: error?.message || String(data?.error),
        variant: "destructive",
      });
      setBusyUserId(null);
      return;
    }

    toast({ title: "Password updated successfully" });
    setPwDialog({ open: false, user: undefined });
    setBusyUserId(null);
  };

  const handleDeleteUser = async (userId: string) => {
    if (userId === currentUserId) {
      toast({
        title: "Action not allowed",
        description: "You can't delete your own account.",
        variant: "destructive",
      });
      setConfirmDeleteUserId(null);
      return;
    }

    setBusyUserId(userId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", user_id: userId },
      });

      if (error || data?.error) {
        toast({
          title: "Error deleting user",
          description: error?.message || String(data?.error),
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
      setBusyUserId(null);
      setConfirmDeleteUserId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[860px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10 pb-3">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>User Management (Supabase)</DialogTitle>

            {/* NEW: theme toggle */}
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

        <div className="grid gap-4 py-4">
          {/* NEW: Quick controls */}
          <div className="rounded-xl border p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2">
                <Label htmlFor="search-users">Search users</Label>
                <Input
                  id="search-users"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by username / role / id..."
                />
              </div>

              <div>
                <Label htmlFor="role-filter">Role filter</Label>
                <select
                  id="role-filter"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={roleFilter}
                  onChange={(e) =>
                    setRoleFilter(e.target.value as "all" | "admin" | "user")
                  }
                >
                  <option value="all">All</option>
                  <option value="admin">Admins</option>
                  <option value="user">Users</option>
                </select>
              </div>

              <div className="sm:col-span-3 flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="only-perm"
                    checked={showOnlyWithAnyPerm}
                    onCheckedChange={(v) => setShowOnlyWithAnyPerm(!!v)}
                  />
                  <Label htmlFor="only-perm" className="text-sm">
                    Show only users with any permission enabled
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void fetchProfiles()}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                  {loading && (
                    <span className="text-sm text-muted-foreground">Loading…</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Create User */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateUser();
            }}
            className="rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-lg font-semibold">Create User</h3>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const gen = makeRandomPassword(12);
                  setNewUser((s) => ({ ...s, password: gen }));
                  try {
                    navigator.clipboard?.writeText(gen);
                    toast({ title: "Generated password copied to clipboard" });
                  } catch {
                    toast({ title: "Generated password ready" });
                  }
                }}
              >
                Generate Password
              </Button>
            </div>

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
                onChange={(e) =>
                  setNewUser({ ...newUser, username: e.target.value })
                }
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
                onChange={(e) =>
                  setNewUser({ ...newUser, password: e.target.value })
                }
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
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    role: e.target.value as "user" | "admin",
                  })
                }
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  loading ||
                  newUser.email.trim().length < 5 ||
                  newUser.password.length < 6
                }
              >
                Create User
              </Button>
            </div>
          </form>

          {/* Users List */}
          <div className="mt-2">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">Users and Permissions</h3>
              <div className="text-sm text-muted-foreground">
                Showing {filteredProfiles.length} / {sortedProfiles.length}
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {filteredProfiles.map((p) => {
                const display = p.username || p.id;
                const isAdmin = (p.role || "user") === "admin";
                const roles = p.roles || {};
                const isSelf = currentUserId && p.id === currentUserId;

                return (
                  <div key={p.id} className="mb-4 p-4 border rounded-lg">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold">{display}</h4>
                        <span
                          className={`text-xs px-2 py-1 rounded-full border ${
                            isAdmin ? "font-semibold" : ""
                          }`}
                          title={isAdmin ? "Admin has all permissions" : "Standard user"}
                        >
                          {p.role || "user"}
                        </span>
                        {isSelf && (
                          <span className="text-xs px-2 py-1 rounded-full border">
                            you
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyUserId === p.id}
                          onClick={() => openPasswordDialog(p)}
                        >
                          Change Password
                        </Button>

                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={isAdmin || isSelf || busyUserId === p.id}
                          onClick={() => setConfirmDeleteUserId(p.id)}
                          title={
                            isAdmin
                              ? "Admins cannot be deleted here"
                              : isSelf
                              ? "You can't delete your own account"
                              : "Delete user"
                          }
                        >
                          Delete User
                        </Button>
                      </div>
                    </div>

                    {/* NEW: grouped permissions + descriptions */}
                    <div className="mt-4 grid gap-4">
                      {(["Streams", "Lists", "Logs"] as const).map((grp) => (
                        <div key={grp} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-semibold">{grp}</div>
                            {isAdmin && (
                              <div className="text-xs text-muted-foreground">
                                Admin: always allowed
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {groupedRoleKeys[grp].map((rk) => (
                              <div
                                key={rk}
                                className="flex items-start justify-between gap-3 rounded-md border p-3"
                              >
                                <div className="min-w-0">
                                  <Label
                                    htmlFor={`${p.id}-${rk}`}
                                    className="font-medium"
                                    title={roleMeta[rk].description}
                                  >
                                    {roleMeta[rk].label}
                                  </Label>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {roleMeta[rk].description}
                                  </p>
                                </div>

                                <Switch
                                  id={`${p.id}-${rk}`}
                                  checked={isAdmin ? true : Boolean(roles[rk])}
                                  onCheckedChange={(value) =>
                                    void handleTogglePermission(p, rk, !!value)
                                  }
                                  disabled={isAdmin || busyUserId === p.id}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {filteredProfiles.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 border rounded-lg">
                  No users match your filters (or you don’t have permission).
                </div>
              )}
            </div>
          </div>
        </div>

        {/* NEW: Change Password Dialog */}
        <Dialog
          open={pwDialog.open}
          onOpenChange={(open) => !open && setPwDialog({ open: false, user: undefined })}
        >
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>
                Change Password — {pwDialog.user?.username || pwDialog.user?.id}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>New password</Label>
                <Input
                  type={pwForm.show ? "text" : "password"}
                  value={pwForm.pass1}
                  onChange={(e) => setPwForm((s) => ({ ...s, pass1: e.target.value }))}
                  placeholder="Min 6 characters"
                  autoComplete="off"
                />
              </div>

              <div className="grid gap-2">
                <Label>Confirm password</Label>
                <Input
                  type={pwForm.show ? "text" : "password"}
                  value={pwForm.pass2}
                  onChange={(e) => setPwForm((s) => ({ ...s, pass2: e.target.value }))}
                  placeholder="Repeat password"
                  autoComplete="off"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="showpw"
                    checked={pwForm.show}
                    onCheckedChange={(v) => setPwForm((s) => ({ ...s, show: !!v }))}
                  />
                  <Label htmlFor="showpw" className="text-sm">
                    Show password
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="copygen"
                    checked={pwForm.copyAfterGenerate}
                    onCheckedChange={(v) =>
                      setPwForm((s) => ({ ...s, copyAfterGenerate: !!v }))
                    }
                  />
                  <Label htmlFor="copygen" className="text-sm">
                    Copy on generate
                  </Label>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const gen = makeRandomPassword(12);
                    setPwForm((s) => ({ ...s, pass1: gen, pass2: gen }));
                    if (pwForm.copyAfterGenerate) {
                      try {
                        navigator.clipboard?.writeText(gen);
                        toast({ title: "Generated password copied" });
                      } catch {
                        toast({ title: "Generated password ready" });
                      }
                    }
                  }}
                >
                  Generate
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const v = pwForm.pass1;
                    if (!v) return toast({ title: "Nothing to copy" });
                    try {
                      navigator.clipboard?.writeText(v);
                      toast({ title: "Copied to clipboard" });
                    } catch {
                      toast({ title: "Copy failed", variant: "destructive" });
                    }
                  }}
                >
                  Copy
                </Button>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPwDialog({ open: false, user: undefined })}
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    !pwDialog.user ||
                    busyUserId === pwDialog.user.id ||
                    pwForm.pass1.length < 6 ||
                    pwForm.pass1 !== pwForm.pass2
                  }
                  onClick={() => void handleUpdatePassword()}
                >
                  Update
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
              <AlertDialogCancel disabled={busyUserId === confirmDeleteUserId}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  confirmDeleteUserId && void handleDeleteUser(confirmDeleteUserId)
                }
                disabled={busyUserId === confirmDeleteUserId}
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
