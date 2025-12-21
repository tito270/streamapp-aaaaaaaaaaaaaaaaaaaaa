import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "./VideoPlayer";
import {
  RotateCcw,
  Plus,
  Monitor,
  History,
  Save,
  LogOut,
  Settings,
  Download,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AllBitrateGraph = React.lazy(() => import("./ui/AllBitrateGraph"));

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { getUser, logout, UserPayload } from "@/lib/auth";
import ManagementDialog from "./ManagementDialog";
import { supabase } from "@/integrations/supabase/client";

/* ================= Types ================= */

type DbStreamRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  resolution: string | null;
  color: string | null;
};

interface Stream {
  id: string;
  name: string;
  url: string;
  color: string;
  resolution: string;
}

interface AllBitrateDataPoint {
  time: number;
  [streamId: string]: number | null;
}

type BitrateLogRow = {
  user_id: string;
  stream_id: string;
  stream_name: string;
  stream_url: string;
  bitrate_mbps: number;
  created_at?: string;
};

/* ================= Constants ================= */

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

// Optional API base (used silently if exists)
const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

/* ================= Component ================= */

export const StreamManager: React.FC = () => {
  const { toast } = useToast();

  const [user, setUser] = useState<UserPayload | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamName, setStreamName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [resolution, setResolution] = useState("480p");

  const [currentTime, setCurrentTime] = useState(new Date());
  const [gridLayout, setGridLayout] = useState<"3-2" | "4-2" | "6-2">("4-2");

  const [allBitrateHistory, setAllBitrateHistory] = useState<AllBitrateDataPoint[]>([]);
  const [reloadSignals, setReloadSignals] = useState<Record<string, number>>({});
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});

  const [selectedGraphStream, setSelectedGraphStream] = useState("all");
  const [allLogFiles, setAllLogFiles] = useState<{ stream: string; file: string; path: string }[]>([]);
  const [isManagementOpen, setManagementOpen] = useState(false);

  /* ================= Helpers ================= */

  const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/$/, "");
  const sanitizeFilename = (name: string) => String(name || "").replace(/[<>:"/\\|?*]/g, "_");

  const isValidStreamUrl = (url: string) => {
    const u = url.toLowerCase();
    return (
      u.startsWith("http://") ||
      u.startsWith("https://") ||
      u.startsWith("rtmp://") ||
      u.startsWith("rtsp://") ||
      u.startsWith("udp://") ||
      u.includes(".m3u8")
    );
  };

  /* ================= Auth ================= */

  useEffect(() => {
    setUser(getUser());
  }, []);

  /* ================= Clock ================= */

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ================= Load Streams ================= */

  const loadStreamsFromDb = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return;

    const { data, error } = await supabase
      .from("streams")
      .select("id, name, url, resolution, color")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Failed to load streams", description: error.message, variant: "destructive" });
      return;
    }

    setStreams(
      (data || []).map((row: DbStreamRow, i) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        resolution: row.resolution || "480p",
        color: row.color || streamColors[i % streamColors.length],
      }))
    );
  }, [toast]);

  useEffect(() => {
    void loadStreamsFromDb();
  }, [loadStreamsFromDb]);

  /* ================= Optional Server Logs ================= */

  useEffect(() => {
    if (!API_BASE) return;

    let mounted = true;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/logs/all-files`);
        if (!mounted) return;
        if (res.ok) setAllLogFiles(await res.json());
      } catch {
        if (mounted) setAllLogFiles([]);
      }
    };

    fetchLogs();
    const id = setInterval(fetchLogs, 10000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  /* ================= Bitrate Handling ================= */

  const bitrateBufferRef = useRef<BitrateLogRow[]>([]);
  const lastWriteAtRef = useRef(0);

  const flushBitrateBuffer = useCallback(async () => {
    if (Date.now() - lastWriteAtRef.current < 2500) return;
    const batch = bitrateBufferRef.current.splice(0, 500);
    if (!batch.length) return;
    lastWriteAtRef.current = Date.now();
    await supabase.from("bitrate_logs").insert(batch);
  }, []);

  const handleBitrateUpdate = useCallback(
    async (streamId: string, bitrate: number | null) => {
      const now = Date.now();
      setAllBitrateHistory((prev) => [...prev, { time: now, [streamId]: bitrate || 0 }]);
      setFailureCounts((p) => ({ ...p, [streamId]: bitrate ? 0 : (p[streamId] || 0) + 1 }));

      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const s = streams.find((x) => x.id === streamId);
      if (!s) return;

      bitrateBufferRef.current.push({
        user_id: auth.user.id,
        stream_id: s.id,
        stream_name: s.name,
        stream_url: s.url,
        bitrate_mbps: bitrate || 0,
      });

      if (bitrateBufferRef.current.length > 200) void flushBitrateBuffer();
    },
    [streams, flushBitrateBuffer]
  );

  /* ================= Add / Remove ================= */

  const addStream = useCallback(async () => {
    if (!isValidStreamUrl(streamUrl)) {
      toast({ title: "Invalid URL", variant: "destructive" });
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;

    const { data, error } = await supabase
      .from("streams")
      .insert({
        user_id: auth.user.id,
        name: streamName || `Stream ${streams.length + 1}`,
        url: streamUrl,
        resolution,
        color: streamColors[streams.length % streamColors.length],
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Failed to add stream", description: error.message, variant: "destructive" });
      return;
    }

    setStreams((p) => [...p, data as Stream]);
    setStreamName("");
    setStreamUrl("");
  }, [streamUrl, streamName, resolution, streams, toast]);

  const removeStream = async (id: string) => {
    await supabase.from("streams").delete().eq("id", id);
    setStreams((p) => p.filter((s) => s.id !== id));
  };

  /* ================= UI ================= */

  const gridClass =
    gridLayout === "3-2"
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      : gridLayout === "6-2"
      ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-6"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";

  const latestTotalBitrate = useMemo(() => {
    if (!allBitrateHistory.length) return 0;
    const latest = allBitrateHistory.at(-1)!;
    return streams.reduce((t, s) => t + (latest[s.id] || 0), 0);
  }, [allBitrateHistory, streams]);

  return (
    <div className="space-y-6 p-2">
      {/* Header */}
      <div className="flex justify-between">
        <h1 className="text-3xl font-bold">StreamWall</h1>
        <span>{currentTime.toLocaleTimeString()}</span>
      </div>

      {/* Add Stream */}
      <div className="flex gap-2">
        <Input value={streamName} onChange={(e) => setStreamName(e.target.value)} placeholder="Name" />
        <Input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="URL" />
        <Button onClick={addStream}><Plus className="w-4 h-4" /></Button>
      </div>

      {/* Streams */}
      <div className={`grid ${gridClass} gap-2`}>
        {streams.map((s) => (
          <VideoPlayer
            key={s.id}
            streamId={s.id}
            streamName={s.name}
            streamUrl={s.url}
            resolution={s.resolution}
            onResolutionChange={() => {}}
            onRemove={() => removeStream(s.id)}
            reloadSignal={reloadSignals[s.id]}
            onBitrateUpdate={handleBitrateUpdate}
            status={(failureCounts[s.id] || 0) === 0 ? "online" : "offline"}
          />
        ))}
      </div>

      {/* Graph */}
      {streams.length > 0 && (
        <React.Suspense fallback={<div>Loading chart…</div>}>
          <AllBitrateGraph
            data={allBitrateHistory}
            streams={streams}
            timeDomain={[Date.now() - 86400000, Date.now()]}
            height={500}
          />
        </React.Suspense>
      )}

      <ManagementDialog isOpen={isManagementOpen} onClose={() => setManagementOpen(false)} />
    </div>
  );
};
