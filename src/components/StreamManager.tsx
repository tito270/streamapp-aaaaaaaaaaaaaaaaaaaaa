import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { RotateCcw } from "lucide-react";
import {
  Plus,
  Monitor,
  History,
  Trash2,
  Save,
} from "lucide-react";
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
  DropdownMenuSeparator,
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
import { LogOut, Settings } from "lucide-react";

interface User {
  username: string;
  role: string;
  roles: Record<string, boolean>;
}
// Find the type definition, which might look like this:
type StreamDataItem = {
  key: string;
  label: string;
  type: "bitrate" | "issues";
  file: string; // Add the 'file' property with its type
};

// Or, if 'file' can be optional:
type OptionalStreamDataItem = {
  key: string;
  label: string;
  type: "bitrate" | "issues";
  file?: string; // The '?' makes it optional
};
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
  const API_BASE = (import.meta.env.VITE_API_BASE?.replace(/\/+$/, ''))
    || `${window.location.protocol}//${window.location.hostname}:3001`;

  // No per-tab session id is used anymore — session ownership removed

  // track which streams we've already requested the server to start
  const startedStreamsRef = useRef<Set<string>>(new Set());

  const pointsForStream = useCallback((hist: Array<{ time: number; bitrate: number | null; estimated?: boolean }>, streamId: string) => {
    return hist.map(h => {
      const p: AllBitrateDataPoint = { time: h.time } as AllBitrateDataPoint;
  // When there's no explicit measurement, use 0 so the graph draws down to zero
  p[streamId] = typeof h.bitrate === 'number' ? h.bitrate : 0;
      (p as Record<string, number | null | boolean>)[`${streamId}__est`] = !!h.estimated;
      return p;
    });
  }, []);

  const ensureStartAndFetchHistory = useCallback(async (stream: Stream) => {
    try {
      // Always fetch history, even if we think it's started.
      // This covers cases where the server restarts or the stream was added in a previous session.
      
      // Request server to start transcoding/proxy. The server should handle this idempotently.
      await fetch(`${API_BASE}/start-stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamUrl: stream.url, streamName: stream.name, resolution: stream.resolution })
      }).catch(() => null);

      // Request history from server
      const res = await fetch(`${API_BASE}/bitrate-history`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamUrl: stream.url, maxSamples: 10000 }) // Fetch more samples
      });
      if (res.ok) {
        const json = await res.json();
        const hist = Array.isArray(json.history) ? json.history : [];
        if (hist.length > 0) {
          const added = pointsForStream(hist, stream.id);
          setAllBitrateHistory(prev => {
            const merged = [...prev, ...added];
            const mapByTime: Record<number, AllBitrateDataPoint> = {};
            merged.forEach(m => { 
              const timeKey = Math.round(m.time / 1000); // Group by second
              mapByTime[timeKey] = { ...(mapByTime[timeKey]||{time: m.time}), ...m }; 
            });
            const out = Object.values(mapByTime).sort((a,b)=>a.time-b.time);
            const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
            return out.filter(p=>p.time >= twentyFourHoursAgo);
          });
        }
      }
    } catch (err) {
      console.debug('Failed to start/fetch history for', stream.id, err);
    } finally {
      startedStreamsRef.current.add(stream.id);
    }
  }, [API_BASE, pointsForStream]);

  const [streams, setStreams] = useState<Stream[]>([]);

  // Per-user localStorage key to avoid different authenticated users sharing the
  // same local cached stream list (localStorage is shared across same-origin
  // tabs/windows). Fall back to an anonymous key when no username is present.
  const localStorageKeyFor = (username?: string) => `sm_saved_streams_v1_${username || 'anon'}`;

  // Narrower auth shape and single accessor for tokens
  type AuthUser = {
    token?: string;
    accessToken?: string;
    access_token?: string;
    username?: string;
    role?: string;
    roles?: Record<string, boolean> | { [k: string]: unknown };
    [k: string]: unknown;
  };

  // token accessor intentionally not defined here; use centralized `getToken()`
  // from `src/lib/auth` to read the session token reliably.


  // Helper: merge raw history samples into AllBitrateDataPoint[] format
  const mergeHistoryToPoints = useCallback((hist: Array<{ time: number; bitrate: number | null; estimated?: boolean }>, streamId: string) => {
    return hist.map(h => {
      const item: AllBitrateDataPoint = { time: h.time } as AllBitrateDataPoint;
      streams.forEach(s => {
        if (s.id === streamId) {
          // Use 0 for missing measurements so the combined timeline shows a drop to zero
          item[s.id] = typeof h.bitrate === 'number' ? h.bitrate : 0;
          // companion key to indicate whether this sample was estimated
          const rec = item as Record<string, number | null | boolean>;
          rec[`${s.id}__est`] = !!h.estimated;
        } else {
          // For other streams at this timestamp, default to 0 so lines continue (not cut)
          item[s.id] = 0;
          const rec2 = item as Record<string, number | null | boolean>;
          rec2[`${s.id}__est`] = false;
        }
      });
      return item;
    });
  }, [streams]);
  const [streamName, setStreamName] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [resolution, setResolution] = useState("480p");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [history, setHistory] = useState<string[]>([]);
  const [savedLists, setSavedLists] = useState<Record<string, Stream[]>>({});
  const [gridLayout, setGridLayout] = useState<"3-2" | "4-2" | "6-2">("4-2");
  const [allBitrateHistory, setAllBitrateHistory] = useState<
    AllBitrateDataPoint[]
  >([]);
  // track per-stream failure counts (no bitrate) and reload signals
  const [failureCounts, setFailureCounts] = useState<Record<string, number>>({});
  const [reloadSignals, setReloadSignals] = useState<Record<string, number>>({});
  const [allLogFiles, setAllLogFiles] = useState<{ stream: string, file: string, path: string }[]>([]);
  // sanitize filenames the same way server does
  const sanitizeFilename = (name: string) => String(name || '').replace(/[<>:"/\\|?*]/g, '_');
  const [user, setUser] = useState<UserPayload | null>(null);
  const [isManagementOpen, setManagementOpen] = useState(false);

  const downloadItems = useMemo(() => {
    const items: { key: string, label: string, filename: string }[] = [];

    for (const log of allLogFiles) {
      const stream = streams.find(s => sanitizeFilename(s.name) === log.stream);
      const streamId = stream ? stream.id : log.stream;
      const streamName = stream ? stream.name : log.stream;
      
      items.push({ 
        key: streamId, 
        label: `${log.file}`, 
        filename: log.file 
      });
    }

    if (user?.role !== 'admin') {
      const currentStreamIds = new Set(streams.map(s => s.id));
      return items.filter(item => currentStreamIds.has(item.key));
    }

    return items;
  }, [allLogFiles, streams, user]);

  useEffect(() => {
    const currentUser = getUser();
    if (currentUser && currentUser.role === 'admin') {
      // Create a proxy for roles to always return true for admin
      const adminRoles = new Proxy({}, {
        get: function() {
          return true;
        }
      });
      setUser({ ...currentUser, roles: adminRoles });
    } else {
      setUser(currentUser);
    }
  }, []);

  // Fetch all available log files from server
  useEffect(() => {
    let mounted = true;
    const API = (import.meta.env.VITE_API_BASE?.replace(/\/+$/, '')) || `${window.location.protocol}//${window.location.hostname}:3001`;
    const fetchLogs = async () => {
      try {
        const res = await fetch(`${API}/api/logs/all-files`);
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setAllLogFiles(data);
            return;
          }
        }
        setAllLogFiles([]);
      } catch (e) {
        if (mounted) setAllLogFiles([]);
      }
    };
    fetchLogs();
    const id = setInterval(fetchLogs, 10_000); // refresh every 10s
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    console.debug('allBitrateHistory updated (length):', allBitrateHistory.length);
  }, [allBitrateHistory]);
  const [selectedGraphStream, setSelectedGraphStream] = useState<string>("all");
  const { toast } = useToast();

  // compute latest aggregate bitrate (sum of numeric bitrates from most recent point)
  const latestTotalBitrate = useMemo(() => {
    if (!allBitrateHistory || allBitrateHistory.length === 0) return 0;
    // find latest point
    const latest = allBitrateHistory[allBitrateHistory.length - 1];
    if (!latest) return 0;
    // sum values for known streams
    let total = 0;
    streams.forEach(s => {
      const v = latest[s.id];
      if (typeof v === 'number' && isFinite(v)) total += v as number;
    });
    return Math.round(total * 100) / 100;
  }, [allBitrateHistory, streams]);

  // Ensure we persist per-user streams to localStorage and to the server when authenticated
  const saveStreams = useCallback(async (overrideStreams?: Stream[]) => {
    const toSave = overrideStreams ?? streams;
    // determine username: prefer explicit `user`, fall back to decoded token
    const token = getToken();
    let currentUsername = user?.username ?? getUser()?.username ?? undefined;
    if (!currentUsername && token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload && typeof payload.username === 'string') currentUsername = payload.username;
      } catch (e) { /* ignore */ }
    }

    // still keep a local copy per-user for offline/unauthenticated usage
    // but avoid writing into the shared 'anon' bucket when the user is authenticated
    try {
      const key = localStorageKeyFor(currentUsername && currentUsername.length > 0 ? currentUsername : undefined);
      localStorage.setItem(key, JSON.stringify(toSave));
      console.debug(`saveStreams: wrote ${toSave.length || 0} items to localStorage key='${key}' user='${currentUsername || 'anon'}'`);
    } catch (e) { /* ignore */ }
      // Only send the list to server after the initial server/local fetch
      // completes to avoid overwriting server-side saved lists with an
      // unintended empty array on mount. If overrideStreams is provided,
      // treat it as an explicit save and POST immediately.
    if (!token) return;

    // If the initial fetch hasn't completed yet, do not POST to server.
    if (!initialFetchDoneRef.current && !overrideStreams) {
      return;
    }

    try {
      console.debug(`saveStreams: POST /api/streams user='${currentUsername || 'unknown'}' items=${(toSave && toSave.length) || 0}`);
      await fetch(`${API_BASE}/api/streams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(toSave),
      });
    } catch (e) {
      console.debug('Failed to save streams to server', e);
    }
  }, [streams, user, API_BASE]);

  // Track whether the initial fetch of streams from server/localStorage finished
  const initialFetchDoneRef = useRef(false);

  // Call saveStreams whenever streams or user changes
  useEffect(() => {
    saveStreams();
  }, [saveStreams]);

  useEffect(() => {
    const fetchStreams = async () => {
      try {
        const token = getToken();
        const decodedUser = getUser();
        console.debug('fetchStreams: token present?', !!token, 'decodedUser=', decodedUser);
        // If authenticated, prefer server-side saved list (server authoritative)
        if (token) {
          // First try to get per-user saved streams
          try {
            const res = await fetch(`${API_BASE}/api/streams`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
              const serverStreams = await res.json();
              console.debug('fetchStreams: /api/streams returned', Array.isArray(serverStreams) ? serverStreams.length : typeof serverStreams);
              if (Array.isArray(serverStreams) && serverStreams.length > 0) {
                setStreams(serverStreams);
                setTimeout(() => serverStreams.forEach(s => ensureStartAndFetchHistory(s)), 20);
                return;
              }
            }
          } catch (e) {
            console.warn('Failed to fetch /api/streams, will try /api/active-streams', e);
          }

          // If no saved list, ask server for currently active streams to repopulate UI
          try {
            const resActive = await fetch(`${API_BASE}/api/active-streams`);
            if (resActive.ok) {
              const active = await resActive.json();
              if (Array.isArray(active) && active.length > 0) {
                // transform server shape to local Stream[] shape
                const mapped: Stream[] = active.map((a: unknown, idx: number) => {
                  const obj = a as Record<string, unknown>;
                  return {
                    id: (obj.streamId as string) || `server-${idx}`,
                    name: (obj.streamName as string) || (obj.streamId as string) || `Stream ${idx + 1}`,
                    url: (obj.sourceUrl as string) || (obj.streamUrl as string) || (obj.hlsUrl as string) || '',
                    color: streamColors[idx % streamColors.length],
                    resolution: (obj.resolution as string) || '480p',
                  } as Stream;
                });
                setStreams(mapped);
                setTimeout(() => mapped.forEach(s => ensureStartAndFetchHistory(s)), 20);
                return;
              }
            }
          } catch (e) {
            console.warn('Failed to fetch active streams', e);
          }
        }

        // Unauthenticated or server empty/unavailable: fall back to per-user localStorage
        try {
          const currentUser = user || getUser();
          // If we have an authenticated username, prefer that key and do not
          // fallback to the shared 'anon' key to avoid mixing lists between users.
          const perUserKey = localStorageKeyFor(currentUser?.username);
          const raw = currentUser?.username ? localStorage.getItem(perUserKey) : (localStorage.getItem(perUserKey) || localStorage.getItem(localStorageKeyFor()));
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const typed = parsed as Stream[];
              setStreams(typed);
              setTimeout(() => typed.forEach((s: Stream) => ensureStartAndFetchHistory(s)), 20);
              return;
            }
          }
          setStreams([]);
        } catch (e) {
          console.error("Failed to load streams from localStorage", e);
          setStreams([]);
        }
      } catch (error) {
        console.error("Failed to load streams from server or localStorage", error);
        setStreams([]);
      } finally {
        // mark that initial fetch attempt completed (regardless of outcome)
        initialFetchDoneRef.current = true;
      }
    };
    fetchStreams();
  }, [API_BASE, user, ensureStartAndFetchHistory]);

  // No session cleanup on unload required anymore (sessions removed)
  useEffect(() => {
    return () => {};
  }, [API_BASE]);

  // On first load (e.g. after browser refresh) retry/reload all configured streams.
  // This bumps `reloadSignals` so `VideoPlayer` instances reload, and ensures the
  // server is asked to start/transcode each stream and fetch history.
  const _initialLoadRef = useRef(true);
  useEffect(() => {
    if (!_initialLoadRef.current) return;
    if (!streams || streams.length === 0) return;
    _initialLoadRef.current = false;

    streams.forEach(s => {
      // nudge the player to reload (increment signal)
      setReloadSignals(rs => ({ ...rs, [s.id]: (rs[s.id] || 0) + 1 }));
      // ensure server started and history fetched
      setTimeout(() => ensureStartAndFetchHistory(s), 10);
    });
  }, [streams, ensureStartAndFetchHistory]);

  // Ensure server start + fetch history for any streams we haven't started yet.
  useEffect(() => {
    streams.forEach(s => {
      if (!startedStreamsRef.current.has(s.id)) {
        ensureStartAndFetchHistory(s);
      }
    });
  }, [streams, ensureStartAndFetchHistory]);

  // Keep the clock ticking so the chart's timeDomain can be computed from `currentTime` and remain live.
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // When loading streams on mount, prefer server-side saved list for authenticated users
  // (fetch logic handled in the effect above that depends on `user`)

  // Ensure server start + fetch history for any streams we haven't started yet.
  useEffect(() => {
    streams.forEach(s => {
      if (!startedStreamsRef.current.has(s.id)) {
        ensureStartAndFetchHistory(s);
      }
    });
  }, [streams, ensureStartAndFetchHistory]);

  // Keep the clock ticking so the chart's timeDomain can be computed from `currentTime` and remain live.
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const removeStream = useCallback((streamId: string) => {
    // compute next list and persist it (locally + server if authenticated)
    setStreams(prev => {
      const next = prev.filter(stream => stream.id !== streamId);

      // update history and started set
      setAllBitrateHistory(prevHist => {
        const newHistory = prevHist.map(point => {
          const newPoint = { ...point };
          delete newPoint[streamId];
          return newPoint;
        });
        return newHistory.filter(point => Object.keys(point).length > 1);
      });

      startedStreamsRef.current.delete(streamId);

      // persist immediately (saveStreams handles server auth)
      void saveStreams(next);

      return next;
    });
  }, [saveStreams]);

  const handleBitrateUpdate = useCallback((streamId: string, bitrate: number | null) => {
  console.debug(`handleBitrateUpdate: ${streamId} -> ${bitrate} Mbps`);
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    setAllBitrateHistory(prev => {
      const lastPoint = prev.length > 0 ? prev[prev.length - 1] : null;
      
      const newPoint: AllBitrateDataPoint = {
        time: now,
      };

      streams.forEach(stream => {
        if (stream.id === streamId) {
          if (typeof bitrate === 'number') {
            // explicit numeric measurement
            newPoint[stream.id] = bitrate;
            (newPoint as Record<string, number | null | boolean>)[`${stream.id}__est`] = false;
          } else {
            // No recent measurement -> treat as 0 so the chart falls to zero and continues plotting
            newPoint[stream.id] = 0;
            (newPoint as Record<string, number | null | boolean>)[`${stream.id}__est`] = false;
          }
        } else if (lastPoint && lastPoint[stream.id] !== undefined) {
          newPoint[stream.id] = lastPoint[stream.id];
          // copy the estimated flag from lastPoint if present
          const lastRec = lastPoint as Record<string, number | null | boolean>;
          (newPoint as Record<string, number | null | boolean>)[`${streamId}__est`] = !!lastRec[`${streamId}__est`];
        } else {
          // If we have no previous value for this stream at this timestamp, record 0
          // so the chart continues to plot a line down to zero instead of breaking.
          newPoint[stream.id] = 0;
          (newPoint as Record<string, number | null | boolean>)[`${streamId}__est`] = false;
        }
      });

      // Add the new point and filter out data older than 24 hours
      const newHistory = [...prev, newPoint];
      return newHistory.filter(p => p.time >= twentyFourHoursAgo);
    });
  }, [streams]);

  // Real-time updates via Server-Sent Events (SSE)
  useEffect(() => {
    const API_BASE = (import.meta.env.VITE_API_BASE?.replace(/\/+$/, '')) || `${window.location.protocol}//${window.location.hostname}:3001`;
  const eventsUrl = `${API_BASE.replace(/\/+$/, '')}/events`;
  const evtSource = new EventSource(eventsUrl);

    const handleEvent = (e) => {
      try {
        const payload = JSON.parse(e.data);
    if (payload.type === 'bitrate') {
            // Try to find the matching stream by original URL first (server now includes sourceUrl or streamUrl)
            let targetStreamId = payload.streamId;
            const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
            if (serverUrl) {
              const normalized = normalizeUrl(serverUrl);
              const match = streams.find(s => normalizeUrl(s.url) === normalized);
              if (match) targetStreamId = match.id;
            }
          // update history
          // If server reports null (no measurement), treat it as 0 so the graph drops to zero when stream is down.
          const reported = typeof payload.bitrate === 'number' ? payload.bitrate : 0;
          handleBitrateUpdate(targetStreamId, reported);
          setFailureCounts(prev => {
            const cur = prev[targetStreamId] || 0;
            if (typeof reported === 'number' && reported > 0) {
              return { ...prev, [targetStreamId]: 0 };
            } else {
              return { ...prev, [targetStreamId]: cur + 1 };
            }
          });
        } else if (payload.type === 'bitrate-history') {
          // Merge history array of {time, bitrate, estimated?}
          const hist = Array.isArray(payload.history) ? payload.history : [];
          if (hist.length > 0) {
            // payload may include sourceUrl; find matching local stream id
            const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
            let targetId = payload.streamId;
            if (serverUrl) {
              const normalized = normalizeUrl(serverUrl);
              const match = streams.find(s => normalizeUrl(s.url) === normalized);
              if (match) targetId = match.id;
            }
            const added = mergeHistoryToPoints(hist, targetId);
            setAllBitrateHistory(prev => {
              const merged = [...prev, ...added];
              const mapByTime: Record<number, AllBitrateDataPoint> = {};
              merged.forEach(m => { mapByTime[m.time] = { ...(mapByTime[m.time]||{}), ...m }; });
              const out = Object.values(mapByTime).sort((a,b)=>a.time-b.time);
              const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
              return out.filter(p=>p.time >= twentyFourHoursAgo);
            });
          }
        } else if (payload.type === 'started') {
          let targetStreamId = payload.streamId;
          const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
          if (serverUrl) {
            const normalized = normalizeUrl(serverUrl);
            const match = streams.find(s => normalizeUrl(s.url) === normalized);
            if (match) targetStreamId = match.id;
          }
          setReloadSignals(rs => ({ ...rs, [targetStreamId]: (rs[targetStreamId] || 0) + 1 }));
          setFailureCounts(prev => ({ ...prev, [targetStreamId]: 0 }));
        } else if (payload.type === 'stopped') {
          let targetStreamId = payload.streamId;
          const serverUrl = payload.sourceUrl || payload.streamUrl || payload.source_url || null;
          if (serverUrl) {
            const normalized = normalizeUrl(serverUrl);
            const match = streams.find(s => normalizeUrl(s.url) === normalized);
            if (match) targetStreamId = match.id;
          }
          // mark a zero bitrate immediately when server signals stopped
          try { handleBitrateUpdate(targetStreamId, 0); } catch (e) { console.debug('handleBitrateUpdate failed', e); }
          setFailureCounts(prev => ({ ...prev, [targetStreamId]: (prev[targetStreamId] || 0) + 1 }));
        }
      } catch (err) {
        console.debug('SSE parse error', err);
      }
    };

    evtSource.addEventListener('message', handleEvent);
    evtSource.addEventListener('error', (err) => console.debug('SSE error', err));

    return () => {
      evtSource.removeEventListener('message', handleEvent);
      evtSource.close();
    };
  }, [handleBitrateUpdate, streams, mergeHistoryToPoints]);

  const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/$/, "");

  const isValidStreamUrl = (url: string): boolean => {
  try {
    const lowerUrl = url.trim().toLowerCase();

    return (
      lowerUrl.startsWith("http://") ||
      lowerUrl.startsWith("https://") ||
      lowerUrl.startsWith("rtmp://") ||
      lowerUrl.startsWith("rtsp://") ||
      lowerUrl.startsWith("udp://") || // ✅ UDP support
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
    if (streams.some(s => normalizeUrl(s.url) === normalized)) {
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
      resolution: resolution,
    };

    // compute next list, set and persist immediately
    const next = [...streams, newStream];
    setStreams(next);
    // kick off server start + history fetch for the new stream
    setTimeout(() => ensureStartAndFetchHistory(newStream), 10);
    // persist to server/local
    void saveStreams(next);

    setStreamName("");
    setStreamUrl("");
    toast({
      title: "Stream Added",
      description: `Stream added successfully (${next.length}/12)`,
    });
  };

  
  const saveListToFile = () => {
  const listName = prompt("Enter a name for your stream list:");
  if (listName && listName.trim() !== "") {
    // Prepare content with list name on the first line
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
    if (text) {
      const lines = text.split(/\r?\n/).filter(Boolean);
      let listName = "";
      let streamLines = lines;

      if (lines[0].startsWith("ListName:")) {
        listName = lines[0].substring("ListName:".length).trim();
        streamLines = lines.slice(1);
        toast({
          title: "Loaded List Name",
          description: `Stream list: ${listName}`,
        });
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
          };
        })
        .filter((stream) => stream.url);

      setStreams(newStreams);
      // persist to server for authenticated user (and localStorage)
      void saveStreams(newStreams);

      // start and fetch history for loaded streams
      setTimeout(() => newStreams.forEach(s => ensureStartAndFetchHistory(s)), 20);
      toast({
        title: "List Loaded from File",
        description: `Loaded ${newStreams.length} stream(s) from file.`,
      });
    }
  };
  reader.readAsText(file);
  event.target.value = "";
};

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

  const handleResolutionChange = (streamId: string, newResolution: string) => {
    setStreams(prevStreams => {
      const newStreams = prevStreams.map(stream =>
        stream.id === streamId ? { ...stream, resolution: newResolution } : stream
      );

      const streamToRestart = newStreams.find(s => s.id === streamId);
      if (streamToRestart) {
        fetch(`${API_BASE}/restart-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            streamUrl: streamToRestart.url, 
            streamName: streamToRestart.name, 
            resolution: newResolution,
           
          })
        }).then(res => {
          if (res.ok) {
            toast({ title: 'Resolution Changed', description: `Stream ${streamToRestart.name} is restarting with ${newResolution}.` });
          } else {
            toast({ title: 'Error', description: 'Failed to change resolution.', variant: 'destructive' });
          }
        });
      }
      return newStreams;
    });
  };

  return (
  <div className="space-y-6 p-2">
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
      {/* Header */}
      <div className="space-y-6 mt-[-10px]">
        {/* Logo and Info Section */}
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
              {/* Stream Name and URL inputs in same line */}
              <div className="flex gap-2">
                {/* Stream Name: smaller width */}
                <Input
                  id="stream-name"
                  type="text"
                  placeholder="Stream Name"
                  value={streamName}
                  onChange={(e) => setStreamName(e.target.value)}
                  className="w-1/4 bg-input border-stream-border focus:ring-primary"
                />

                {/* Stream URL: larger width */}
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

            {/* Stream actions */}
            <div className="flex flex-wrap items-center gap-2 mt-2">
               {/* Add Stream Button */}
              {(!user || user.roles.add_streams) && (
              <Button
                onClick={addStream}
                disabled={streams.length >= 12}
                className="bg-gradient-primary hover:shadow-glow transition-all"
              >
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
              )}

              
              {/* Save List Button */}
              {(!user || user.roles.save_lists) && (
              <Button onClick={saveListToFile} variant="outline" disabled={streams.length === 0}>
                <Save className="h-4 w-4 mr-2" /> Save List
              </Button>
              )}

              {/* Load List Button */}
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

              {/* Grid Layout Select Dropdown */}
              <div className="flex items-center ml-auto">
                <label htmlFor="grid-layout" className="mr-2 text-sm text-muted-foreground">
                  Grid Layout:
                </label>
                <Select value={gridLayout} onValueChange={(v) => setGridLayout(v as "3-2" | "4-2" | "6-2")}>
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
                    <DropdownMenuItem key={`${it.key}-${it.filename}`} onSelect={() => {
                      window.open(`${API_BASE}/download-log/${it.key}/${it.filename}`, '_blank');
                    }}>
                      {it.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              )}
              {user?.role === 'admin' && (
                <Button variant="outline" size="icon" onClick={() => setManagementOpen(true)}>
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
                    window.location.href = '/login';
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

    {user?.role === 'admin' && (
        <ManagementDialog
          isOpen={isManagementOpen}
          onClose={() => setManagementOpen(false)}
        />
    )}

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
          {streams.map((stream) => {
            const bitrateHistory = allBitrateHistory
              .filter(point => typeof point[stream.id] === 'number')
              .map(point => ({ time: point.time, bitrate: point[stream.id] as number }));
            return (
              <div key={stream.id} className="relative">
                {/* Restart button positioned before stream card */}
                <div className="absolute bottom-2 right-2 z-20 flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={async () => {
                      try {
                        const body = { streamUrl: stream.url, streamName: stream.name, resolution: stream.resolution };
                        const res = await fetch(`${API_BASE}/restart-stream`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                        });
                        if (!res.ok) {
                          const txt = await res.text().catch(() => 'restart failed');
                          toast({ title: 'Restart Failed', description: txt, variant: 'destructive' });
                        } else {
                          const json = await res.json().catch(() => ({}));
                          // try to prime the server HLS by requesting start-stream (server will be idempotent)
                          try {
                            await fetch(`${API_BASE}/start-stream`, {
                              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamUrl: stream.url, streamName: stream.name, resolution: stream.resolution })
                            }).catch(() => null);
                          } catch (e) { void e; }

                          // nudge the player to reload by bumping reloadSignals
                          setReloadSignals(rs => ({ ...rs, [stream.id]: (rs[stream.id] || 0) + 1 }));
                          // reset failure count so status shows retrying/online
                          setFailureCounts(fc => ({ ...fc, [stream.id]: 0 }));
                          toast({ title: 'Restarted', description: `Restart requested for ${stream.name}` });
                        }
                      } catch (err) {
                        console.error('Restart request failed', err);
                        toast({ title: 'Restart Error', description: String(err), variant: 'destructive' });
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
                    try {
                      // Prefer stop by streamId so server can cleanup immediately
                      const res = await fetch(`${API_BASE}/stop-stream`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamId: stream.id })
                      });
                      if (!res.ok) {
                        // try stop by URL as a fallback
                        await fetch(`${API_BASE}/stop-stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamUrl: stream.url }) }).catch(() => null);
                      }
                    } catch (e) { console.debug('stop-stream request failed', e); }
                    // Remove locally regardless (server attempted stop). This ensures UI is responsive.
                    removeStream(stream.id);
                    toast({ title: 'Stream Removed', description: `${stream.name} has been removed.` });
                  }}
                  reloadSignal={reloadSignals[stream.id] || 0}
                  onBitrateUpdate={handleBitrateUpdate}
                  canRemove={!user || user.roles.delete_streams}
                  status={
                    (failureCounts[stream.id] || 0) === 0
                      ? 'online'
                      : (failureCounts[stream.id] || 0) < 3
                      ? 'offline'
                      : 'offline'
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>

    {/* All Streams Bitrate Graph */}
    {streams.length > 0 && (
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-2xl font-bold text-white">Real-time Bitrate Monitor: </h2>
            <span className="text-lg font-semibold text-blue-500">{latestTotalBitrate} Mbps</span>
          </div>
          <Select
            value={selectedGraphStream}
            onValueChange={setSelectedGraphStream}
          >
            <SelectTrigger className="w-[240px] bg-input border-stream-border">
              <SelectValue placeholder="Select a stream to display" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Streams</SelectItem>
              {streams.map((stream) => (
                <SelectItem key={stream.id}  value={stream.id}>
                  <div className="flex items-center">
                    <div
                      className="w-4 h-4 rounded-full mr-2"
                      style={{ backgroundColor: stream.color }}
                    />
                    {stream.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Card className="bg-gradient-card border-stream-border">
          <CardContent className="pt-2">
            <React.Suspense fallback={<div style={{height:600,display:'flex',alignItems:'center',justifyContent:'center',color:'#aaa'}}>Loading chart…</div>}>
              <AllBitrateGraph
                data={allBitrateHistory}
                streams={
                  selectedGraphStream === "all"
                    ? streams
                    : streams.filter((s) => s.id === selectedGraphStream)
                }
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

