import React, { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { X, AlertCircle, Play, Pause, Volume2, VolumeX, Maximize, RefreshCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAudioLevels } from '@/hooks/use-audio-levels';
import { AudioMeter } from './ui/audio-meter';

interface VideoPlayerProps {
  streamId: string;
  streamName: string;
  streamUrl: string;
  resolution: string;
  onResolutionChange: (streamId: string, newResolution: string) => void;
  onRemove: () => void;
  reloadSignal?: number;
  status?: 'online' | 'offline';
  onBitrateUpdate?: (streamId: string, bitrate: number | null) => void;
  className?: string;
  canRemove?: boolean;
}

// ---------- Base URLs (use .env when provided) ----------
const API_BASE =
  (import.meta.env.VITE_API_BASE?.replace(/\/+$/, '')) ||
  `${window.location.protocol}//${window.location.hostname}:3001`;

const HLS_BASE = (import.meta.env.VITE_HLS_BASE?.replace(/\/+$/, '')) || `${window.location.protocol}//${window.location.hostname}:8000`;

// Is this URL already our own /live/... endpoint?
const isOurHlsUrl = (url: string): boolean => {
  try {
    const base = HLS_BASE || `${window.location.protocol}//${window.location.host}`;
    const u = new URL(url, base); // handle relative
    const ourHost = new URL(base).host;
    return u.pathname.startsWith('/live/') && u.host === ourHost;
  } catch {
    return false;
  }
};

// ---------- Cache-busting helper ----------
const withCacheBuster = (url: string) => {
  const tick = Date.now().toString();
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('cb', tick);
    return u.toString();
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}cb=${tick}`;
  }
};

// TODO: Replace this with your actual user retrieval logic
const getUser = (): { username: string } | null => {
  // Example: retrieving from localStorage
  // const userStr = localStorage.getItem('user');
  // if (userStr) return JSON.parse(userStr);
  return { username: 'default-user' }; // Placeholder
};

const VideoPlayerMemo: React.FC<VideoPlayerProps> = ({
  streamId,
  streamName,
  streamUrl,
  resolution,
  onResolutionChange,
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
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false); // Default to false
  const [computedStatus, setComputedStatus] = useState<'online' | 'offline' >('online');
  const [proxiedHlsUrl, setProxiedHlsUrl] = useState<string | null>(null);
  const [measuredBitrate, setMeasuredBitrate] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const audioLevels = useAudioLevels(videoRef);
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastApiFetchRef = useRef<number>(0);
  const fragLoadedRef = useRef(true);
  const manifestWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getStreamType = useCallback((url: string) => {
    if (url.includes(".m3u8")) return "HLS";
    if (url.startsWith("rtmp://")) return "RTMP";
    if (url.startsWith("rtsp://")) return "RTSP";
    if (url.startsWith("udp://")) return "UDP";
    if (url.startsWith("http://") || url.startsWith("https://")) return "HTTP";
    return "Direct";
  }, []);

  const handleError = useCallback((msg?: string) => {
    setHasError(true);
    setIsLoading(false);
    if (msg) console.error(`[${streamId}] ${msg}`);
  }, [streamId]);

  const retryCountRef = useRef(0);
  const MAX_RETRIES = 10;

  const teardownPlayer = useCallback((video?: HTMLVideoElement) => {
    const v = video ?? videoRef.current;
    if (!v) return;

    // destroy HLS/player instance if present
    try {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    } catch (e) {
      console.warn('teardownPlayer: failed to destroy hls', e);
    }

    // stop and reset video element
    try {
      v.pause();
      v.removeAttribute('src');
      v.load();
    } catch (e) {
      console.warn('teardownPlayer: failed to reset video element', e);
    }

    // clear timers/listeners stored in refs
    if (manifestWatchRef.current) {
      clearTimeout(manifestWatchRef.current);
      manifestWatchRef.current = null;
    }

    fragLoadedRef.current = false;

    // reset UI state where appropriate (include only setters actually used)
    setIsLoading(false);
    setHasError(false);

    // ...any additional cleanup you had...
  }, [setIsLoading, setHasError]);

  // Place initializeStream AFTER teardownPlayer so it's safe to call here
const initializeStream = useCallback(async () => {
  const video = videoRef.current;
  if (!video) return;

  // Always start muted for autoplay
  video.muted = true;
  video.playsInline = true;

  if (!isVisible) return;

  setIsLoading(true);
  setHasError(false);
  fragLoadedRef.current = false;

  if (manifestWatchRef.current) clearTimeout(manifestWatchRef.current);

  teardownPlayer(video);

  let finalStreamUrl: string = proxiedHlsUrl || streamUrl;
  const streamType = getStreamType(streamUrl);
  const mustProxy = !finalStreamUrl.includes('.m3u8');

  if (mustProxy || !isOurHlsUrl(finalStreamUrl)) {
    try {
      const currentUser = getUser();
      const res = await fetch(`${API_BASE}/start-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamUrl, streamName, resolution, username: currentUser?.username }),
      });
      const dataRaw = await res.text();
      let parsed: { hlsAbsUrl?: string, hlsUrl?: string } | undefined;
      try { parsed = JSON.parse(dataRaw); } catch { /* no-op */ }

      const hlsAbs = parsed?.hlsAbsUrl || parsed?.hlsUrl || (typeof dataRaw === 'string' && dataRaw.trim());

      if (hlsAbs) {
        finalStreamUrl = hlsAbs.startsWith('/') ? `${HLS_BASE}${hlsAbs}` : hlsAbs;
      } else {
        throw new Error('Server did not return HLS URL');
      }
    } catch (e) {
      if (mustProxy) return handleError(`Failed to prepare server HLS proxy: ${e}`);
    }
  }

  finalStreamUrl = withCacheBuster(finalStreamUrl);

  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hlsRef.current = hls;

    hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
      fragLoadedRef.current = true;
      const { frag } = data;
      if (frag.stats && frag.duration) {
        const mbps = (frag.stats.loaded * 8) / 1e6 / frag.duration;
        if (isFinite(mbps)) {
          onBitrateUpdate?.(streamId, mbps);
          if (!status) setComputedStatus('online');
          setMeasuredBitrate(mbps);
        }
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.error('HLS fatal error', data);
        handleError(`HLS Error: ${data.details}`);
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setIsLoading(false);
      video.muted = isMuted; // sync with UI toggle
      video.play().then(() => setIsPlaying(true)).catch(err => handleError(`Playback failed: ${err}`));
      retryCountRef.current = 0; // reset retry count on success
    });

    hls.attachMedia(video);
    hls.loadSource(finalStreamUrl);

  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = finalStreamUrl;
    video.load();
    video.addEventListener("loadedmetadata", () => {
      setIsLoading(false);
      video.muted = isMuted;
      video.play().then(() => setIsPlaying(true)).catch(err => handleError(`Playback failed: ${err}`));
    }, { once: true });
  } else {
    handleError("HLS is not supported, and no native HLS playback is available.");
  }
}, [
  streamUrl, getStreamType, handleError, proxiedHlsUrl, status,
  streamId, onBitrateUpdate, isVisible, teardownPlayer, streamName, resolution, isMuted
]);

  // Retry effect: runs after initializeStream is defined and when hasError becomes true
  useEffect(() => {
    if (!hasError) return;
    if (retryCountRef.current >= MAX_RETRIES) return;

    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      setHasError(false); // clear error state before retrying
      initializeStream();
    }, 2500);

    return () => clearTimeout(timer);
  }, [hasError, initializeStream]);

  const forceReload = useCallback(() => setReloadKey(prev => prev + 1), []);
  useEffect(() => { if (typeof reloadSignal === 'number') forceReload(); }, [reloadSignal, forceReload]);

  useEffect(() => {
    if (status) return;

    if (measuredBitrate && measuredBitrate > 0) {
      setComputedStatus('online');
    } else {
      setComputedStatus('offline');
    }
  }, [status, measuredBitrate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 } // Trigger when 10% is visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isVisible) {
      // If it becomes visible, clear any pending teardown
      if (teardownTimerRef.current) {
        clearTimeout(teardownTimerRef.current);
        teardownTimerRef.current = null;
      }
      // Only initialize if the player isn't already set up
      if (!hlsRef.current) {
        initializeStream();
      }
    
    }
  }, [isVisible, initializeStream, teardownPlayer]);

  useEffect(() => {
    const savedMuted = localStorage.getItem("videoMuted") === "true";
    setIsMuted(savedMuted);
    const v = videoRef.current;
    const manifestWatcher = manifestWatchRef.current;
    const teardownTimer = teardownTimerRef.current;
    return () => {
      teardownPlayer(v);
      if (manifestWatcher) clearTimeout(manifestWatcher);
      if (teardownTimer) clearTimeout(teardownTimer);
    };
  }, [reloadKey, teardownPlayer]);

  const togglePlay = () => {
    const video = videoRef.current; if (!video) return;
    if (isPlaying) { video.pause(); setIsPlaying(false); }
    else { video.play().then(() => setIsPlaying(true)).catch(() => setHasError(true)); }
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    const newMuted = !video.muted;

    // Unmute only after user interaction
    video.muted = newMuted;
    setIsMuted(newMuted);
    localStorage.setItem("videoMuted", String(newMuted));
  };

  const toggleFullscreen = () => {
    const video = videoRef.current; if (!video) return;
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else { video.requestFullscreen(); }
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
          "absolute top-1 left-2 z-10 px-2 py-0.2 rounded text-xs font-semibold size flex items-center gap-2",
          status === 'online' ? 'bg-green-700'
           : status === 'offline' ? 'bg-red-700'
            : 'bg-primary/90'
        )}
      >
        <span className="text-[10px] text-white ">
          {status ?? computedStatus}
        </span>
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
