import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ManagementDialog: React.FC<ManagementDialogProps> = ({ isOpen, onClose }) => {
  const { toast } = useToast();

  const [theme, setTheme] = useState<"light" | "dark">(
    (localStorage.getItem("theme") as "light" | "dark") || "dark"
  );

  /* ------------------ THEME ------------------ */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);

    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await supabase.from("audit_logs").insert({
        user_id: data.user.id,
        action: "theme_change",
        entity_type: "theme",
        details: { theme: next },
      });
    }

    toast({ title: `Theme switched to ${next}` });
  };

  /* ------------------ PASSWORD ------------------ */
  const handleChangePassword = async () => {
    const newPassword = prompt("Enter your new password:");
    if (!newPassword) return;

    if (newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast({
        title: "Failed to update password",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await supabase.from("audit_logs").insert({
        user_id: data.user.id,
        action: "password_change",
        entity_type: "user",
      });
    }

    toast({ title: "Password updated successfully" });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* INFO */}
          <div className="rounded-lg border p-3 text-sm text-muted-foreground">
            <strong>All users have full access.</strong>
            <br />
            Permissions and user management are disabled.
          </div>

          {/* THEME */}
          <div className="flex items-center justify-between">
            <Label>Dark Mode</Label>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={toggleTheme}
            />
          </div>

          {/* PASSWORD */}
          <div className="flex items-center justify-between">
            <Label>Change Password</Label>
            <Button variant="outline" onClick={handleChangePassword}>
              Change
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManagementDialog;
