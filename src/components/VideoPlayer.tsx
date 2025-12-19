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
  const [isVisible, setIsVisible] = useState(true);

  const [computedStatus, setComputedStatus] = useState<"online" | "offline">("online");
  const [proxiedHlsUrl, setProxiedHlsUrl] = useState<string | null>(null);
  const [measuredBitrate, setMeasuredBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const audioLevels = useAudioLevels(videoRef);

  const fragLoadedRef = useRef(false);
  const manifestWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retryCountRef = useRef(0);
  const MAX_RETRIES = 10;

  // ✅ NEW: prevents race between teardown/init
  const initSeqRef = useRef(0);

  // ✅ NEW: track video error listener so we can remove it
  const videoErrorHandlerRef = useRef<((this: HTMLVideoElement, ev: Event) => any) | null>(
    null
  );

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

  // ✅ HARD teardown in correct order
  const teardownPlayer = useCallback(() => {
    const video = videoRef.current;

    // bump init sequence to invalidate old callbacks
    initSeqRef.current += 1;

    // clear timers
    if (manifestWatchRef.current) {
      clearTimeout(manifestWatchRef.current);
      manifestWatchRef.current = null;
    }

    // remove video error handler
    if (video && videoErrorHandlerRef.current) {
      try {
        video.removeEventListener("error", videoErrorHandlerRef.current);
      } catch {}
      videoErrorHandlerRef.current = null;
    }

    // stop/detach/destroy HLS in safest order
    const hls = hlsRef.current;
    if (hls) {
      try {
        hls.stopLoad();
      } catch {}
      try {
        hls.detachMedia();
      } catch {}
      try {
        hls.destroy();
      } catch {}
      hlsRef.current = null;
    }

    // reset video last (after HLS is gone)
    if (video) {
      try {
        video.pause();
      } catch {}
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
    }

    fragLoadedRef.current = false;
    setIsPlaying(false);
  }, []);

  const safePlay = useCallback(async (seq: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (seq !== initSeqRef.current) return;

    video.muted = isMuted;

    try {
      await video.play();
      if (seq !== initSeqRef.current) return;
      setIsPlaying(true);
      retryCountRef.current = 0;
    } catch (err) {
      if (seq !== initSeqRef.current) return;
      handleError(`Playback failed: ${String(err)}`);
    }
  }, [handleError, isMuted]);

  const initializeStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // Create a new init "session"
    const seq = ++initSeqRef.current;

    // basic autoplay policy
    video.muted = true;
    video.playsInline = true;

    if (!isVisible) return;

    setIsLoading(true);
    setHasError(false);
    setErrorText("");
    fragLoadedRef.current = false;

    // ✅ teardown any previous HLS first
    teardownPlayer();

    // after teardown, make sure this init is still the latest
    if (seq !== initSeqRef.current) return;

    let finalStreamUrl: string = proxiedHlsUrl || streamUrl;
    const mustProxy = !finalStreamUrl.includes(".m3u8");
    const streamType = getStreamType(streamUrl);

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
        } catch {}

        const hlsAbs =
          parsed?.hlsAbsUrl || parsed?.hlsUrl || (typeof dataRaw === "string" && dataRaw.trim());

        if (hlsAbs) {
          finalStreamUrl = hlsAbs.startsWith("/") ? `${HLS_BASE}${hlsAbs}` : hlsAbs;
          setProxiedHlsUrl(finalStreamUrl);
        } else {
          throw new Error("Server did not return HLS URL");
        }
      } catch (e) {
        if (mustProxy) {
          if (seq !== initSeqRef.current) return;
          return handleError(`Failed to prepare server HLS proxy (${streamType}): ${String(e)}`);
        }
      }
    }

    if (seq !== initSeqRef.current) return;
    finalStreamUrl = withCacheBuster(finalStreamUrl);

    // watchdog
    if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    manifestWatchRef.current = setTimeout(() => {
      if (seq !== initSeqRef.current) return;
      if (!fragLoadedRef.current) {
        handleError("No HLS fragments received (timeout). Likely CORS/403/blocked segments.");
      }
    }, 12_000);

    // video element error listener (removable)
    const onVideoError = () => {
      if (seq !== initSeqRef.current) return;
      const code = video.error?.code;
      const msg =
        code === 1 ? "MEDIA_ERR_ABORTED" :
        code === 2 ? "MEDIA_ERR_NETWORK (network/CORS/blocked)" :
        code === 3 ? "MEDIA_ERR_DECODE (codec unsupported)" :
        code === 4 ? "MEDIA_ERR_SRC_NOT_SUPPORTED" :
        "Unknown video error";
      handleError(`Video element error: ${msg}`);
    };
    videoErrorHandlerRef.current = onVideoError;
    video.addEventListener("error", onVideoError);

    // Hls.js
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,

        // ✅ helps reduce buffer weirdness during quick reloads
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
        if (seq !== initSeqRef.current) return;
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

      // ✅ CRITICAL: recover / recreate on specific fatal errors
      hls.on(Hls.Events.ERROR, async (_event, data) => {
        if (seq !== initSeqRef.current) return;

        const details = data?.details || "unknown";
        const type = data?.type || "unknown";
        const resp: any = (data as any)?.response;
        const statusCode = resp?.code ? `HTTP ${resp.code}` : "";
        const url = resp?.url ? `URL: ${resp.url}` : "";
        const reason = (data as any)?.error?.message ? `Reason: ${(data as any).error.message}` : "";

        console.error("HLS ERROR", data);

        // Non-fatal: let hls handle
        if (!data.fatal) return;

        // Fatal media error: try recoverMediaError()
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch {
            // fallthrough to full recreate
          }
        }

        // Fatal appendBuffer / buffer errors: full recreate is most reliable
        const isAppendOrBuffer =
          details === Hls.ErrorDetails.BUFFER_APPEND_ERROR ||
          details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
          details === Hls.ErrorDetails.BUFFER_FULL_ERROR;

        if (isAppendOrBuffer) {
          // Avoid “appendBuffer on removed SourceBuffer” by tearing down fully
          teardownPlayer();
          if (seq !== initSeqRef.current) return;
          // small delay helps browser release MediaSource
          setTimeout(() => {
            if (seq !== initSeqRef.current) return;
            void initializeStream();
          }, 250);
          return;
        }

        // Any other fatal: show error (and your retry effect can re-init)
        handleError(`HLS fatal: ${type} / ${details} ${statusCode} ${url} ${reason}`.trim());
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (seq !== initSeqRef.current) return;
        setIsLoading(false);
        void safePlay(seq);
      });

      // ✅ attach first, then loadSource (recommended pattern)
      hls.attachMedia(video);
      hls.loadSource(finalStreamUrl);
      return;
    }

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = finalStreamUrl;
      video.load();

      const onLoaded = () => {
        if (seq !== initSeqRef.current) return;
        setIsLoading(false);
        void safePlay(seq);
      };

      video.addEventListener("loadedmetadata", onLoaded, { once: true });
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
    safePlay,
    onBitrateUpdate,
    streamId,
    status,
  ]);

  // Retry logic (kept)
  useEffect(() => {
    if (!hasError) return;
    if (retryCountRef.current >= MAX_RETRIES) return;

    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      setHasError(false);
      setErrorText("");
      void initializeStream();
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
    void initializeStream();

    return () => {
      teardownPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, streamUrl, resolution]);

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
            <Button
              onClick={() => void initializeStream()}
              variant="outline"
              size="sm"
              className="mt-3"
            >
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
