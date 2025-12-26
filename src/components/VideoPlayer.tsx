import React, { useRef, useState, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { AlertCircle, Play, Pause, Volume2, VolumeX, Maximize, RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { AudioMeter } from "./ui/audio-meter";

type TrafficEventType = "NO_SIGNAL" | "FROZEN" | "BLACK" | "SILENT" | "BUFFERING" | "RECOVERED" | "ERROR";
type TrafficSeverity = "info" | "warn" | "critical";

interface VideoPlayerProps {
  streamId: string;
  streamName: string;
  streamUrl: string;
  reloadSignal?: number;
  status?: "online" | "offline";
  onBitrateUpdate?: (streamId: string, bitrate: number | null) => void;
  className?: string;
  onTrafficEvent?: (evt: {
    ts?: number;
    streamId: string;
    streamName: string;
    type: TrafficEventType;
    message: string;
    severity?: TrafficSeverity;
  }) => void;
}

const withCacheBuster = (url: string) => {
  const tick = Date.now().toString();
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("cb", tick);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${tick}`;
  }
};

const isHlsUrl = (url: string) => url.toLowerCase().includes(".m3u8");

const VideoPlayerMemo: React.FC<VideoPlayerProps> = ({
  streamId,
  streamName,
  streamUrl,
  reloadSignal,
  status,
  onBitrateUpdate,
  onTrafficEvent,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [computedStatus, setComputedStatus] = useState<"online" | "offline">("online");
  const [measuredBitrate, setMeasuredBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const audioLevels = useAudioLevels(videoRef);

  const fragLoadedRef = useRef(false);
  const manifestWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 8;

  // 🔥 Track active issues (per type)
  const activeIssuesRef = useRef<Set<TrafficEventType>>(new Set());

  // traffic dedupe
  const lastEvtRef = useRef<{ key: string; at: number } | null>(null);

  const emitTraffic = useCallback(
    (type: TrafficEventType, message: string, severity: TrafficSeverity = "info") => {
      const key = `${type}:${message}`;
      const now = Date.now();
      const last = lastEvtRef.current;

      if (last && last.key === key && now - last.at < 10_000) return;

      lastEvtRef.current = { key, at: now };

      onTrafficEvent?.({
        ts: now,
        streamId,
        streamName,
        type,
        message,
        severity,
      });
    },
    [onTrafficEvent, streamId, streamName]
  );

  const handleError = useCallback(
    (msg?: string) => {
      setHasError(true);
      setIsLoading(false);
      setErrorText(msg || "Failed to load stream");
      if (msg) console.error(`[${streamId}] ${msg}`);
    },
    [streamId]
  );

  const teardownPlayer = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    } catch (e) {
      console.warn("teardownPlayer: failed to destroy hls", e);
    }

    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
    } catch (e) {
      console.warn("teardownPlayer: failed to reset video element", e);
    }

    if (manifestWatchRef.current) {
      clearTimeout(manifestWatchRef.current);
      manifestWatchRef.current = null;
    }

    fragLoadedRef.current = false;
    setIsPlaying(false);
    activeIssuesRef.current.clear(); // 🔥 Clear issues on teardown
  }, []);

  const initializeStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.playsInline = true;

    if (!isVisible) return;

    setIsLoading(true);
    setHasError(false);
    setErrorText("");
    fragLoadedRef.current = false;
    activeIssuesRef.current.clear(); // 🔥 Reset issues on init

    if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    teardownPlayer();

    if (!isHlsUrl(streamUrl)) {
      setIsLoading(false);
      emitTraffic("ERROR", "This stream type needs a backend (RTMP/RTSP/UDP). Use an HLS .m3u8 URL.", "warn");
      return handleError("This stream type needs a backend (RTMP/RTSP/UDP). Please use an HLS .m3u8 URL.");
    }

    const finalStreamUrl = withCacheBuster(streamUrl);

    manifestWatchRef.current = setTimeout(() => {
      if (!fragLoadedRef.current) {
        const type: TrafficEventType = "NO_SIGNAL";
        activeIssuesRef.current.add(type); // 🔥 Track issue
        emitTraffic(type, "No HLS fragments received (timeout). Check CORS/403/blocked segments.", "critical");
        handleError("No HLS fragments received (timeout). Check CORS/403/blocked .ts/.m4s segments.");
      }
    }, 12_000);

    const onVideoError = () => {
      const code = video.error?.code;
      const msg =
        code === 1
          ? "MEDIA_ERR_ABORTED"
          : code === 2
          ? "MEDIA_ERR_NETWORK (network/CORS/blocked)"
          : code === 3
          ? "MEDIA_ERR_DECODE (codec unsupported)"
          : code === 4
          ? "MEDIA_ERR_SRC_NOT_SUPPORTED"
          : "Unknown video error";

      emitTraffic("ERROR", `Video element error: ${msg}`, "critical");
      handleError(`Video element error: ${msg}`);
    };
    video.addEventListener("error", onVideoError, { once: true });

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
        fragLoadedRef.current = true;
        const { frag } = data;
        if (frag?.stats && frag?.duration) {
          const mbps = (frag.stats.loaded * 8) / 1e6 / frag.duration;
          if (isFinite(mbps)) {
            onBitrateUpdate?.(streamId, mbps);
            if (!status) setComputedStatus("online");
            setMeasuredBitrate(mbps);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        const details = data?.details || "unknown";
        const type = data?.type || "unknown";
        const resp: any = (data as any)?.response;
        const statusCode = resp?.code ? `HTTP ${resp.code}` : "";
        console.error("HLS ERROR", data);

        if (data.fatal) {
          emitTraffic("ERROR", `HLS fatal: ${type}/${details} ${statusCode}`.trim(), "critical");

          if (
            String(type).toLowerCase().includes("network") ||
            String(details).toLowerCase().includes("frag") ||
            String(details).toLowerCase().includes("manifest")
          ) {
            const issueType: TrafficEventType = "NO_SIGNAL";
            activeIssuesRef.current.add(issueType); // 🔥 Track issue
            emitTraffic(issueType, `HLS fatal network issue: ${details} ${statusCode}`.trim(), "critical");
          }

          handleError(`HLS fatal: ${type} / ${details} ${statusCode}`.trim());
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        video.muted = isMuted;

        video
          .play()
          .then(() => {
            setIsPlaying(true);
            retryCountRef.current = 0;
            // 🔥 No active issues after successful play
            activeIssuesRef.current.clear();
          })
          .catch((err) => {
            emitTraffic("ERROR", `Playback failed: ${String(err)}`, "critical");
            handleError(`Playback failed: ${String(err)}`);
          });
      });

      hls.attachMedia(video);
      hls.loadSource(finalStreamUrl);
      return;
    }

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = finalStreamUrl;
      video.load();
      video.addEventListener(
        "loadedmetadata",
        () => {
          setIsLoading(false);
          video.muted = isMuted;
          video
            .play()
            .then(() => {
              setIsPlaying(true);
              retryCountRef.current = 0;
              activeIssuesRef.current.clear();
            })
            .catch((err) => {
              emitTraffic("ERROR", `Playback failed: ${String(err)}`, "critical");
              handleError(`Playback failed: ${String(err)}`);
            });
        },
        { once: true }
      );
      return;
    }

    emitTraffic("ERROR", "HLS is not supported in this browser.", "critical");
    handleError("HLS is not supported in this browser.");
  }, [isVisible, streamUrl, teardownPlayer, isMuted, onBitrateUpdate, streamId, status, handleError, emitTraffic]);

  // Retry logic
  useEffect(() => {
    if (!hasError) return;
    if (retryCountRef.current >= MAX_RETRIES) return;

    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      setHasError(false);
      setErrorText("");
      initializeStream();
    }, 2500);

    return () => clearTimeout(timer);
  }, [hasError, initializeStream]);

  const forceReload = useCallback(() => setReloadKey((prev) => prev + 1), []);

  useEffect(() => {
    if (typeof reloadSignal === "number") forceReload();
  }, [reloadSignal, forceReload]);

  useEffect(() => {
    if (status) return;
    if (measuredBitrate && measuredBitrate > 0) setComputedStatus("online");
    else setComputedStatus("offline");
  }, [status, measuredBitrate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    retryCountRef.current = 0;
    initializeStream();

    return () => {
      teardownPlayer();
      if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, streamUrl]);

  useEffect(() => {
    const savedMuted = localStorage.getItem("videoMuted") === "true";
    setIsMuted(savedMuted);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    video
      .play()
      .then(() => setIsPlaying(true))
      .catch((e) => {
        emitTraffic("ERROR", `Playback failed: ${String(e)}`, "critical");
        handleError(`Playback failed: ${String(e)}`);
      });
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const newMuted = !video.muted;
    video.muted = newMuted;
    setIsMuted(newMuted);
    localStorage.setItem("videoMuted", String(newMuted));
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;

    if (document.fullscreenElement) document.exitFullscreen();
    else video.requestFullscreen();
  };

  // 🔥 SMART RECOVERY: emit RECOVERED only if there were active issues
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlaying = () => {
      if (activeIssuesRef.current.size > 0) {
        // Only emit if there was an issue
        emitTraffic("RECOVERED", "Playback resumed after issue", "info");
        activeIssuesRef.current.clear(); // 🔥 Clear after recovery
      }
    };

    const onWaiting = () => {
      const type: TrafficEventType = "BUFFERING";
      activeIssuesRef.current.add(type);
      emitTraffic(type, "Video waiting (buffering)", "info");
    };

    const onStalled = () => {
      const type: TrafficEventType = "BUFFERING";
      activeIssuesRef.current.add(type);
      emitTraffic(type, "Video stalled", "warn");
    };

    v.addEventListener("playing", onPlaying);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("stalled", onStalled);

    return () => {
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("stalled", onStalled);
    };
  }, [emitTraffic]);

  // Frozen detector
  const freezeRef = useRef({ lastT: 0, stuck: 0 });
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const id = setInterval(() => {
      if (hasError || isLoading) return;
      if (v.paused) return;
      if (v.readyState < 2) return;

      const t = v.currentTime;
      const diff = Math.abs(t - freezeRef.current.lastT);

      if (diff < 0.01) {
        freezeRef.current.stuck += 1;
        if (freezeRef.current.stuck === 8 && !activeIssuesRef.current.has("FROZEN")) {
          activeIssuesRef.current.add("FROZEN");
          emitTraffic("FROZEN", "Video currentTime not advancing for ~8s", "warn");
        }
      } else {
        freezeRef.current.stuck = 0;
      }

      freezeRef.current.lastT = t;
    }, 1000);

    return () => clearInterval(id);
  }, [hasError, isLoading, emitTraffic]);

  // Silent audio detector
  const silenceRef = useRef({ hits: 0 });
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const id = setInterval(() => {
      if (hasError || isLoading) return;
      if (v.paused) return;
      if (v.readyState < 2) return;
      if (v.muted) return;

      const avg = (audioLevels.left + audioLevels.right) / 2;
      const SILENCE_THRESHOLD = 0.01;

      if (avg < SILENCE_THRESHOLD) {
        silenceRef.current.hits += 1;
        if (silenceRef.current.hits === 10 && !activeIssuesRef.current.has("SILENT")) {
          activeIssuesRef.current.add("SILENT");
          emitTraffic("SILENT", "Audio appears silent for ~10s while playback is active", "warn");
        }
      } else {
        silenceRef.current.hits = 0;
      }
    }, 1000);

    return () => clearInterval(id);
  }, [hasError, isLoading, emitTraffic, audioLevels.left, audioLevels.right]);

  // Black frame detector
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const blackRef = useRef({ hits: 0 });

  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 36;
    canvasRef.current = c;
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const id = setInterval(() => {
      if (hasError || isLoading) return;
      if (v.readyState < 2) return;
      if (!v.videoWidth || !v.videoHeight) return;

      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      try {
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height).data;

        let sum = 0;
        for (let i = 0; i < img.length; i += 4) sum += (img[i] + img[i + 1] + img[i + 2]) / 3;
        const avgBrightness = sum / (img.length / 4);

        if (avgBrightness < 12) {
          blackRef.current.hits += 1;
          if (blackRef.current.hits === 5 && !activeIssuesRef.current.has("BLACK")) {
            const audioAvg = (audioLevels.left + audioLevels.right) / 2;
            const audioPresent = audioAvg > 0.03;
            activeIssuesRef.current.add("BLACK");
            emitTraffic(
              "BLACK",
              audioPresent ? "Frame is black while audio is present" : "Frame is black (low brightness for ~10s)",
              audioPresent ? "critical" : "warn"
            );
          }
        } else {
          blackRef.current.hits = 0;
        }
      } catch {
        // CORS error → ignore
      }
    }, 2000);

    return () => clearInterval(id);
  }, [hasError, isLoading, emitTraffic, audioLevels.left, audioLevels.right]);

  return (
    <Card
      ref={containerRef}
      className={cn("relative group overflow-hidden bg-gradient-card border-stream-border shadow-card", { "animate-border-blink": hasError }, className)}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      <div
        className={cn(
          "absolute top-1 left-2 z-10 px-2 py-0.2 rounded text-xs font-semibold flex items-center gap-2",
          status === "online" ? "bg-green-700" : status === "offline" ? "bg-red-700" : "bg-primary/90"
        )}
      >
        <span className="text-[10px] text-white">{status ?? computedStatus}</span>
      </div>

      <AudioMeter leftLevel={audioLevels.left} rightLevel={audioLevels.right} className="absolute bottom-14 right-2 z-10" />

      <div className="relative h-57 w-25">
        <video ref={videoRef} className="w-full h-full object-cover bg-black" playsInline controls={false} />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-stream-bg">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-stream-bg text-destructive p-3 text-center">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm font-semibold">Failed to load stream</p>
            {errorText && <p className="text-xs mt-2 break-words max-w-[95%] opacity-90">{errorText}</p>}
            <Button onClick={initializeStream} variant="outline" size="sm" className="mt-3">
              <RefreshCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {showControls && !hasError && !isLoading && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
            <div className="flex items-center gap-4 bg-black/60 rounded-lg px-4 py-2">
              <Button onClick={togglePlay} variant="ghost" size="sm" className="text-white hover:bg-white/20">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>

              <Button onClick={toggleMute} variant="ghost" size="sm" className="text-white hover:bg-white/20">
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>

              <Button onClick={toggleFullscreen} variant="ghost" size="sm" className="text-white hover:bg-white/20">
                <Maximize className="h-4 w-4" />
              </Button>

              <Button onClick={() => setReloadKey((p) => p + 1)} variant="ghost" size="sm" className="text-white hover:bg-white/20">
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="p-3 bg-stream-bg border-t border-stream-border">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{streamName}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{streamUrl}</p>
          </div>
        </div>
      </div>
    </Card>
  );
};

export const VideoPlayer = React.memo(VideoPlayerMemo);
