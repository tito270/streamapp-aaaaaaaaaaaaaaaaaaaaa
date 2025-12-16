import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// ============= Satellites =============
export const useFetchSatellites = () => {
  return useQuery({
    queryKey: ["satellites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("satellites").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateSatellite = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from("satellites").insert({ name }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["satellites"] });
      toast({ title: "Success", description: "Satellite created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateSatellite = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase.from("satellites").update({ name }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["satellites"] });
      toast({ title: "Success", description: "Satellite updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useDeleteSatellite = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("satellites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["satellites"] });
      toast({ title: "Success", description: "Satellite deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= SNG Satellites =============
export const useFetchSngSatellites = () => {
  return useQuery({
    queryKey: ["sng_satellites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sng_satellites").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateSngSatellite = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: { name: string; encoder?: string; power_amplifier?: string; dish?: string }) => {
      const { data, error } = await supabase.from("sng_satellites").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sng_satellites"] });
      toast({ title: "Success", description: "SNG Satellite created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Operators =============
export const useFetchOperators = () => {
  return useQuery({
    queryKey: ["operators"],
    queryFn: async () => {
      const { data, error } = await supabase.from("operators").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateOperator = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: { name: string; email?: string; phone?: string }) => {
      const { data, error } = await supabase.from("operators").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operators"] });
      toast({ title: "Success", description: "Operator created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Channels =============
export const useFetchChannels = () => {
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("channels")
        .select("*, satellite:satellites(id, name)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateChannel = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      satellite_id?: string;
      bitrate?: number;
      frequency?: string;
      modulation?: string;
      polarization?: string;
      symbol_rate?: string;
      stream_url?: string;
      status?: "active" | "inactive" | "maintenance";
    }) => {
      const { data, error } = await supabase.from("channels").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast({ title: "Success", description: "Channel created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateChannel = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; [key: string]: any }) => {
      const { data, error } = await supabase.from("channels").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast({ title: "Success", description: "Channel updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useDeleteChannel = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast({ title: "Success", description: "Channel deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Clients =============
export const useFetchClients = () => {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("client_name");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateClient = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: { client_name: string; email?: string; phone1: string; phone2?: string }) => {
      const { data, error } = await supabase.from("clients").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast({ title: "Success", description: "Client created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateClient = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; [key: string]: any }) => {
      const { data, error } = await supabase.from("clients").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast({ title: "Success", description: "Client updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useDeleteClient = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast({ title: "Success", description: "Client deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Client Channels =============
export const useFetchClientChannels = () => {
  return useQuery({
    queryKey: ["client_channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_channels")
        .select("*, client:clients(*), channel:channels(*)");
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateClientChannel = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: { client_id: string; channel_id: string }) => {
      const { data, error } = await supabase.from("client_channels").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client_channels"] });
      toast({ title: "Success", description: "Client channel linked successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Issues =============
export const useFetchIssues = (status?: "open" | "resolved" | "all") => {
  return useQuery({
    queryKey: ["issues", status],
    queryFn: async () => {
      let query = supabase
        .from("issues")
        .select("*, channel:channels(id, name), satellite:satellites(id, name), operator:operators(id, name)")
        .order("created_at", { ascending: false });
      
      if (status && status !== "all") {
        query = query.eq("status", status);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateIssue = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: {
      title: string;
      issue_type: "Image" | "Sound" | "Graphic";
      detail?: string;
      reason?: string;
      description?: string;
      channel_id?: string;
      satellite_id?: string;
      operator_id?: string;
      start_date?: string;
      end_date?: string;
    }) => {
      const { data, error } = await supabase.from("issues").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      toast({ title: "Success", description: "Issue created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateIssue = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; [key: string]: any }) => {
      const { data, error } = await supabase.from("issues").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      toast({ title: "Success", description: "Issue updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useResolveIssue = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, resolution_reason }: { id: string; resolution_reason: string }) => {
      const { data, error } = await supabase
        .from("issues")
        .update({ status: "resolved", resolution_reason, end_date: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      toast({ title: "Success", description: "Issue resolved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= DTL =============
export const useFetchDTL = () => {
  return useQuery({
    queryKey: ["dtl"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dtl")
        .select("*, client:clients(*), satellite:sng_satellites(*), operator:operators(*)")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateDTL = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: {
      client_id?: string;
      date: string;
      start_time: string;
      end_time: string;
      transmission_type: "SNG" | "TVU" | "AVIWEST" | "UNIVISO" | "LiveU" | "Turnaround" | "SRT Link" | "RTMP Link";
      satellite_id?: string;
      encoder?: string;
      power_amplifier?: string;
      dish?: string;
      from_location?: string;
      via_location?: string;
      issue_description?: string;
      reason?: string;
      notes?: string;
      guest_name?: string;
      fees?: number;
      operator_id?: string;
    }) => {
      const { data, error } = await supabase.from("dtl").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dtl"] });
      toast({ title: "Success", description: "DTL entry created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Shifts =============
export const useFetchShifts = (month?: number, year?: number) => {
  return useQuery({
    queryKey: ["shifts", month, year],
    queryFn: async () => {
      let query = supabase.from("shifts").select("*, operator:operators(*)").order("date");
      
      if (month !== undefined && year !== undefined) {
        const startDate = new Date(year, month, 1).toISOString().split("T")[0];
        const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];
        query = query.gte("date", startDate).lte("date", endDate);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: { date: string; shift_time: "morning" | "evening" | "night"; operator_id?: string; notes?: string }) => {
      const { data, error } = await supabase.from("shifts").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Success", description: "Shift created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string; [key: string]: any }) => {
      const { data, error } = await supabase.from("shifts").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Success", description: "Shift updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useDeleteShift = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast({ title: "Success", description: "Shift deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Leave Requests =============
export const useFetchLeaveRequests = () => {
  return useQuery({
    queryKey: ["leave_requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("*, operator:operators(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateLeaveRequest = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: {
      operator_id: string;
      start_date: string;
      end_date: string;
      leave_type: "annual" | "sick-reported" | "sick-unreported" | "extra";
      note?: string;
    }) => {
      const { data, error } = await supabase.from("leave_requests").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
      toast({ title: "Success", description: "Leave request created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

export const useUpdateLeaveRequestStatus = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "pending" | "approved" | "rejected" }) => {
      const { data, error } = await supabase.from("leave_requests").update({ status }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave_requests"] });
      toast({ title: "Success", description: "Leave request status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Bitrate Records =============
export const useFetchBitrateRecords = (channelId?: string) => {
  return useQuery({
    queryKey: ["bitrate_records", channelId],
    queryFn: async () => {
      let query = supabase
        .from("bitrate_records")
        .select("*, channel:channels(id, name), operator:operators(id, name)")
        .order("recorded_at", { ascending: false });
      
      if (channelId) {
        query = query.eq("channel_id", channelId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
};

export const useCreateBitrateRecord = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (payload: {
      channel_id: string;
      shift_time: "morning" | "evening" | "night";
      bitrate_value: number;
      operator_id?: string;
    }) => {
      const { data, error } = await supabase.from("bitrate_records").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bitrate_records"] });
      toast({ title: "Success", description: "Bitrate recorded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};

// ============= Notifications =============
export const useFetchNotifications = () => {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
};

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useDeleteNotification = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

// ============= Settings =============
export const useFetchSettings = () => {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*");
      if (error) throw error;
      return data;
    },
  });
};

export const useUpdateSetting = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const { data, error } = await supabase
        .from("settings")
        .upsert({ key, value }, { onConflict: "key" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Success", description: "Settings updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
};
