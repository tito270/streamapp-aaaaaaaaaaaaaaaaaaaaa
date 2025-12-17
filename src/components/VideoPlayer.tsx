import React, { useRef, useState, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { X, AlertCircle, Play, Pause, Volume2, VolumeX, Maximize, RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioLevels } from "@/hooks/use-audio-levels";
import { AudioMeter } from "./ui/audio-meter";

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

// ---------- Base URLs (use .env when provided) ----------
const API_BASE =
  (import.meta.env.VITE_API_BASE?.replace(/\/+$/, "")) ||
  `${window.location.protocol}//${window.location.hostname}:3001`;

// If you don't have a separate HLS server on Lovable, keep this but it won't be used for direct .m3u8 playback.
const HLS_BASE =
  (import.meta.env.VITE_HLS_BASE?.replace(/\/+$/, "")) ||
  `${window.location.protocol}//${window.location.hostname}:8000`;

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

const isHlsPlaylist = (url: string) => /\.m3u8(\?|#|$)/i.test(url.trim());

const VideoPlayerMemo: React.FC<VideoPlayerProps> = ({
  streamId,
  streamName,
  streamUrl,
  resolution,
  onResolutionChange, // kept for compatibility
  onRemove,
  reloadSignal,
  status,
  onBitrateUpdate,
  className,
  canRemove = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showControls, setShowControls] = useState(false);

  const audioLevels = useAudioLevels(videoRef);

  const teardownPlayer = useCallback(() => {
    const v = videoRef.current;
    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    } catch {}

    try {
      if (v) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
    } catch {}
  }, []);

  const handleError = useCallback(
    (msg?: string) => {
      setHasError(true);
      setIsLoading(false);
      if (msg) console.error(`[${streamId}] ${msg}`);
    },
    [streamId]
  );

  const initializeStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // IMPORTANT: start immediately (no IntersectionObserver gating)
    setIsLoading(true);
    setHasError(false);

    teardownPlayer();

    // Autoplay on most browsers requires muted
    video.muted = true;
    video.playsInline = true;

    // ✅ If user provided HLS (.m3u8), play it directly. Do NOT call /start-stream.
    let finalUrl = streamUrl.trim();

    if (isHlsPlaylist(finalUrl)) {
      finalUrl = withCacheBuster(finalUrl);
    } else {
      // Non-HLS URLs need server transcoding -> on Lovable this usually won't work.
      // We still try your backend endpoint if you have one somewhere else.
      try {
        const res = await fetch(`${API_BASE}/start-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ streamUrl, streamName, resolution }),
        });

        const txt = await res.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(txt);
        } catch {}

        const hlsAbs = parsed?.hlsAbsUrl || parsed?.hlsUrl || txt?.trim();
        if (!hlsAbs) throw new Error("Server did not return HLS URL");

        finalUrl = hlsAbs.startsWith("/") ? `${HLS_BASE}${hlsAbs}` : hlsAbs;
        finalUrl = withCacheBuster(finalUrl);
      } catch (e: any) {
        handleError(`This URL is not HLS (.m3u8) and cannot be played without a transcoder. ${String(e?.message || e)}`);
        return;
      }
    }

    // ---- HLS playback ----
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,

        // faster startup tuning
        startPosition: -1,
        maxBufferLength: 10,
        backBufferLength: 10,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,

        // aggressive timeouts so it fails fast instead of "loading forever"
        manifestLoadingTimeOut: 8000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 8000,
        levelLoadingMaxRetry: 2,
        fragLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 2,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
        try {
          const { frag } = data as any;
          if (frag?.stats && frag?.duration) {
            const mbps = (frag.stats.loaded * 8) / 1e6 / frag.duration;
            if (isFinite(mbps)) onBitrateUpdate?.(streamId, mbps);
          }
        } catch {}
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          console.error("HLS fatal error", data);
          handleError(`HLS fatal error: ${data?.details || "unknown"}`);
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, async () => {
        setIsLoading(false);
        try {
          video.muted = isMuted;
          await video.play();
          setIsPlaying(true);
        } catch (e: any) {
          // If autoplay blocked, user must click play — still not an error.
          console.warn("Autoplay blocked:", e?.message || e);
          setIsPlaying(false);
        }
      });

      hls.attachMedia(video);
      hls.loadSource(finalUrl);
      return;
    }

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = finalUrl;
      video.addEventListener(
        "loadedmetadata",
        async () => {
          setIsLoading(false);
          try {
            video.muted = isMuted;
            await video.play();
            setIsPlaying(true);
          } catch {
            setIsPlaying(false);
          }
        },
        { once: true }
      );
      return;
    }

    handleError("HLS not supported in this browser.");
  }, [API_BASE, HLS_BASE, streamId, streamUrl, streamName, resolution, isMuted, teardownPlayer, handleError, onBitrateUpdate]);

  // Init on mount and on reloadSignal changes
  useEffect(() => {
    initializeStream();
    return () => teardownPlayer();
  }, [initializeStream, teardownPlayer]);

  useEffect(() => {
    if (typeof reloadSignal === "number") initializeStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setHasError(true);
      }
    }
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
          "absolute top-1 left-2 z-10 px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-2",
          status === "online" ? "bg-green-700" : status === "offline" ? "bg-red-700" : "bg-primary/90"
        )}
      >
        <span className="text-[10px] text-white">{status ?? "online"}</span>
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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-stream-bg text-destructive">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm mb-4">Failed to load stream</p>
            <Button onClick={initializeStream} variant="outline" size="sm">
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
              <Button onClick={initializeStream} variant="ghost" size="sm" className="text-white hover:bg-white/20">
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="p-3 bg-stream-bg border-t border-stream-border">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{streamName}</p>
              <p className="text-xs text-muted-foreground font-mono truncate">{streamUrl}</p>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export const VideoPlayer = React.memo(VideoPlayerMemo);
