import React, { useRef, useState, useEffect, useCallback } from "react";
import Hls from "hls.js";
import {
  X,
  AlertCircle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RefreshCcw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { AudioMeter } from "./ui/audio-meter";
import { getToken } from "@/lib/auth";

interface VideoPlayerProps {
  streamId: string;
  streamName: string;
  streamUrl: string;
  resolution: string;
  onResolutionChange: (streamId: string, newResolution: string) => void;
  onRemove: () => void;
  reloadSignal?: number;
  status?: "online" | "offline";
  onBitrateUpdate?: (streamId: string, bitrate: number | null) => void;
  className?: string;
  canRemove?: boolean;
}

// ---------- Base URLs ----------
const API_BASE =
  (import.meta.env.VITE_API_BASE?.replace(/\/+$/, "")) ||
  `${window.location.protocol}//${window.location.hostname}:3001`;

const HLS_BASE =
  (import.meta.env.VITE_HLS_BASE?.replace(/\/+$/, "")) ||
  `${window.location.protocol}//${window.location.hostname}:8000`;

// Is this URL already our own /live/... endpoint?
const isOurHlsUrl = (url: string): boolean => {
  try {
    const base = HLS_BASE || `${window.location.protocol}//${window.location.host}`;
    const u = new URL(url, base);
    const ourHost = new URL(base).host;
    return u.pathname.startsWith("/live/") && u.host === ourHost;
  } catch {
    return false;
  }
};

// Cache busting
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

const VideoPlayerMemo: React.FC<VideoPlayerProps> = ({
  streamId,
  streamName,
  streamUrl,
  resolution,
  onRemove,
  reloadSignal,
  status,
  onBitrateUpdate,
  className,
  canRemove = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorText, setErrorText] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  // IMPORTANT CHANGE: default TRUE so we start immediately (no waiting)
  const [isVisible, setIsVisible] = useState(true);

  const [computedStatus, setComputedStatus] = useState<"online" | "offline">("online");
  const [proxiedHlsUrl, setProxiedHlsUrl] = useState<string | null>(null);
  const [measuredBitrate, setMeasuredBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const audioLevels = useAudioLevels(videoRef);

  const fragLoadedRef = useRef(false);
  const manifestWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retryCountRef = useRef(0);
  const MAX_RETRIES = 10;

  const getStreamType = useCallback((url: string) => {
    if (url.includes(".m3u8")) return "HLS";
    if (url.startsWith("rtmp://")) return "RTMP";
    if (url.startsWith("rtsp://")) return "RTSP";
    if (url.startsWith("udp://")) return "UDP";
    if (url.startsWith("http://") || url.startsWith("https://")) return "HTTP";
    return "Direct";
  }, []);

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
  }, []);

  const initializeStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // Autoplay policies: start muted + inline
    video.muted = true;
    video.playsInline = true;

    if (!isVisible) return;

    setIsLoading(true);
    setHasError(false);
    setErrorText("");
    fragLoadedRef.current = false;

    if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    teardownPlayer();

    let finalStreamUrl: string = proxiedHlsUrl || streamUrl;
    const mustProxy = !finalStreamUrl.includes(".m3u8");
    const streamType = getStreamType(streamUrl);

    // If not .m3u8 or not our HLS endpoint -> request server proxy/start
    if (mustProxy || !isOurHlsUrl(finalStreamUrl)) {
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/start-stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ streamUrl, streamName, resolution }),
        });

        const dataRaw = await res.text();
        let parsed: { hlsAbsUrl?: string; hlsUrl?: string } | undefined;
        try {
          parsed = JSON.parse(dataRaw);
        } catch {
          // ignore
        }

        const hlsAbs =
          parsed?.hlsAbsUrl ||
          parsed?.hlsUrl ||
          (typeof dataRaw === "string" && dataRaw.trim());

        if (hlsAbs) {
          finalStreamUrl = hlsAbs.startsWith("/") ? `${HLS_BASE}${hlsAbs}` : hlsAbs;
          setProxiedHlsUrl(finalStreamUrl);
        } else {
          throw new Error("Server did not return HLS URL");
        }
      } catch (e) {
        if (mustProxy) {
          return handleError(`Failed to prepare server HLS proxy (${streamType}): ${String(e)}`);
        }
        // if it was already m3u8 but not ours, we can still attempt direct play
      }
    }

    finalStreamUrl = withCacheBuster(finalStreamUrl);

    // Watchdog: if manifest loads but no fragments, retry
    if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    manifestWatchRef.current = setTimeout(() => {
      if (!fragLoadedRef.current) {
        handleError("No HLS fragments received (timeout). Likely CORS/403/blocked segments.");
      }
    }, 12_000);

    // Capture HTML video errors too
    const onVideoError = () => {
      const code = video.error?.code;
      const msg =
        code === 1 ? "MEDIA_ERR_ABORTED" :
        code === 2 ? "MEDIA_ERR_NETWORK (network/CORS/blocked)" :
        code === 3 ? "MEDIA_ERR_DECODE (codec unsupported)" :
        code === 4 ? "MEDIA_ERR_SRC_NOT_SUPPORTED" :
        "Unknown video error";
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

      // IMPORTANT CHANGE: show real details (manifestLoadError / fragLoadError / HTTP codes)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const details = data?.details || "unknown";
        const type = data?.type || "unknown";
        const fatal = data?.fatal ? "fatal" : "non-fatal";
        const resp: any = (data as any)?.response;
        const statusCode = resp?.code ? `HTTP ${resp.code}` : "";
        const url = resp?.url ? `URL: ${resp.url}` : "";
        const reason = (data as any)?.error?.message ? `Reason: ${(data as any).error.message}` : "";

        console.error("HLS ERROR", data);

        if (data.fatal) {
          handleError(`HLS ${fatal}: ${type} / ${details} ${statusCode} ${url} ${reason}`.trim());
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
          })
          .catch((err) => handleError(`Playback failed: ${String(err)}`));
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
            })
            .catch((err) => handleError(`Playback failed: ${String(err)}`));
        },
        { once: true }
      );
      return;
    }

    handleError("HLS is not supported, and no native HLS playback is available.");
  }, [
    isVisible,
    proxiedHlsUrl,
    streamUrl,
    streamName,
    resolution,
    getStreamType,
    handleError,
    teardownPlayer,
    isMuted,
    onBitrateUpdate,
    streamId,
    status,
  ]);

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

  // Visibility observer (kept, but does NOT block startup anymore)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Start immediately on mount + whenever streamUrl changes/reloadKey changes
  useEffect(() => {
    retryCountRef.current = 0;
    initializeStream();

    return () => {
      teardownPlayer();
      if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
      if (teardownTimerRef.current) clearTimeout(teardownTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, streamUrl]);

  // Handle muted preference
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
      .catch(() => setHasError(true));
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

  return (
    <Card
      ref={containerRef}
      className={cn(
        "relative group overflow-hidden bg-gradient-card border-stream-border shadow-card",
        { "animate-border-blink": hasError },
        className
      )}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {canRemove && (
        <Button
          onClick={onRemove}
          variant="destructive"
          size="sm"
          className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <div
        className={cn(
          "absolute top-1 left-2 z-10 px-2 py-0.2 rounded text-xs font-semibold flex items-center gap-2",
          status === "online"
            ? "bg-green-700"
            : status === "offline"
            ? "bg-red-700"
            : "bg-primary/90"
        )}
      >
        <span className="text-[10px] text-white">{status ?? computedStatus}</span>
      </div>

      <AudioMeter
        leftLevel={audioLevels.left}
        rightLevel={audioLevels.right}
        className="absolute bottom-14 right-2 z-10"
      />

      <div className="relative h-57 w-25">
        <video
          ref={videoRef}
          className="w-full h-full object-cover bg-black"
          playsInline
          controls={false}
        />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-stream-bg">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-stream-bg text-destructive p-3 text-center">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm font-semibold">Failed to load stream</p>
            {errorText && (
              <p className="text-xs mt-2 break-words max-w-[95%] opacity-90">
                {errorText}
              </p>
            )}
            <Button onClick={initializeStream} variant="outline" size="sm" className="mt-3">
              <RefreshCcw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {showControls && !hasError && !isLoading && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
            <div className="flex items-center gap-4 bg-black/60 rounded-lg px-4 py-2">
              <Button
                onClick={togglePlay}
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/20"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>

              <Button
                onClick={toggleMute}
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/20"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>

              <Button
                onClick={toggleFullscreen}
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/20"
              >
                <Maximize className="h-4 w-4" />
              </Button>

              <Button
                onClick={() => {
                  setProxiedHlsUrl(null);
                  forceReload();
                }}
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/20"
              >
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
