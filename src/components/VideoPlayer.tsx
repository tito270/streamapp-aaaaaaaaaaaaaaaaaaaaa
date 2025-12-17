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
  const hlsRef = useRef<Hls | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [computedStatus, setComputedStatus] = useState<"online" | "offline">("online");
  const [measuredBitrate, setMeasuredBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const audioLevels = useAudioLevels(videoRef);

  const retryCountRef = useRef(0);
  const MAX_RETRIES = 10;

  const teardownPlayer = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;

    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    } catch {}

    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
    } catch {}

    setIsPlaying(false);
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

    setIsLoading(true);
    setHasError(false);

    teardownPlayer();

    // IMPORTANT: browser can play ONLY HLS (.m3u8) directly
    const finalUrl = withCacheBuster(streamUrl);

    video.muted = true;
    video.playsInline = true;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;

      hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
        const { frag } = data;
        if (frag.stats && frag.duration) {
          const mbps = (frag.stats.loaded * 8) / 1e6 / frag.duration;
          if (isFinite(mbps)) {
            onBitrateUpdate?.(streamId, mbps);
            if (!status) setComputedStatus("online");
            setMeasuredBitrate(mbps);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error("HLS fatal error", data);
          handleError(`HLS Error: ${data.details}`);
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
          .catch((err) => handleError(`Playback failed: ${err}`));
      });

      hls.attachMedia(video);
      hls.loadSource(finalUrl);
      return;
    }

    // Safari native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = finalUrl;
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
            .catch((err) => handleError(`Playback failed: ${err}`));
        },
        { once: true }
      );
      return;
    }

    handleError("HLS is not supported in this browser.");
  }, [streamUrl, teardownPlayer, handleError, streamId, onBitrateUpdate, status, isMuted]);

  // ✅ Start immediately on mount + on reloadSignal
  const forceReload = useCallback(() => setReloadKey((k) => k + 1), []);
  useEffect(() => { forceReload(); }, [reloadSignal, forceReload]);

  useEffect(() => {
    retryCountRef.current = 0;
    void initializeStream();
    return () => teardownPlayer();
  }, [reloadKey, initializeStream, teardownPlayer]);

  // retry loop
  useEffect(() => {
    if (!hasError) return;
    if (retryCountRef.current >= MAX_RETRIES) return;

    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      setHasError(false);
      void initializeStream();
    }, 2500);

    return () => clearTimeout(timer);
  }, [hasError, initializeStream]);

  // status from bitrate if not provided
  useEffect(() => {
    if (status) return;
    if (measuredBitrate && measuredBitrate > 0) setComputedStatus("online");
    else setComputedStatus("offline");
  }, [status, measuredBitrate]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play().then(() => setIsPlaying(true)).catch(() => setHasError(true));
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

  useEffect(() => {
    const savedMuted = localStorage.getItem("videoMuted") === "true";
    setIsMuted(savedMuted);
  }, []);

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
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-stream-bg text-destructive">
            <AlertCircle className="h-8 w-8 mb-2" />
            <p className="text-sm mb-4">Failed to load stream</p>
            <Button onClick={() => void initializeStream()} variant="outline" size="sm">
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
