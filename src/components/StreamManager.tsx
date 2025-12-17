import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { RotateCcw, Plus, Monitor, History, Save, LogOut, Settings } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
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

import { getUser, logout, UserPayload, getToken } from "@/lib/auth";
import ManagementDialog from "./ManagementDialog";

// ✅ Correct Supabase import (fix for your build error)
import { supabase } from "@/integrations/supabase/client";

const streamColors = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#387908", "#ff0000",
  "#0088fe", "#00c49f", "#ffbb28", "#ff8042", "#00cfff", "#ff00ff",
];

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

export const StreamManager: React.FC = () => {
  const API_BASE =
    (import.meta.env.VITE_API_BASE?.replace(/\/+$/, "")) ||
    `${window.location.protocol}//${window.location.hostname}:3001`;

  const { toast } = useToast();

  // Helper to get authorization headers for API calls
  const getAuthHeaders = useCallback(() => {
    const token = getToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const [streams, setStreams] = useState<Stream[]>([]);
  const [streamName, setStreamName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [resolution, setResolution] = useState("480p");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [gridLayout, setGridLayout] = useState<"3-2" | "4-2" | "6-2">("4-2");
  const [allBitrateHistory, setAllBitrateHistory] = useState<AllBitrateDataPoint[]>([]);
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});
  const [reloadSignals, setReloadSignals] = useState<Record<string, number>>({});
  const [allLogFiles, setAllLogFiles] = useState<{ stream: string; file: string; path: string }[]>([]);
  const [selectedGraphStream, setSelectedGraphStream] = useState<string>("all");

  const [user, setUser] = useState<UserPayload | null>(null);

  // ✅ Admin menu state
  const [isManagementOpen, setManagementOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const startedStreamsRef = useRef<Set<string>>(new Set());
  const initialFetchDoneRef = useRef(false);

  const sanitizeFilename = (name: string) => String(name || "").replace(/[<>:"/\\|?*]/g, "_");

  const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/$/, "");

  // ===== Admin role check from Supabase profiles =====
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (!sbUser) {
          setIsAdmin(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", sbUser.id)
          .maybeSingle();

        if (error) {
          console.warn("Failed to read profiles.role", error);
          setIsAdmin(false);
          return;
        }

        setIsAdmin((data?.role || "user") === "admin");
      } catch (e) {
        console.warn("checkAdmin failed", e);
        setIsAdmin(false);
      }
    };

    void checkAdmin();
  }, []);

  // Load user payload from your auth helper (keeps existing behavior)
  useEffect(() => {
    const currentUser = getUser();
    // if your old token says admin, keep it
    if (currentUser?.role === "admin") {
      const adminRoles = new Proxy(
        {},
        {
          get: function () {
            return true;
          },
        }
      );
      setUser({ ...currentUser, roles: adminRoles });
    } else {
      setUser(currentUser);
    }
  }, []);

  // ===== Helpers for history merge =====
  const pointsForStream = useCallback(
    (hist: Array<{ time: number; bitrate: number | null; estimated?: boolean }>, streamId: string) => {
      return hist.map((h) => {
        const p: AllBitrateDataPoint = { time: h.time } as AllBitrateDataPoint;
        p[streamId] = typeof h.bitrate === "number" ? h.bitrate : 0;
        (p as Record<string, number | null | boolean>)[`${streamId}__est`] = !!h.estimated;
        return p;
      });
    },
    []
  );

  const mergeHistoryToPoints = useCallback(
    (hist: Array<{ time: number; bitrate: number | null; estimated?: boolean }>, streamId: string) => {
      return hist.map((h) => {
        const item: AllBitrateDataPoint = { time: h.time } as AllBitrateDataPoint;

        streams.forEach((s) => {
          if (s.id === streamId) {
            item[s.id] = typeof h.bitrate === "number" ? h.bitrate : 0;
            (item as Record<string, number | null | boolean>)[`${s.id}__est`] = !!h.estimated;
          } else {
            item[s.id] = 0;
            (item as Record<string, number | null | boolean>)[`${s.id}__est`] = false;
          }
        });

        return item;
      });
    },
    [streams]
  );

  // ===== Ensure server start + history =====
  const ensureStartAndFetchHistory = useCallback(
    async (stream: Stream) => {
      try {
        await fetch(`${API_BASE}/start-stream`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            streamUrl: stream.url,
            streamName: stream.name,
            resolution: stream.resolution,
          }),
        }).catch(() => null);

        const res = await fetch(`${API_BASE}/bitrate-history`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ streamUrl: stream.url, maxSamples: 10000 }),
        });

        if (res.ok) {
          const json = await res.json();
          const hist = Array.isArray(json.history) ? json.history : [];
          if (hist.length > 0) {
            const added = pointsForStream(hist, stream.id);
            setAllBitrateHistory((prev) => {
              const merged = [...prev, ...added];
              const mapByTime: Record<number, AllBitrateDataPoint> = {};
              merged.forEach((m) => {
                const timeKey = Math.round(m.time / 1000);
                mapByTime[timeKey] = { ...(mapByTime[timeKey] || { time: m.time }), ...m };
              });
              const out = Object.values(mapByTime).sort((a, b) => a.time - b.time);
              const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
              return out.filter((p) => p.time >= twentyFourHoursAgo);
            });
          }
        }
      } catch (err) {
        console.debug("Failed to start/fetch history for", stream.id, err);
      } finally {
        startedStreamsRef.current.add(stream.id);
      }
    },
    [API_BASE, getAuthHeaders, pointsForStream]
  );

  // ===== Fetch all log files =====
  useEffect(() => {
    let mounted = true;

    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/logs/all-files`);
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setAllLogFiles(data);
            return;
          }
        }
        setAllLogFiles([]);
      } catch {
        if (mounted) setAllLogFiles([]);
      }
    };

    fetchLogs();
    const id = setInterval(fetchLogs, 10_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [API_BASE]);

  // ===== Clock =====
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ===== Auth / Persistence helpers =====
  const localStorageKeyFor = (username?: string) => `sm_saved_streams_v1_${username || "anon"}`;

  const saveStreams = useCallback(
    async (overrideStreams?: Stream[]) => {
      const toSave = overrideStreams ?? streams;

      let currentUsername = user?.username ?? getUser()?.username ?? undefined;

      try {
        const key = localStorageKeyFor(currentUsername && currentUsername.length > 0 ? currentUsername : undefined);
        localStorage.setItem(key, JSON.stringify(toSave));
      } catch {
        // ignore
      }

      // if no token or initial fetch not done, skip server save
      const token = getToken();
      if (!token) return;
      if (!initialFetchDoneRef.current && !overrideStreams) return;

      try {
        await fetch(`${API_BASE}/api/streams`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(toSave),
        });
      } catch (e) {
        console.debug("Failed to save streams to server", e);
      }
    },
    [streams, user, API_BASE]
  );

  useEffect(() => {
    void saveStreams();
  }, [saveStreams]);

  // ===== Fetch streams on mount =====
  useEffect(() => {
    const fetchStreams = async () => {
      try {
        const token = getToken();

        if (token) {
          // try saved streams
          try {
            const res = await fetch(`${API_BASE}/api/streams`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const serverStreams = await res.json();
              if (Array.isArray(serverStreams) && serverStreams.length > 0) {
                setStreams(serverStreams);
                setTimeout(() => serverStreams.forEach((s: Stream) => ensureStartAndFetchHistory(s)), 20);
                return;
              }
            }
          } catch {
            // ignore
          }

          // fallback active streams
          try {
            const resActive = await fetch(`${API_BASE}/api/active-streams`, { headers: getAuthHeaders() });
            if (resActive.ok) {
              const active = await resActive.json();
              if (Array.isArray(active) && active.length > 0) {
                const mapped: Stream[] = active.map((a: any, idx: number) => ({
                  id: a.streamId || `server-${idx}`,
                  name: a.streamName || a.streamId || `Stream ${idx + 1}`,
                  url: a.sourceUrl || a.streamUrl || a.hlsUrl || "",
                  color: streamColors[idx % streamColors.length],
                  resolution: a.resolution || "480p",
                }));
                setStreams(mapped);
                setTimeout(() => mapped.forEach((s) => ensureStartAndFetchHistory(s)), 20);
                return;
              }
            }
          } catch {
            // ignore
          }
        }

        // local fallback
        try {
          const currentUser = user || getUser();
          const perUserKey = localStorageKeyFor(currentUser?.username);
          const raw = currentUser?.username
            ? localStorage.getItem(perUserKey)
            : localStorage.getItem(perUserKey) || localStorage.getItem(localStorageKeyFor());

          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setStreams(parsed as Stream[]);
              setTimeout(() => (parsed as Stream[]).forEach((s) => ensureStartAndFetchHistory(s)), 20);
              return;
            }
          }

          setStreams([]);
        } catch {
          setStreams([]);
        }
      } finally {
        initialFetchDoneRef.current = true;
      }
    };

    void fetchStreams();
  }, [API_BASE, user, ensureStartAndFetchHistory, getAuthHeaders]);

  // ===== Ensure start streams =====
  useEffect(() => {
    streams.forEach((s) => {
      if (!startedStreamsRef.current.has(s.id)) {
        ensureStartAndFetchHistory(s);
      }
    });
  }, [streams, ensureStartAndFetchHistory]);

  // ===== Bitrate update =====
  const handleBitrateUpdate = useCallback(
    (streamId: string, bitrate: number | null) => {
      const now = Date.now();
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      setAllBitrateHistory((prev) => {
        const lastPoint = prev.length > 0 ? prev[prev.length - 1] : null;

        const newPoint: AllBitrateDataPoint = { time: now };

        streams.forEach((stream) => {
          if (stream.id === streamId) {
            newPoint[stream.id] = typeof bitrate === "number" ? bitrate : 0;
            (newPoint as any)[`${stream.id}__est`] = false;
          } else if (lastPoint && lastPoint[stream.id] !== undefined) {
            newPoint[stream.id] = lastPoint[stream.id];
          } else {
            newPoint[stream.id] = 0;
          }
        });

        const newHistory = [...prev, newPoint];
        return newHistory.filter((p) => p.time >= twentyFourHoursAgo);
      });
    },
    [streams]
  );

  // ===== SSE updates =====
  useEffect(() => {
    const token = getToken();
    const eventsUrl = `${API_BASE.replace(/\/+$/, "")}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const evtSource = new EventSource(eventsUrl);

    const handleEvent = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);

        if (payload.type === "bitrate") {
          let targetStreamId = payload.streamId;
          const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
          if (serverUrl) {
            const normalized = normalizeUrl(serverUrl);
            const match = streams.find((s) => normalizeUrl(s.url) === normalized);
            if (match) targetStreamId = match.id;
          }

          const reported = typeof payload.bitrate === "number" ? payload.bitrate : 0;

          handleBitrateUpdate(targetStreamId, reported);

          setFailureCounts((prev) => {
            const cur = prev[targetStreamId] || 0;
            if (reported > 0) return { ...prev, [targetStreamId]: 0 };
            return { ...prev, [targetStreamId]: cur + 1 };
          });
        } else if (payload.type === "started") {
          let targetStreamId = payload.streamId;
          const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
          if (serverUrl) {
            const normalized = normalizeUrl(serverUrl);
            const match = streams.find((s) => normalizeUrl(s.url) === normalized);
            if (match) targetStreamId = match.id;
          }
          setReloadSignals((rs) => ({ ...rs, [targetStreamId]: (rs[targetStreamId] || 0) + 1 }));
          setFailureCounts((prev) => ({ ...prev, [targetStreamId]: 0 }));
        }
      } catch (err) {
        console.debug("SSE parse error", err);
      }
    };

    evtSource.addEventListener("message", handleEvent);
    evtSource.addEventListener("error", (err) => console.debug("SSE error", err));

    return () => {
      evtSource.removeEventListener("message", handleEvent);
      evtSource.close();
    };
  }, [API_BASE, streams, handleBitrateUpdate]);

  // ===== URL validation =====
  const isValidStreamUrl = (url: string): boolean => {
    try {
      const lowerUrl = url.trim().toLowerCase();
      return (
        lowerUrl.startsWith("http://") ||
        lowerUrl.startsWith("https://") ||
        lowerUrl.startsWith("rtmp://") ||
        lowerUrl.startsWith("rtsp://") ||
        lowerUrl.startsWith("udp://") ||
        lowerUrl.includes(".m3u8")
      );
    } catch {
      return false;
    }
  };

  const addStream = () => {
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
      toast({
        title: "Limit Reached",
        description: "You can add up to 12 streams",
        variant: "destructive",
      });
      return;
    }

    const normalized = normalizeUrl(urlToAdd);
    if (streams.some((s) => normalizeUrl(s.url) === normalized)) {
      toast({
        title: "Duplicate Stream",
        description: "This stream URL is already added",
        variant: "destructive",
      });
      return;
    }

    const nameToAdd = streamName.trim() || `Stream ${streams.length + 1}`;

    const newStream: Stream = {
      id: `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: nameToAdd,
      url: urlToAdd,
      color: streamColors[streams.length % streamColors.length],
      resolution,
    };

    const next = [...streams, newStream];
    setStreams(next);
    setTimeout(() => ensureStartAndFetchHistory(newStream), 10);
    void saveStreams(next);

    setStreamName("");
    setStreamUrl("");

    toast({
      title: "Stream Added",
      description: `Stream added successfully (${next.length}/12)`,
    });
  };

  const removeStream = useCallback(
    (streamId: string) => {
      setStreams((prev) => {
        const next = prev.filter((s) => s.id !== streamId);

        setAllBitrateHistory((prevHist) => {
          const newHistory = prevHist.map((point) => {
            const newPoint = { ...point };
            delete (newPoint as any)[streamId];
            return newPoint;
          });
          return newHistory.filter((point) => Object.keys(point).length > 1);
        });

        startedStreamsRef.current.delete(streamId);
        void saveStreams(next);
        return next;
      });
    },
    [saveStreams]
  );

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") addStream();
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
    if (!allBitrateHistory || allBitrateHistory.length === 0) return 0;
    const latest = allBitrateHistory[allBitrateHistory.length - 1];
    if (!latest) return 0;
    let total = 0;
    streams.forEach((s) => {
      const v = latest[s.id];
      if (typeof v === "number" && isFinite(v)) total += v;
    });
    return Math.round(total * 100) / 100;
  }, [allBitrateHistory, streams]);

  const downloadItems = useMemo(() => {
    const items: { key: string; label: string; filename: string }[] = [];

    for (const log of allLogFiles) {
      const stream = streams.find((s) => sanitizeFilename(s.name) === log.stream);
      const streamId = stream ? stream.id : log.stream;

      items.push({
        key: streamId,
        label: `${log.file}`,
        filename: log.file,
      });
    }

    // If not admin, limit to active streams
    if (!isAdmin && user?.role !== "admin") {
      const currentStreamIds = new Set(streams.map((s) => s.id));
      return items.filter((it) => currentStreamIds.has(it.key));
    }

    return items;
  }, [allLogFiles, streams, user, isAdmin]);

  const handleResolutionChange = (streamId: string, newResolution: string) => {
    setStreams((prevStreams) => {
      const newStreams = prevStreams.map((stream) =>
        stream.id === streamId ? { ...stream, resolution: newResolution } : stream
      );

      const streamToRestart = newStreams.find((s) => s.id === streamId);
      if (streamToRestart) {
        fetch(`${API_BASE}/restart-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            streamUrl: streamToRestart.url,
            streamName: streamToRestart.name,
            resolution: newResolution,
          }),
        }).then((res) => {
          if (res.ok) {
            toast({
              title: "Resolution Changed",
              description: `Stream ${streamToRestart.name} is restarting with ${newResolution}.`,
            });
          } else {
            toast({
              title: "Error",
              description: "Failed to change resolution.",
              variant: "destructive",
            });
          }
        });
      }

      return newStreams;
    });
  };

  // ===== Save/Load file =====
  const saveListToFile = () => {
    const listName = prompt("Enter a name for your stream list:");
    if (listName && listName.trim() !== "") {
      const content =
        `ListName:${listName.trim()}\n` + streams.map((s) => `${s.name};${s.url}`).join("\n");

      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${listName.trim()}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "List Saved to File",
        description: `Stream list '${listName.trim()}' saved successfully.`,
      });
    }
  };

  const loadListFromFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).filter(Boolean);
      let streamLines = lines;

      if (lines[0].startsWith("ListName:")) {
        streamLines = lines.slice(1);
      }

      const newStreams = streamLines
        .map((line, index) => {
          const parts = line.split(";");
          const name = parts.length === 2 ? parts[0].trim() : `Stream ${index + 1}`;
          const url = parts.length === 2 ? parts[1].trim() : parts[0].trim();

          return {
            id: `${Date.now()}-${index}`,
            name,
            url,
            color: streamColors[index % streamColors.length] || "#8884d8",
            resolution: "",
          } as Stream;
        })
        .filter((s) => s.url);

      setStreams(newStreams);
      void saveStreams(newStreams);
      setTimeout(() => newStreams.forEach((s) => ensureStartAndFetchHistory(s)), 20);

      toast({
        title: "List Loaded from File",
        description: `Loaded ${newStreams.length} stream(s) from file.`,
      });
    };

    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="space-y-6 p-2">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
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

              <div className="flex flex-wrap items-center gap-2 mt-2">
                {(!user || user.roles.add_streams) && (
                  <Button
                    onClick={addStream}
                    disabled={streams.length >= 12}
                    className="bg-gradient-primary hover:shadow-glow transition-all"
                  >
                    <Plus className="h-4 w-4 mr-2" /> Add
                  </Button>
                )}

                {(!user || user.roles.save_lists) && (
                  <Button onClick={saveListToFile} variant="outline" disabled={streams.length === 0}>
                    <Save className="h-4 w-4 mr-2" /> Save List
                  </Button>
                )}

                {(!user || user.roles.load_lists) && (
                  <label htmlFor="load-list-file" className="inline-block">
                    <input
                      id="load-list-file"
                      type="file"
                      accept=".txt"
                      style={{ display: "none" }}
                      onChange={loadListFromFile}
                    />
                    <Button asChild variant="outline">
                      <span>Load File</span>
                    </Button>
                  </label>
                )}

                <div className="flex items-center ml-auto">
                  <label htmlFor="grid-layout" className="mr-2 text-sm text-muted-foreground">
                    Grid Layout:
                  </label>
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

                {(!user || user.roles.download_logs) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" disabled={downloadItems.length === 0}>
                        <History className="h-4 w-4 mr-2" /> Download Logs
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {downloadItems.map((it) => (
                        <DropdownMenuItem
                          key={`${it.key}-${it.filename}`}
                          onSelect={() => {
                            window.open(`${API_BASE}/download-log/${it.key}/${it.filename}`, "_blank");
                          }}
                        >
                          {it.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* ✅ Admin Settings menu button */}
                {(isAdmin || user?.role === "admin") && (
                  <Button
                    variant="outline"
                    size="icon"
                    title="User Management"
                    onClick={() => setManagementOpen(true)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                )}

                {user && (
                  <Button
                    variant="outline"
                    size="icon"
                    title="Logout"
                    onClick={async () => {
                      await logout();
                      setUser(null);
                      window.location.href = "/login";
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ✅ Management dialog rendered in StreamManager */}
      <ManagementDialog isOpen={isManagementOpen} onClose={() => setManagementOpen(false)} />

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
                    onClick={async () => {
                      try {
                        const body = { streamUrl: stream.url, streamName: stream.name, resolution: stream.resolution };
                        const res = await fetch(`${API_BASE}/restart-stream`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(body),
                        });

                        if (!res.ok) {
                          const txt = await res.text().catch(() => "restart failed");
                          toast({ title: "Restart Failed", description: txt, variant: "destructive" });
                        } else {
                          setReloadSignals((rs) => ({ ...rs, [stream.id]: (rs[stream.id] || 0) + 1 }));
                          setFailureCounts((fc) => ({ ...fc, [stream.id]: 0 }));
                          toast({ title: "Restarted", description: `Restart requested for ${stream.name}` });
                        }
                      } catch (err) {
                        toast({ title: "Restart Error", description: String(err), variant: "destructive" });
                      }
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>

                <VideoPlayer
                  streamId={stream.id}
                  streamName={stream.name}
                  streamUrl={stream.url}
                  resolution={stream.resolution}
                  onResolutionChange={handleResolutionChange}
                  onRemove={async () => {
                    const confirmed = window.confirm(`Are you sure you want to remove the stream "${stream.name}"?`);
                    if (!confirmed) return;
                    removeStream(stream.id);
                    toast({ title: "Stream Removed", description: `${stream.name} has been removed.` });
                  }}
                  reloadSignal={reloadSignals[stream.id] || 0}
                  onBitrateUpdate={handleBitrateUpdate}
                  canRemove={!user || user.roles.delete_streams}
                  status={(failureCounts[stream.id] || 0) === 0 ? "online" : "offline"}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {streams.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-2xl font-bold text-white">Real-time Bitrate Monitor: </h2>
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
