import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { RotateCcw, Plus, Monitor, Save, LogOut, Settings, Download } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const AllBitrateGraph = React.lazy(() => import("./ui/AllBitrateGraph"));

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";

import { getUser, logout, UserPayload } from "@/lib/auth";
import ManagementDialog from "./ManagementDialog";
import { supabase } from "@/integrations/supabase/client";

type DbStreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  color: string | null;
};

interface Stream {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface AllBitrateDataPoint {
  time: number;
  [streamId: string]: number | null;
}

const streamColors = [
  "#8884d8",
  "#82ca9d",
  "#ffc658",
  "#ff7300",
  "#387908",
  "#ff0000",
  "#0088fe",
  "#00c49f",
  "#ffbb28",
  "#ff8042",
  "#00cfff",
  "#ff00ff",
];

type BitrateLogRow = {
  user_id: string;
  stream_id: string;
  stream_name: string;
  stream_url: string;
  bitrate_mbps: number;
  created_at?: string;
};

type DownloadRange = "1h" | "24h" | "all";

// --------- Activity Logs ----------
type ActivityAction =
  | "login"
  | "logout"
  | "add_stream"
  | "edit_stream"
  | "delete_stream"
  | "save_list"
  | "load_list"
  | "download_bitrate_csv"
  | "change_password";

type ActivityLogInsert = {
  actor_id?: string | null;
  actor_email?: string | null;
  action: ActivityAction;
  target_type?: string | null;
  target_id?: string | null;
  target_name?: string | null;
  description?: string | null;
};

type DbActivityLog = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_name: string | null;
  description: string | null;
};

// --------- Traffic Logs (Realtime Diagnostics) ----------
type TrafficEventType = "NO_SIGNAL" | "FROZEN" | "BLACK" | "SILENT" | "BUFFERING" | "RECOVERED" | "ERROR";
type TrafficSeverity = "info" | "warn" | "critical";

type TrafficEvent = {
  ts: number;
  streamId: string;
  streamName: string;
  streamUrl?: string;
  type: TrafficEventType;
  message: string;
  severity: TrafficSeverity;
};

type TrafficLogRow = {
  user_id: string;
  stream_id: string;
  stream_name: string;
  stream_url: string | null;
  type: TrafficEventType;
  severity: TrafficSeverity;
  message: string;
  created_at?: string;
};

const safeTrim = (v: unknown) => String(v ?? "").trim();

const formatDateTime = (isoOrMs: string | number) => {
  try {
    const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  } catch {
    return String(isoOrMs);
  }
};

const actionLabel = (a: string) => {
  const x = (a || "").toLowerCase();
  if (x === "add_stream") return "Add Stream";
  if (x === "delete_stream") return "Delete Stream";
  if (x === "edit_stream") return "Edit Stream";
  if (x === "save_list") return "Save List";
  if (x === "load_list") return "Load List";
  if (x === "change_password") return "Change Password";
  if (x === "login") return "Login";
  if (x === "logout") return "Logout";
  if (x === "download_bitrate_csv") return "Download Bitrate CSV";
  return a;
};

const trafficTypeLabel = (t: TrafficEventType) => {
  switch (t) {
    case "NO_SIGNAL":
      return "No Signal";
    case "FROZEN":
      return "Frozen";
    case "BLACK":
      return "Black Video";
    case "SILENT":
      return "Silent Audio";
    case "BUFFERING":
      return "Buffering";
    case "RECOVERED":
      return "Recovered";
    case "ERROR":
      return "Error";
    default:
      return t;
  }
};

export const StreamManager: React.FC = () => {
  const { toast } = useToast();

  const [user, setUser] = useState<UserPayload | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamName, setStreamName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");

  const [currentTime, setCurrentTime] = useState(new Date());

  // ✅ DEFAULT GRID = 6 columns
  const [gridLayout, setGridLayout] = useState<"3-2" | "4-2" | "6-2">("6-2");

  const [allBitrateHistory, setAllBitrateHistory] = useState<AllBitrateDataPoint[]>([]);
  const [reloadSignals, setReloadSignals] = useState<Record<string, number>>({});
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});

  const [selectedGraphStream, setSelectedGraphStream] = useState<string>("all");
  const [isManagementOpen, setManagementOpen] = useState(false);

  const [downloadRange, setDownloadRange] = useState<DownloadRange>("24h");

  // ✅ Tabs
  const [activeTab, setActiveTab] = useState<"bitrate" | "logs" | "traffic">("bitrate");

  // ✅ Activity logs
  const [logs, setLogs] = useState<DbActivityLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLimit, setLogsLimit] = useState(200);

  // ✅ Traffic logs (UI list)
  const [traffic, setTraffic] = useState<TrafficEvent[]>([]);
  const [trafficPaused, setTrafficPaused] = useState(false);
  const [trafficLimit, setTrafficLimit] = useState(500);

  const [trafficTypeFilter, setTrafficTypeFilter] = useState<TrafficEventType | "ALL">("ALL");
  const [trafficSeverityFilter, setTrafficSeverityFilter] = useState<TrafficSeverity | "ALL">("ALL");
  const [trafficStreamFilter, setTrafficStreamFilter] = useState<string>("ALL");

  const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/$/, "");

  // ---------- Helpers ----------
  const formatMbps = (v: number) => `${Number.isFinite(v) ? v.toFixed(2) : "0.00"} Mbps`;

  const getSinceIso = (range: DownloadRange): string | null => {
    if (range === "all") return null;
    const now = Date.now();
    const ms = range === "1h" ? 1 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    return new Date(now - ms).toISOString();
  };

  const makeRangeLabel = (range: DownloadRange) => (range === "1h" ? "last_1_hour" : range === "24h" ? "last_24_hours" : "all_time");

  const logsRangeLabel = useMemo(() => {
    return logsLimit === 50 ? "Last 50" : logsLimit === 200 ? "Last 200" : "Last 500";
  }, [logsLimit]);

  // ---------- Activity Logs insert (best-effort) ----------
  const logActivity = useCallback(
    async (row: Omit<ActivityLogInsert, "actor_email" | "actor_id"> & { actor_id?: string | null; actor_email?: string | null }) => {
      try {
        let actor_email = row.actor_email ?? null;
        let actor_id = row.actor_id ?? null;

        if (!actor_email || !actor_id) {
          const { data, error } = await supabase.auth.getUser();
          if (!error) {
            actor_email = actor_email ?? data.user?.email ?? null;
            actor_id = actor_id ?? data.user?.id ?? null;
          }
        }

        const payload: ActivityLogInsert = {
          actor_id,
          actor_email,
          action: row.action,
          target_type: row.target_type ?? null,
          target_id: row.target_id ?? null,
          target_name: row.target_name ?? null,
          description: row.description ?? null,
        };

        const { error } = await supabase.from("activity_logs").insert(payload);
        if (error) console.warn("activity_logs insert blocked/failed:", error.message);
      } catch (e) {
        console.warn("activity_logs insert exception:", e);
      }
    },
    []
  );

  // ✅ Fetch activity logs
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("id, created_at, actor_email, action, target_type, target_name, description")
        .order("created_at", { ascending: false })
        .limit(logsLimit);

      if (error) {
        toast({ title: "Failed to load activity logs", description: error.message, variant: "destructive" });
        setLogs([]);
        return;
      }
      setLogs((data || []) as DbActivityLog[]);
    } finally {
      setLogsLoading(false);
    }
  }, [logsLimit, toast]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    void fetchLogs();
  }, [activeTab, fetchLogs]);

  // --------- Bitrate DB buffer ----------
  const bitrateBufferRef = useRef<BitrateLogRow[]>([]);
  const lastWriteAtRef = useRef<number>(0);

  const flushBitrateBuffer = useCallback(async () => {
    const now = Date.now();
    if (now - lastWriteAtRef.current < 2500) return;

    const batch = bitrateBufferRef.current.splice(0, 500);
    if (batch.length === 0) return;

    lastWriteAtRef.current = now;

    const { error } = await supabase.from("bitrate_logs").insert(batch);
    if (error) {
      bitrateBufferRef.current.unshift(...batch);
      console.error("bitrate_logs insert error:", error);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void flushBitrateBuffer(), 5000);
    return () => clearInterval(id);
  }, [flushBitrateBuffer]);

  useEffect(() => {
    const handler = () => void flushBitrateBuffer();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushBitrateBuffer]);

  // --------- ✅ Traffic logs DB buffer ----------
  const trafficBufferRef = useRef<TrafficLogRow[]>([]);
  const lastTrafficWriteAtRef = useRef<number>(0);

  const flushTrafficBuffer = useCallback(async () => {
    const now = Date.now();
    if (now - lastTrafficWriteAtRef.current < 2500) return;

    const batch = trafficBufferRef.current.splice(0, 500);
    if (batch.length === 0) return;

    lastTrafficWriteAtRef.current = now;

    const { error } = await supabase.from("traffic_logs").insert(batch);
    if (error) {
      trafficBufferRef.current.unshift(...batch.slice(0, 500));
      console.warn("traffic_logs insert blocked/failed:", error.message);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void flushTrafficBuffer(), 5000);
    return () => clearInterval(id);
  }, [flushTrafficBuffer]);

  useEffect(() => {
    const handler = () => void flushTrafficBuffer();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushTrafficBuffer]);

  // --------- Auth user ----------
  useEffect(() => {
    setUser(getUser());

    const loadEmail = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn("supabase.auth.getUser error:", error.message);
        setUserEmail("");
        return;
      }
      setUserEmail(data.user?.email ?? "");
    };

    void loadEmail();
  }, []);

  // --------- Clock ----------
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // --------- URL validation ----------
  const isValidStreamUrl = (url: string): boolean => {
    const lowerUrl = url.trim().toLowerCase();
    return lowerUrl.startsWith("http://") || lowerUrl.startsWith("https://") || lowerUrl.includes(".m3u8") || lowerUrl.startsWith("rtmp://") || lowerUrl.startsWith("rtsp://") || lowerUrl.startsWith("udp://");
  };

  // --------- Load streams from DB ----------
  const loadStreamsFromDb = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) return;

    const { data, error } = await supabase.from("streams").select("id, user_id, name, url, color").order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Failed to load streams", description: error.message, variant: "destructive" });
      return;
    }

    const mapped: Stream[] = (data || []).map((row: DbStreamRow, idx: number) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      color: row.color || streamColors[idx % streamColors.length],
    }));

    setStreams(mapped);
  }, [toast]);

  useEffect(() => {
    void loadStreamsFromDb();
  }, [loadStreamsFromDb]);

  // --------- Bitrate updates (graph + DB) ----------
  const handleBitrateUpdate = useCallback(
    async (streamId: string, bitrate: number | null) => {
      const now = Date.now();
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      setAllBitrateHistory((prev) => {
        const lastPoint = prev.length ? prev[prev.length - 1] : null;
        const newPoint: AllBitrateDataPoint = { time: now };

        streams.forEach((s) => {
          if (s.id === streamId) newPoint[s.id] = typeof bitrate === "number" ? bitrate : 0;
          else if (lastPoint && lastPoint[s.id] !== undefined) newPoint[s.id] = lastPoint[s.id] as number;
          else newPoint[s.id] = 0;
        });

        return [...prev, newPoint].filter((p) => p.time >= twentyFourHoursAgo);
      });

      setFailureCounts((prev) => {
        const cur = prev[streamId] || 0;
        if (typeof bitrate === "number" && bitrate > 0) return { ...prev, [streamId]: 0 };
        return { ...prev, [streamId]: cur + 1 };
      });

      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) return;

      const stream = streams.find((s) => s.id === streamId);
      if (!stream) return;

      const v = typeof bitrate === "number" ? bitrate : 0;

      bitrateBufferRef.current.push({
        user_id: authUser.id,
        stream_id: stream.id,
        stream_name: stream.name,
        stream_url: stream.url,
        bitrate_mbps: v,
      });

      if (bitrateBufferRef.current.length >= 200) void flushBitrateBuffer();
    },
    [streams, flushBitrateBuffer]
  );

  // =========================
  // ✅ TRAFFIC: DB -> UI + REALTIME
  // =========================
  const toTrafficEvent = useCallback((r: TrafficLogRow): TrafficEvent => {
    return {
      ts: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      streamId: r.stream_id,
      streamName: r.stream_name,
      streamUrl: r.stream_url ?? undefined,
      type: r.type,
      severity: r.severity,
      message: r.message,
    };
  }, []);

  // Dedup to avoid duplicates (UI push + realtime insert)
  const trafficSeenRef = useRef<Set<string>>(new Set());
  const makeTrafficKey = (e: TrafficEvent) => `${e.ts}|${e.streamId}|${e.type}|${e.severity}|${e.message}`;

  const fetchTrafficFromDb = useCallback(async () => {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (authErr || !authUser) return;

    const { data, error } = await supabase
      .from("traffic_logs")
      .select("user_id, stream_id, stream_name, stream_url, type, severity, message, created_at")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(trafficLimit);

    if (error) {
      toast({ title: "Failed to load traffic logs", description: error.message, variant: "destructive" });
      return;
    }

    const mapped = (data || []).map((r: any) => toTrafficEvent(r));
    const nextSet = new Set<string>();
    for (const e of mapped) nextSet.add(makeTrafficKey(e));
    trafficSeenRef.current = nextSet;

    setTraffic(mapped);
  }, [trafficLimit, toast, toTrafficEvent]);

  useEffect(() => {
    if (activeTab !== "traffic") return;
    void fetchTrafficFromDb();
  }, [activeTab, fetchTrafficFromDb]);

  useEffect(() => {
    if (activeTab !== "traffic") return;

    let alive = true;
    let channel: any;

    const start = async () => {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) return;

      channel = supabase
        .channel(`traffic_logs_rt_${authUser.id}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "traffic_logs", filter: `user_id=eq.${authUser.id}` },
          (payload) => {
            if (!alive) return;
            if (trafficPaused) return;

            const row = payload.new as TrafficLogRow;
            const evt = toTrafficEvent(row);

            const key = makeTrafficKey(evt);
            if (trafficSeenRef.current.has(key)) return;
            trafficSeenRef.current.add(key);

            setTraffic((prev) => [evt, ...prev].slice(0, trafficLimit));
          }
        )
        .subscribe();
    };

    void start();

    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [activeTab, trafficPaused, trafficLimit, toTrafficEvent]);

  // --------- ✅ Traffic events handler (from VideoPlayer) ----------
  const handleTrafficEvent = useCallback(
    async (evt: { ts?: number; streamId: string; streamName: string; type: TrafficEventType; message: string; severity?: TrafficSeverity }) => {
      const ts = evt.ts ?? Date.now();
      const severity = evt.severity ?? "info";

      const stream = streams.find((s) => s.id === evt.streamId);
      const streamUrl = stream?.url ?? null;

      // 1) Push to UI
      if (!trafficPaused) {
        const uiEvt: TrafficEvent = { ts, streamId: evt.streamId, streamName: evt.streamName, streamUrl: streamUrl ?? undefined, type: evt.type, message: evt.message, severity };
        const key = makeTrafficKey(uiEvt);
        if (!trafficSeenRef.current.has(key)) {
          trafficSeenRef.current.add(key);
          setTraffic((prev) => [uiEvt, ...prev].slice(0, trafficLimit));
        }
      }

      // 2) Best-effort DB logging (buffered)
      try {
        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData?.user;

        trafficBufferRef.current.push({
          user_id: authUser?.id ?? "",
          stream_id: evt.streamId,
          stream_name: evt.streamName,
          stream_url: streamUrl,
          type: evt.type,
          severity,
          message: evt.message,
        });

        if (trafficBufferRef.current.length >= 200) void flushTrafficBuffer();
      } catch {
        // ignore
      }
    },
    [streams, trafficPaused, trafficLimit, flushTrafficBuffer]
  );

  // --------- Add stream ----------
  const addStream = useCallback(async () => {
    const urlToAdd = safeTrim(streamUrl);
    if (!urlToAdd || !isValidStreamUrl(urlToAdd)) {
      toast({
        title: "Invalid Stream URL",
        description: "Enter a valid HLS (.m3u8) URL (RTMP/RTSP/UDP need backend).",
        variant: "destructive",
      });
      return;
    }

    if (streams.length >= 12) {
      toast({ title: "Limit Reached", description: "You can add up to 12 streams", variant: "destructive" });
      return;
    }

    const normalized = normalizeUrl(urlToAdd);
    if (streams.some((s) => normalizeUrl(s.url) === normalized)) {
      toast({ title: "Duplicate Stream", description: "This stream URL is already added", variant: "destructive" });
      return;
    }

    const nameToAdd = safeTrim(streamName) || `Stream ${streams.length + 1}`;
    const color = streamColors[streams.length % streamColors.length];

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
      return;
    }

    const { data, error } = await supabase
      .from("streams")
      .insert({ user_id: authUser.id, name: nameToAdd, url: urlToAdd, color })
      .select("id, name, url, color")
      .single();

    if (error) {
      toast({ title: "Failed to save stream", description: error.message, variant: "destructive" });
      return;
    }

    const inserted: Stream = { id: data.id, name: data.name, url: data.url, color: data.color || color };

    setStreams((prev) => [...prev, inserted]);
    setStreamName("");
    setStreamUrl("");

    toast({ title: "Stream Added", description: `(${streams.length + 1}/12)` });

    void logActivity({
      action: "add_stream",
      target_type: "stream",
      target_id: inserted.id,
      target_name: inserted.name,
      description: "Stream added",
    });
  }, [streamUrl, streams, streamName, toast, logActivity]);

  // --------- Save list to file ----------
  const saveListToFile = useCallback(() => {
    const listName = prompt("Enter a name for your stream list:");
    if (!listName || listName.trim() === "") return;

    const name = listName.trim();
    const content = `ListName:${name}\n` + streams.map((s) => `${s.name};${s.url}`).join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: "List Saved", description: `Saved '${name}.txt'` });

    void logActivity({
      action: "save_list",
      target_type: "list",
      target_name: name,
      description: "List saved (downloaded)",
    });
  }, [streams, toast, logActivity]);

  // --------- Load list from file ----------
  const loadListFromFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

        const streamLines = lines[0]?.startsWith("ListName:") ? lines.slice(1) : lines;

        const parsed = streamLines
          .map((line, idx) => {
            const parts = line.split(";");
            const name = (parts.length >= 2 ? parts[0] : `Stream ${idx + 1}`).trim();
            const url = (parts.length >= 2 ? parts[1] : parts[0]).trim();
            return { name, url };
          })
          .filter((s) => s.url && isValidStreamUrl(s.url));

        if (parsed.length === 0) {
          toast({ title: "No valid streams found in file", variant: "destructive" });
          return;
        }

        const { data: authData } = await supabase.auth.getUser();
        const authUser = authData?.user;
        if (!authUser) {
          toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
          return;
        }

        const room = Math.max(0, 12 - streams.length);
        const toInsert = parsed.slice(0, room);

        const existing = new Set(streams.map((s) => normalizeUrl(s.url)));
        const uniqueToInsert = toInsert.filter((s) => !existing.has(normalizeUrl(s.url)));

        if (uniqueToInsert.length === 0) {
          toast({ title: "Nothing imported", description: "All streams already exist." });
          return;
        }

        const rows = uniqueToInsert.map((s, i) => ({
          user_id: authUser.id,
          name: s.name,
          url: s.url,
          color: streamColors[(streams.length + i) % streamColors.length],
        }));

        const { data, error } = await supabase.from("streams").insert(rows).select("id, name, url, color");

        if (error) {
          toast({ title: "Failed to import list", description: error.message, variant: "destructive" });
          return;
        }

        const inserted: Stream[] = (data || []).map((r: any, idx: number) => ({
          id: r.id,
          name: r.name,
          url: r.url,
          color: r.color || streamColors[(streams.length + idx) % streamColors.length],
        }));

        setStreams((prev) => [...prev, ...inserted]);
        toast({ title: "List loaded", description: `Imported ${inserted.length} streams.` });

        void logActivity({
          action: "load_list",
          target_type: "list",
          target_name: file.name,
          description: `List loaded from file (${inserted.length} streams imported)`,
        });
      } finally {
        event.target.value = "";
      }
    },
    [streams, toast, logActivity]
  );

  // --------- Download bitrate CSV ----------
  const downloadBitrateCsv = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
      return;
    }

    const sinceIso = getSinceIso(downloadRange);

    let q = supabase.from("bitrate_logs").select("created_at, stream_name, stream_url, bitrate_mbps").eq("user_id", authUser.id).order("created_at", { ascending: true });
    if (sinceIso) q = q.gte("created_at", sinceIso);

    const { data, error } = await q;

    if (error) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
      return;
    }

    const rows = (data || []) as Array<{ created_at: string; stream_name: string; stream_url: string; bitrate_mbps: number }>;
    if (rows.length === 0) {
      toast({ title: "No bitrate logs", description: "No data for the selected range." });
      return;
    }

    const header = ["created_at", "stream_name", "stream_url", "bitrate"];
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv =
      header.join(",") +
      "\n" +
      rows.map((r) => [r.created_at, r.stream_name, r.stream_url, formatMbps(Number(r.bitrate_mbps ?? 0))].map(escape).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitrate_logs_${makeRangeLabel(downloadRange)}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    void logActivity({ action: "download_bitrate_csv", target_type: "bitrate_logs", target_name: makeRangeLabel(downloadRange), description: "Downloaded bitrate CSV" });
  }, [downloadRange, toast, logActivity]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void addStream();
  };

  const gridClass =
    gridLayout === "3-2"
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      : gridLayout === "4-2"
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      : gridLayout === "6-2"
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-6"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";

  const latestTotalBitrate = useMemo(() => {
    if (!allBitrateHistory.length) return 0;
    const latest = allBitrateHistory[allBitrateHistory.length - 1];
    let total = 0;
    streams.forEach((s) => {
      const v = latest[s.id];
      if (typeof v === "number" && isFinite(v)) total += v;
    });
    return Math.round(total * 100) / 100;
  }, [allBitrateHistory, streams]);

  const filteredTraffic = useMemo(() => {
    return traffic.filter((t) => {
      if (trafficTypeFilter !== "ALL" && t.type !== trafficTypeFilter) return false;
      if (trafficSeverityFilter !== "ALL" && t.severity !== trafficSeverityFilter) return false;
      if (trafficStreamFilter !== "ALL" && t.streamId !== trafficStreamFilter) return false;
      return true;
    });
  }, [traffic, trafficTypeFilter, trafficSeverityFilter, trafficStreamFilter]);

  return (
    <div className="space-y-6 p-2">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        {/* Header */}
        <div className="space-y-6 mt-[-10px]">
          <div className="flex items-center justify-start space-x-3 mb-2">
            <img src="/logo.png" alt="StreamWall Logo" className="h-14 w-14 mt-[-8px]" />
            <div>
              <h1 className="text-4xl font-bold bg-gradient-primary text-justify bg-clip-text text-white">StreamWall</h1>
              <p className="text-muted-foreground text-justify">All Streams. One Wall.</p>
              <p className="text-xs text-muted-foreground text-justify">Dev. By TMC MCR</p>
            </div>
          </div>
        </div>

        {/* Welcome + Email */}
        <div className="flex items-center gap-4">
          <div className="text-left">
            <div className="text-3xl font-semibold text-foreground mt-[-2px]">{currentTime.toLocaleTimeString([], { hour12: false })}</div>
            <div className="text-sm text-muted-foreground">{currentTime.toISOString().slice(0, 10)}</div>

            {!!user && (
              <div className="mt-1">
                <div className="text-sm text-muted-foreground">
                  Welcome, <span className="text-foreground font-semibold">{user.username}</span>
                </div>
                {userEmail && (
                  <div className="text-xs text-muted-foreground">
                    Email: <span className="font-mono">{userEmail}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Add Stream Form */}
        <div className="lg:w-3/5 pt-3">
          <Card className="bg-transparent-card border-none shadow-none w-full lg:w-auto">
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    id="stream-name"
                    type="text"
                    placeholder="Stream Name"
                    value={streamName}
                    onChange={(e) => setStreamName(e.target.value)}
                    className="w-1/4 bg-input border-stream-border focus:ring-primary"
                  />

                  <Input
                    id="stream-url"
                    type="url"
                    placeholder="Enter a stream URL : HTTP HLS (.m3u8)."
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    onKeyDown={handleKeyPress}
                    className="w-3/5 bg-input border-stream-border focus:ring-primary"
                  />
                </div>
              </div>

              {/* MENU */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button onClick={() => void addStream()} disabled={streams.length >= 12} className="bg-gradient-primary hover:shadow-glow transition-all">
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>

                <Button onClick={saveListToFile} variant="outline" disabled={streams.length === 0}>
                  <Save className="h-4 w-4 mr-2" /> Save List
                </Button>

                {/* LOAD LIST */}
                <label htmlFor="load-list-file" className="inline-block">
                  <input id="load-list-file" type="file" accept=".txt" style={{ display: "none" }} onChange={loadListFromFile} />
                  <Button asChild variant="outline">
                    <span>Load List</span>
                  </Button>
                </label>

                {/* Select range + Download bitrate CSV */}
                <div className="flex items-center gap-2">
                  <Select value={downloadRange} onValueChange={(v) => setDownloadRange(v as DownloadRange)}>
                    <SelectTrigger className="w-[200px] bg-input border-stream-border">
                      <SelectValue placeholder="Download range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1h">Last 1 hour</SelectItem>
                      <SelectItem value="24h">Last 24 hours</SelectItem>
                      <SelectItem value="all">All time</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button onClick={() => void downloadBitrateCsv()} variant="outline">
                    <Download className="h-4 w-4 mr-2" /> Download Bitrate CSV
                  </Button>
                </div>

                <div className="flex items-center ml-auto gap-2">
                  <label className="mr-2 text-sm text-muted-foreground">Grid:</label>
                  <Select value={gridLayout} onValueChange={(v) => setGridLayout(v as any)}>
                    <SelectTrigger className="w-[140px] bg-input border-stream-border">
                      <SelectValue placeholder="Layout" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3-2">3 columns</SelectItem>
                      <SelectItem value="4-2">4 columns</SelectItem>
                      <SelectItem value="6-2">6 columns</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button variant="outline" size="icon" onClick={() => setManagementOpen(true)} title="User Management">
                  <Settings className="h-4 w-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  title="Logout"
                  onClick={async () => {
                    void logActivity({ action: "logout", description: "User logged out" });
                    await logout();
                    window.location.href = "/login";
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ManagementDialog isOpen={isManagementOpen} onClose={() => setManagementOpen(false)} onStreamsChanged={() => void loadStreamsFromDb()} />

      {/* Stream Grid */}
      <div className="lg:col-span-3">
        {streams.length === 0 ? (
          <Card className="bg-gradient-card border-stream-border">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No streams active</h3>
              <p className="text-muted-foreground max-w-md">Add your first HLS (.m3u8) URL above to start monitoring. Supports up to 12 concurrent streams.</p>
            </CardContent>
          </Card>
        ) : (
          <div className={`grid ${gridClass} gap-2`}>
            {streams.map((stream) => (
              <div key={stream.id} className="relative">
                <div className="absolute bottom-2 right-2 z-20 flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setReloadSignals((rs) => ({ ...rs, [stream.id]: (rs[stream.id] || 0) + 1 }))}
                    title="Reload this stream"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>

                <VideoPlayer
                  streamId={stream.id}
                  streamName={stream.name}
                  streamUrl={stream.url}
                  reloadSignal={reloadSignals[stream.id] || 0}
                  onBitrateUpdate={(id, br) => void handleBitrateUpdate(id, br)}
                  onTrafficEvent={(evt) => void handleTrafficEvent(evt)}
                  status={(failureCounts[stream.id] || 0) === 0 ? "online" : "offline"}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ✅ Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="bitrate">Bitrate Real-time</TabsTrigger>
            <TabsTrigger value="traffic">Traffic Logs</TabsTrigger>
            <TabsTrigger value="logs">Activity Logs</TabsTrigger>
          </TabsList>

          {activeTab === "logs" && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Logs:</Label>
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={String(logsLimit)} onChange={(e) => setLogsLimit(Number(e.target.value) as any)}>
                <option value="50">Last 50</option>
                <option value="200">Last 200</option>
                <option value="500">Last 500</option>
              </select>

              <Button variant="outline" size="sm" onClick={() => void fetchLogs()}>
                Refresh
              </Button>
            </div>
          )}

          {activeTab === "traffic" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void fetchTrafficFromDb()}>
                Refresh
              </Button>

              <Button variant="outline" size="sm" onClick={() => setTrafficPaused((p) => !p)}>
                {trafficPaused ? "Resume" : "Pause"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTraffic([]);
                  trafficSeenRef.current = new Set();
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </div>

        {/* ✅ Bitrate Tab */}
        <TabsContent value="bitrate">
          {streams.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-2xl font-bold text-white">Real-time Bitrate Monitor:</h2>
                  <span className="text-lg font-semibold text-blue-500">{latestTotalBitrate.toFixed(2)} Mbps</span>
                </div>

                <Select value={selectedGraphStream} onValueChange={setSelectedGraphStream}>
                  <SelectTrigger className="w-[240px] bg-input border-stream-border">
                    <SelectValue placeholder="Select a stream to display" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Streams</SelectItem>
                    {streams.map((stream) => (
                      <SelectItem key={stream.id} value={stream.id}>
                        <div className="flex items-center">
                          <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: stream.color }} />
                          {stream.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Card className="bg-gradient-card border-stream-border">
                <CardContent className="pt-2">
                  <React.Suspense
                    fallback={
                      <div style={{ height: 600, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa" }}>
                        Loading chart…
                      </div>
                    }
                  >
                    <AllBitrateGraph
                      data={allBitrateHistory}
                      streams={selectedGraphStream === "all" ? streams : streams.filter((s) => s.id === selectedGraphStream)}
                      timeDomain={[currentTime.getTime() - 24 * 60 * 60 * 1000, currentTime.getTime()]}
                      height={600}
                    />
                  </React.Suspense>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ✅ Traffic Logs Tab */}
        <TabsContent value="traffic">
          <section className="rounded-xl border p-4 mt-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Traffic Logs (Real-time)</h3>
                  <p className="text-xs text-muted-foreground">Issues: No Signal / Frozen / Black / Silent / Buffering / Error — newest first</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Showing <span className="font-semibold">{filteredTraffic.length}</span> / {traffic.length}
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-2 items-center">
                <Label className="text-xs text-muted-foreground">Type:</Label>
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={trafficTypeFilter} onChange={(e) => setTrafficTypeFilter(e.target.value as any)}>
                  <option value="ALL">All</option>
                  <option value="NO_SIGNAL">No Signal</option>
                  <option value="FROZEN">Frozen</option>
                  <option value="BLACK">Black</option>
                  <option value="SILENT">Silent</option>
                  <option value="BUFFERING">Buffering</option>
                  <option value="RECOVERED">Recovered</option>
                  <option value="ERROR">Error</option>
                </select>

                <Label className="text-xs text-muted-foreground">Severity:</Label>
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={trafficSeverityFilter} onChange={(e) => setTrafficSeverityFilter(e.target.value as any)}>
                  <option value="ALL">All</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="critical">Critical</option>
                </select>

                <Label className="text-xs text-muted-foreground">Stream:</Label>
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={trafficStreamFilter} onChange={(e) => setTrafficStreamFilter(e.target.value)}>
                  <option value="ALL">All</option>
                  {streams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <Label className="text-xs text-muted-foreground">Keep:</Label>
                <select className="h-9 rounded-md border bg-background px-3 text-sm" value={String(trafficLimit)} onChange={(e) => setTrafficLimit(Number(e.target.value))}>
                  <option value="200">200</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>

                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setTrafficPaused((p) => !p)}>
                    {trafficPaused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTraffic([]);
                      trafficSeenRef.current = new Set();
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[190px]">Time</TableHead>
                    <TableHead className="w-[140px]">Severity</TableHead>
                    <TableHead className="w-[160px]">Type</TableHead>
                    <TableHead className="w-[240px]">Stream</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filteredTraffic.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                        No traffic events yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTraffic.map((t, idx) => (
                      <TableRow key={`${t.ts}-${t.streamId}-${idx}`}>
                        <TableCell className="text-xs font-mono">{formatDateTime(t.ts)}</TableCell>
                        <TableCell className="text-sm font-semibold">{t.severity}</TableCell>
                        <TableCell className="text-sm font-semibold">{trafficTypeLabel(t.type)}</TableCell>
                        <TableCell className="text-sm">
                          {t.streamName}
                          <div className="text-xs text-muted-foreground font-mono truncate max-w-[240px]">{t.streamUrl ?? ""}</div>
                        </TableCell>
                        <TableCell className="text-sm">{t.message}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>

        {/* ✅ Activity Logs Tab */}
        <TabsContent value="logs">
          <section className="rounded-xl border p-4 mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Activity Logs</h3>
                <p className="text-xs text-muted-foreground">Timeline style (Table Format) — {logsRangeLabel}</p>
              </div>
              {logsLoading && <span className="text-sm text-muted-foreground">Loading…</span>}
            </div>

            <div className="mt-3 rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[190px]">Time</TableHead>
                    <TableHead className="w-[220px]">User</TableHead>
                    <TableHead className="w-[180px]">Action</TableHead>
                    <TableHead className="w-[220px]">Target</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">
                        No activity logs yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs font-mono">{formatDateTime(l.created_at)}</TableCell>
                        <TableCell className="text-sm">{l.actor_email || "unknown"}</TableCell>
                        <TableCell className="text-sm font-semibold">{actionLabel(l.action)}</TableCell>
                        <TableCell className="text-sm">{(l.target_type || "—") + (l.target_name ? ` — ${l.target_name}` : "")}</TableCell>
                        <TableCell className="text-sm">{l.description || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StreamManager;
