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
  // keep prop for compatibility if your StreamManager passes it
  prefetchedHlsUrl?: string | null;
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

const isM3u8 = (url: string) => url.toLowerCase().includes(".m3u8");

const VideoPlayerMemo: React.FC<VideoPlayerProps> = ({
  streamId,
  streamName,
  streamUrl,
  resolution, // kept (not used here)
  onRemove,
  reloadSignal,
  status,
  onBitrateUpdate,
  className,
  canRemove = true,
  prefetchedHlsUrl,
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
  const MAX_RETRIES = 10;

  const initSeqRef = useRef(0);

  const videoErrorHandlerRef = useRef<((this: HTMLVideoElement, ev: Event) => any) | null>(null);

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
    const video = videoRef.current;

    initSeqRef.current += 1;

    if (manifestWatchRef.current) {
      clearTimeout(manifestWatchRef.current);
      manifestWatchRef.current = null;
    }

    if (video && videoErrorHandlerRef.current) {
      try {
        video.removeEventListener("error", videoErrorHandlerRef.current);
      } catch {}
      videoErrorHandlerRef.current = null;
    }

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

  const safePlay = useCallback(
    async (seq: number) => {
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
    },
    [handleError, isMuted]
  );

  const initializeStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const seq = ++initSeqRef.current;

    video.muted = true;
    video.playsInline = true;

    if (!isVisible) return;

    setIsLoading(true);
    setHasError(false);
    setErrorText("");
    fragLoadedRef.current = false;

    teardownPlayer();
    if (seq !== initSeqRef.current) return;

    // ✅ Supabase-only: only direct HLS allowed
    const directUrl = (prefetchedHlsUrl || streamUrl || "").trim();
    if (!directUrl) return handleError("Missing stream URL.");
    if (!isM3u8(directUrl)) {
      return handleError("Supabase-only mode: this player supports only direct HLS (.m3u8) URLs.");
    }

    const finalStreamUrl = withCacheBuster(directUrl);

    if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);
    manifestWatchRef.current = setTimeout(() => {
      if (seq !== initSeqRef.current) return;
      if (!fragLoadedRef.current) {
        handleError("No HLS fragments received (timeout). Likely CORS/403/blocked segments.");
      }
    }, 12_000);

    const onVideoError = () => {
      if (seq !== initSeqRef.current) return;
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
      handleError(`Video element error: ${msg}`);
    };
    videoErrorHandlerRef.current = onVideoError;
    video.addEventListener("error", onVideoError);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
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

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (seq !== initSeqRef.current) return;
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch {}
        }

        handleError(`HLS fatal: ${data.type} / ${data.details}`);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (seq !== initSeqRef.current) return;
        setIsLoading(false);
        void safePlay(seq);
      });

      hls.attachMedia(video);
      hls.loadSource(finalStreamUrl);
      return;
    }

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
  }, [isVisible, prefetchedHlsUrl, streamUrl, teardownPlayer, safePlay, handleError, onBitrateUpdate, streamId, status]);

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

    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      threshold: 0.1,
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    retryCountRef.current = 0;
    void initializeStream();

    return () => {
      teardownPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, streamUrl, resolution]);

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

    video.play().then(() => setIsPlaying(true)).catch(() => setHasError(true));
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
            <Button onClick={() => void initializeStream()} variant="outline" size="sm" className="mt-3">
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

              <Button onClick={forceReload} variant="ghost" size="sm" className="text-white hover:bg-white/20">
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
