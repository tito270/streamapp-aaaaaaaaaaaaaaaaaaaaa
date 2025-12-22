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

  // ✅ prevent "HTMLMediaElement already connected previously..."
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

      // ✅ Only create source once per element
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

      // Left channel
      splitter.connect(analyserL, 0);

      // Right channel (may be silent if mono)
      splitter.connect(analyserR, 1);

      // ✅ Silent sink (no audible output)
      const gain = audioContext.createGain();
      gain.gain.value = 0;

      // Connect analysers to silent sink so graph stays alive
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

        // Some streams are mono: right channel may stay 0
        setAudioLevels({
          left: Number.isFinite(leftLevel) ? leftLevel : 0,
          right: Number.isFinite(rightLevel) ? rightLevel : 0,
        });

        animationFrameId.current = requestAnimationFrame(updateLevels);
      };

      updateLevels();
    };

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId.current);

      // Disconnect nodes if possible
      try {
        analyserLRef.current?.disconnect();
        analyserRRef.current?.disconnect();
      } catch {}

      analyserLRef.current = null;
      analyserRRef.current = null;

      // ✅ DON'T close AudioContext globally if you reuse it across players
      // But in your current design, each VideoPlayer has its own meter — closing is OK.
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }

      sourceRef.current = null;
    };

    // Resume if suspended
    const tryResume = async () => {
      try {
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume();
        }
      } catch {}
    };

    videoElement.addEventListener("canplay", tryResume);
    document.addEventListener("click", tryResume, { once: true });

    setupAudioContext();

    return () => {
      videoElement.removeEventListener("canplay", tryResume);
      cleanup();
    };
  }, [videoRef]);

  return audioLevels;
};
