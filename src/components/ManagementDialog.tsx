import React, { useState, useEffect } from 'react';
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
} from "@/components/ui/alert-dialog"

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type User = {
  username: string;
  role: 'admin' | 'user' | string;
  roles?: Record<string, boolean>;
};

const API_BASE = `${window.location.protocol}//${window.location.hostname}:3001`;

const allRoles = [
  "add_streams",
  "save_lists",
  "load_lists",
  "download_logs",
  "delete_streams",
] as const;

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user' as 'user' | 'admin' });
  const { toast } = useToast();

  // single, stable confirm dialog
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const token = sessionStorage.getItem('token');
      const response = await fetch(`${API_BASE}/auth/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) fetchUsers();
  }, [isOpen]);

  const handleCreateUser = async () => {
    const payload = {
      ...newUser,
      username: newUser.username.trim().replace(/\s+/g, ''),
    };

    if (payload.username.length < 3) {
      return toast({ title: "Username too short", description: "Min 3 characters.", variant: "destructive" });
    }
    if (payload.password.length < 6) {
      return toast({ title: "Password too short", description: "Min 6 characters.", variant: "destructive" });
    }

    try {
      const token = sessionStorage.getItem('token');
      const response = await fetch(`${API_BASE}/auth/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        toast({ title: "User created successfully" });
        await fetchUsers();
        setNewUser({ username: '', password: '', role: 'user' });
      } else {
        const error = await response.json();
        toast({ title: "Error creating user", description: error?.message, variant: "destructive" });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRoleChange = async (username: string, role: string, value: boolean) => {
    try {
      const token = sessionStorage.getItem('token');
      const response = await fetch(`${API_BASE}/auth/user-roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username, role, value }),
      });

      if (response.ok) {
        toast({ title: "User role updated" });
        fetchUsers();
      } else {
        const error = await response.json();
        toast({ title: "Error updating role", description: error?.message, variant: "destructive" });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePasswordChange = async (username: string) => {
    const newPassword = prompt(`Enter new password for ${username}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      return toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
    }

    try {
      const token = sessionStorage.getItem('token');
      const response = await fetch(`${API_BASE}/auth/update-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username, password: newPassword }),
      });

      if (response.ok) {
        toast({ title: "Password updated successfully" });
      } else {
        const error = await response.json();
        toast({ title: "Error updating password", description: error?.message, variant: "destructive" });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteUser = async (username: string) => {
    try {
      const token = sessionStorage.getItem('token');
      const response = await fetch(`${API_BASE}/auth/delete-user/${username}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        toast({ title: "User deleted successfully" });
        await fetchUsers();
      } else {
        const error = await response.json();
        toast({ title: "Error deleting user", description: error?.message, variant: "destructive" });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmDeleteUser(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="sticky top-0 bg-background z-10">
          <DialogTitle>User Management</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Create User — improved */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateUser();
            }}
            className="rounded-xl border p-4"
          >
            <h3 className="text-lg font-semibold mb-2">Create User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center">
              <Label htmlFor="new-username" className="sm:col-span-1">Username</Label>
              <Input
                id="new-username"
                className="sm:col-span-3"
                value={newUser.username}
                onChange={(e) =>
                  setNewUser({ ...newUser, username: e.target.value })
                }
                placeholder="Enter username"
                autoComplete="off"
                required
                minLength={3}
              />

              <Label htmlFor="new-password" className="sm:col-span-1">Password</Label>
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

              <Label htmlFor="new-role" className="sm:col-span-1">Role</Label>
              <select
                id="new-role"
                className="sm:col-span-3 h-10 rounded-md border bg-background px-3 text-sm"
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({ ...newUser, role: e.target.value as 'user' | 'admin' })
                }
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <div className="mt-4">
              <Button
                type="submit"
                disabled={
                  newUser.username.trim().length < 3 || newUser.password.length < 6
                }
              >
                Create User
              </Button>
            </div>
          </form>

          {/* Users List */}
          <div className="mt-2">
            <h3 className="text-lg font-semibold mb-3">Users and Permissions</h3>

            {/* inner scroll so header & create form remain visible */}
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {users.map((user) => (
                <div key={user.username} className="mb-4 p-4 border rounded-lg">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold">
                      {user.username} ({user.role})
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePasswordChange(user.username)}
                      >
                        Change Password
                      </Button>

                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={user.role === 'admin'}
                        onClick={() => setConfirmDeleteUser(user.username)}
                      >
                        Delete User
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                    {allRoles.map((role) => (
                      <div key={role} className="flex items-center space-x-2">
                        <Switch
                          id={`${user.username}-${role}`}
                          checked={Boolean(user.roles?.[role])}
                          onCheckedChange={(value) =>
                            handleRoleChange(user.username, role, value)
                          }
                          disabled={user.role === 'admin'}
                        />
                        <Label htmlFor={`${user.username}-${role}`}>
                          {role.replace(/_/g, ' ')}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 border rounded-lg">
                  No users found.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Global, controlled delete confirmation */}
        <AlertDialog open={!!confirmDeleteUser} onOpenChange={(open) => !open && setConfirmDeleteUser(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmDeleteUser ? `Delete ${confirmDeleteUser}?` : 'Delete user?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The user account will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDeleteUser && handleDeleteUser(confirmDeleteUser)}
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
