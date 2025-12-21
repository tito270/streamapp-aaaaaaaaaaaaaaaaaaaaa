import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { RotateCcw, Plus, Monitor, History, Save, LogOut, Settings, Download } from "lucide-react";

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

const streamColors = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#387908", "#ff0000",
  "#0088fe", "#00c49f", "#ffbb28", "#ff8042", "#00cfff", "#ff00ff",
];

type BitrateLogRow = {
  user_id: string;
  stream_id: string;
  stream_name: string;
  stream_url: string;
  bitrate_mbps: number;
  created_at?: string;
};

export const StreamManager: React.FC = () => {
  const API_BASE =
    (import.meta.env.VITE_API_BASE?.replace(/\/+$/, "")) ||
    `${window.location.protocol}//${window.location.hostname}:3001`;

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

  const [selectedGraphStream, setSelectedGraphStream] = useState<string>("all");
  const [allLogFiles, setAllLogFiles] = useState<{ stream: string; file: string; path: string }[]>([]);
  const [isManagementOpen, setManagementOpen] = useState(false);

  const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/$/, "");
  const sanitizeFilename = (name: string) => String(name || "").replace(/[<>:"/\\|?*]/g, "_");

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
    const id = setInterval(() => { void flushBitrateBuffer(); }, 5000);
    return () => clearInterval(id);
  }, [flushBitrateBuffer]);

  useEffect(() => {
    const handler = () => { void flushBitrateBuffer(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [flushBitrateBuffer]);

  // --------- Auth user ----------
  useEffect(() => {
    setUser(getUser());
  }, []);

  // --------- Clock ----------
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // --------- URL validation ----------
  const isValidStreamUrl = (url: string): boolean => {
    const lowerUrl = url.trim().toLowerCase();
    return (
      lowerUrl.startsWith("http://") ||
      lowerUrl.startsWith("https://") ||
      lowerUrl.startsWith("rtmp://") ||
      lowerUrl.startsWith("rtsp://") ||
      lowerUrl.startsWith("udp://") ||
      lowerUrl.includes(".m3u8")
    );
  };

  // --------- Load streams from DB ----------
  const loadStreamsFromDb = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) return;

    const { data, error } = await supabase
      .from("streams")
      .select("id, user_id, name, url, resolution, color")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Failed to load streams", description: error.message, variant: "destructive" });
      return;
    }

    const mapped: Stream[] = (data || []).map((row: DbStreamRow, idx: number) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      resolution: row.resolution || "480p",
      color: row.color || streamColors[idx % streamColors.length],
    }));

    setStreams(mapped);

    // ✅ force immediate play for all streams on load
    setReloadSignals(prev => {
      const next = { ...prev };
      mapped.forEach(s => (next[s.id] = (next[s.id] || 0) + 1));
      return next;
    });
  }, [toast]);

  useEffect(() => {
    void loadStreamsFromDb();
  }, [loadStreamsFromDb]);

  // --------- Server logs (optional) ----------
  useEffect(() => {
    let mounted = true;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/logs/all-files`);
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          setAllLogFiles(Array.isArray(data) ? data : []);
        } else {
          setAllLogFiles([]);
        }
      } catch {
        if (mounted) setAllLogFiles([]);
      }
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 10_000);
    return () => { mounted = false; clearInterval(id); };
  }, [API_BASE]);

  // --------- Bitrate updates (graph + DB) ----------
  const handleBitrateUpdate = useCallback(
    async (streamId: string, bitrate: number | null) => {
      const now = Date.now();
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      setAllBitrateHistory(prev => {
        const lastPoint = prev.length ? prev[prev.length - 1] : null;
        const newPoint: AllBitrateDataPoint = { time: now };

        streams.forEach(s => {
          if (s.id === streamId) newPoint[s.id] = typeof bitrate === "number" ? bitrate : 0;
          else if (lastPoint && lastPoint[s.id] !== undefined) newPoint[s.id] = lastPoint[s.id] as number;
          else newPoint[s.id] = 0;
        });

        return [...prev, newPoint].filter(p => p.time >= twentyFourHoursAgo);
      });

      setFailureCounts(prev => {
        const cur = prev[streamId] || 0;
        if (typeof bitrate === "number" && bitrate > 0) return { ...prev, [streamId]: 0 };
        return { ...prev, [streamId]: cur + 1 };
      });

      // buffer -> supabase
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) return;

      const stream = streams.find(s => s.id === streamId);
      if (!stream) return;

      const v = typeof bitrate === "number" ? bitrate : 0;

      bitrateBufferRef.current.push({
        user_id: authUser.id,
        stream_id: stream.id,
        stream_name: stream.name,
        stream_url: stream.url,
        bitrate_mbps: v,
      });

      if (bitrateBufferRef.current.length >= 200) {
        void flushBitrateBuffer();
      }
    },
    [streams, flushBitrateBuffer]
  );

  // --------- Add stream (DB + immediate play) ----------
  const addStream = useCallback(async () => {
    const urlToAdd = streamUrl.trim();
    if (!urlToAdd || !isValidStreamUrl(urlToAdd)) {
      toast({
        title: "Invalid Stream URL",
        description: "Enter a valid HLS (.m3u8), RTMP, RTSP, HTTP, or UDP URL",
        variant: "destructive",
      });
      return;
    }

    if (streams.length >= 12) {
      toast({ title: "Limit Reached", description: "You can add up to 12 streams", variant: "destructive" });
      return;
    }

    const normalized = normalizeUrl(urlToAdd);
    if (streams.some(s => normalizeUrl(s.url) === normalized)) {
      toast({ title: "Duplicate Stream", description: "This stream URL is already added", variant: "destructive" });
      return;
    }

    const nameToAdd = streamName.trim() || `Stream ${streams.length + 1}`;
    const color = streamColors[streams.length % streamColors.length];

    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
      return;
    }

    const { data, error } = await supabase
      .from("streams")
      .insert({
        user_id: authUser.id,
        name: nameToAdd,
        url: urlToAdd,
        resolution,
        color,
      })
      .select("id, name, url, resolution, color")
      .single();

    if (error) {
      toast({ title: "Failed to save stream", description: error.message, variant: "destructive" });
      return;
    }

    const inserted: Stream = {
      id: data.id,
      name: data.name,
      url: data.url,
      resolution: data.resolution || resolution,
      color: data.color || color,
    };

    setStreams(prev => [...prev, inserted]);

    // ✅ FORCE immediate play for this new stream
    setReloadSignals(prev => ({ ...prev, [inserted.id]: (prev[inserted.id] || 0) + 1 }));

    setStreamName("");
    setStreamUrl("");
    toast({ title: "Stream Added", description: `(${streams.length + 1}/12)` });
  }, [streamUrl, streams, streamName, resolution, toast]);

  // --------- Remove stream ----------
  const removeStream = useCallback(async (streamId: string) => {
    const { error } = await supabase.from("streams").delete().eq("id", streamId);
    if (error) {
      toast({ title: "Failed to delete stream", description: error.message, variant: "destructive" });
      return;
    }

    setStreams(prev => prev.filter(s => s.id !== streamId));
    setAllBitrateHistory(prev => {
      const cleaned = prev.map(p => {
        const np = { ...p };
        delete np[streamId];
        return np;
      });
      return cleaned.filter(p => Object.keys(p).length > 1);
    });

    toast({ title: "Stream Removed" });
  }, [toast]);

  // --------- Save list to file ----------
  const saveListToFile = () => {
    const listName = prompt("Enter a name for your stream list:");
    if (!listName || listName.trim() === "") return;

    const content =
      `ListName:${listName.trim()}\n` +
      streams.map(s => `${s.name};${s.url}`).join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${listName.trim()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: "List Saved", description: `Saved '${listName.trim()}.txt'` });
  };

  // ✅ Load list from local machine + import into DB + immediate play
  const loadListFromFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      const streamLines = lines[0]?.startsWith("ListName:") ? lines.slice(1) : lines;

      const parsed = streamLines
        .map((line, idx) => {
          const parts = line.split(";");
          const name = (parts.length >= 2 ? parts[0] : `Stream ${idx + 1}`).trim();
          const url = (parts.length >= 2 ? parts[1] : parts[0]).trim();
          return { name, url };
        })
        .filter(s => s.url && isValidStreamUrl(s.url));

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

      // avoid duplicates vs existing streams
      const existing = new Set(streams.map(s => normalizeUrl(s.url)));
      const uniqueToInsert = toInsert.filter(s => !existing.has(normalizeUrl(s.url)));

      if (uniqueToInsert.length === 0) {
        toast({ title: "Nothing imported", description: "All streams already exist." });
        return;
      }

      const rows = uniqueToInsert.map((s, i) => ({
        user_id: authUser.id,
        name: s.name,
        url: s.url,
        resolution,
        color: streamColors[(streams.length + i) % streamColors.length],
      }));

      const { data, error } = await supabase
        .from("streams")
        .insert(rows)
        .select("id, name, url, resolution, color");

      if (error) {
        toast({ title: "Failed to import list", description: error.message, variant: "destructive" });
        return;
      }

      const inserted: Stream[] = (data || []).map((r: any, idx: number) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        resolution: r.resolution || resolution,
        color: r.color || streamColors[(streams.length + idx) % streamColors.length],
      }));

      setStreams(prev => [...prev, ...inserted]);

      // ✅ immediate play for imported streams
      setReloadSignals(prev => {
        const next = { ...prev };
        inserted.forEach(s => (next[s.id] = (next[s.id] || 0) + 1));
        return next;
      });

      toast({ title: "List loaded", description: `Imported ${inserted.length} streams.` });
    } finally {
      event.target.value = "";
    }
  }, [streams, resolution, toast]);

  // --------- Download bitrate CSV (last 24h) ----------
  const downloadBitrateCsv = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "destructive" });
      return;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("bitrate_logs")
      .select("created_at, stream_name, stream_url, bitrate_mbps")
      .eq("user_id", authUser.id)
      .gte("created_at", since)
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Download failed", description: error.message, variant: "destructive" });
      return;
    }

    const rows = (data || []) as Array<{
      created_at: string;
      stream_name: string;
      stream_url: string;
      bitrate_mbps: number;
    }>;

    if (rows.length === 0) {
      toast({ title: "No bitrate logs", description: "No data in the last 24 hours." });
      return;
    }

    const header = ["created_at", "stream_name", "stream_url", "bitrate_mbps"];
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const csv =
      header.join(",") +
      "\n" +
      rows.map(r => [r.created_at, r.stream_name, r.stream_url, String(r.bitrate_mbps)].map(escape).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bitrate_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [toast]);

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
    streams.forEach(s => {
      const v = latest[s.id];
      if (typeof v === "number" && isFinite(v)) total += v;
    });
    return Math.round(total * 100) / 100;
  }, [allBitrateHistory, streams]);

  const downloadItems = useMemo(() => {
    const items: { key: string; label: string; filename: string }[] = [];
    for (const log of allLogFiles) {
      const stream = streams.find(s => sanitizeFilename(s.name) === log.stream);
      const streamId = stream ? stream.id : log.stream;
      items.push({ key: streamId, label: `${log.file}`, filename: log.file });
    }
    return items;
  }, [allLogFiles, streams]);

  return (
    <div className="space-y-6 p-2">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        {/* Header */}
        <div className="space-y-6 mt-[-10px]">
          <div className="flex items-center justify-start space-x-3 mb-2">
            <img src="/logo.png" alt="StreamWall Logo" className="h-14 w-14 mt-[-8px]" />
            <div>
              <h1 className="text-4xl font-bold bg-gradient-primary text-justify bg-clip-text text-white">
                StreamWall
              </h1>
              <p className="text-muted-foreground text-justify">All Streams. One Wall.</p>
              <p className="text-xs text-muted-foreground text-justify">Dev. By TMC MCR</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <p className="text-3xl font-semibold text-foreground mt-[-2px]">
            {currentTime.toLocaleTimeString([], { hour12: false })}
            <p>{currentTime.toISOString().slice(0, 10)}</p>
            {user && <span className="text-sm text-muted-foreground">Welcome, {user.username}</span>}
          </p>
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
                    placeholder="Enter a stream URL : HTTP HLS (.m3u8), RTMP, RTSP or UDP."
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    onKeyDown={handleKeyPress}
                    className="w-3/5 bg-input border-stream-border focus:ring-primary"
                  />

                  <Select value={resolution} onValueChange={setResolution}>
                    <SelectTrigger className="w-[120px] bg-input border-stream-border">
                      <SelectValue placeholder="Ratio" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="480p">480p</SelectItem>
                      <SelectItem value="720p">720p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* MENU */}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <Button
                  onClick={() => void addStream()}
                  disabled={streams.length >= 12}
                  className="bg-gradient-primary hover:shadow-glow transition-all"
                >
                  <Plus className="h-4 w-4 mr-2" /> Add
                </Button>

                <Button onClick={saveListToFile} variant="outline" disabled={streams.length === 0}>
                  <Save className="h-4 w-4 mr-2" /> Save List
                </Button>

                {/* ✅ LOAD LIST (LOCAL MACHINE) */}
                <label htmlFor="load-list-file" className="inline-block">
                  <input
                    id="load-list-file"
                    type="file"
                    accept=".txt"
                    style={{ display: "none" }}
                    onChange={loadListFromFile}
                  />
                  <Button asChild variant="outline">
                    <span>Load List</span>
                  </Button>
                </label>

                <Button onClick={() => void downloadBitrateCsv()} variant="outline">
                  <Download className="h-4 w-4 mr-2" /> Download Bitrate CSV
                </Button>

                {/* optional server logs */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" disabled={downloadItems.length === 0}>
                      <History className="h-4 w-4 mr-2" /> Download Server Logs
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {downloadItems.map((it) => (
                      <DropdownMenuItem
                        key={`${it.key}-${it.filename}`}
                        onSelect={() =>
                          window.open(`${API_BASE}/download-log/${it.key}/${it.filename}`, "_blank")
                        }
                      >
                        {it.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

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

      <ManagementDialog isOpen={isManagementOpen} onClose={() => setManagementOpen(false)} />

      {/* Stream Grid */}
      <div className="lg:col-span-3">
        {streams.length === 0 ? (
          <Card className="bg-gradient-card border-stream-border">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Monitor className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">No streams active</h3>
              <p className="text-muted-foreground max-w-md">
                Add your first stream URL above to start monitoring. Supports up to 12 concurrent streams.
              </p>
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
                    onClick={() => setReloadSignals(rs => ({ ...rs, [stream.id]: (rs[stream.id] || 0) + 1 }))}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>

                <VideoPlayer
                  streamId={stream.id}
                  streamName={stream.name}
                  streamUrl={stream.url}
                  resolution={stream.resolution}
                  onResolutionChange={() => {}}
                  onRemove={async () => {
                    const confirmed = window.confirm(`Remove "${stream.name}"?`);
                    if (!confirmed) return;
                    await removeStream(stream.id);
                  }}
                  reloadSignal={reloadSignals[stream.id] || 0}
                  onBitrateUpdate={(id, br) => void handleBitrateUpdate(id, br)}
                  canRemove={true}
                  status={(failureCounts[stream.id] || 0) === 0 ? "online" : "offline"}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bitrate Graph */}
      {streams.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-2xl font-bold text-white">Real-time Bitrate Monitor:</h2>
              <span className="text-lg font-semibold text-blue-500">{latestTotalBitrate} Mbps</span>
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
    </div>
  );
};
