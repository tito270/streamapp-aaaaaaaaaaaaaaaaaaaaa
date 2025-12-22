import { useState, useEffect, useRef } from "react";

interface WindowWithAudioContext extends Window {
  webkitAudioContext: typeof AudioContext;
}

export const useAudioLevels = (videoRef: React.RefObject<HTMLVideoElement>) => {
  const [audioLevels, setAudioLevels] = useState({ left: 0, right: 0 });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const animationFrameId = useRef<number>(0);

  // ✅ prevent "MediaElementSource already created for this element"
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const setupAudioContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          (window as unknown as WindowWithAudioContext).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;

      // ✅ Source only once per element
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaElementSource(videoElement);
      }

      const source = sourceRef.current;

      const splitter = audioContext.createChannelSplitter(2);

      analyserLRef.current = audioContext.createAnalyser();
      analyserRRef.current = audioContext.createAnalyser();

      const analyserL = analyserLRef.current;
      const analyserR = analyserRRef.current;

      analyserL.fftSize = 32;
      analyserR.fftSize = 32;

      source.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);

      // ✅ silent sink to keep graph alive but no audible output
      const gain = audioContext.createGain();
      gain.gain.value = 0;

      analyserL.connect(gain);
      analyserR.connect(gain);
      gain.connect(audioContext.destination);

      const dataArrayL = new Uint8Array(analyserL.frequencyBinCount);
      const dataArrayR = new Uint8Array(analyserR.frequencyBinCount);

      const updateLevels = () => {
        analyserL.getByteFrequencyData(dataArrayL);
        analyserR.getByteFrequencyData(dataArrayR);

        const leftLevel =
          dataArrayL.reduce((sum, val) => sum + val, 0) /
          dataArrayL.length /
          255;

        const rightLevel =
          dataArrayR.reduce((sum, val) => sum + val, 0) /
          dataArrayR.length /
          255;

        setAudioLevels({
          left: Number.isFinite(leftLevel) ? leftLevel : 0,
          right: Number.isFinite(rightLevel) ? rightLevel : 0,
        });

        animationFrameId.current = requestAnimationFrame(updateLevels);
      };

      updateLevels();
    };

    const tryResume = async () => {
      try {
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume();
        }
      } catch {
        // ignore
      }
    };

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId.current);
      try {
        analyserLRef.current?.disconnect();
        analyserRRef.current?.disconnect();
      } catch {}

      analyserLRef.current = null;
      analyserRRef.current = null;

      // Close context (ok per-player)
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
      sourceRef.current = null;
    };

    videoElement.addEventListener("canplay", tryResume);
    // Some browsers require gesture for audio graph
    document.addEventListener("click", tryResume, { once: true });

    setupAudioContext();

    return () => {
      videoElement.removeEventListener("canplay", tryResume);
      cleanup();
    };
  }, [videoRef]);

  return audioLevels;
};
