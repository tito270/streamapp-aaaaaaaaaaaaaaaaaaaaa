import { useEffect, useRef, useState } from "react";

interface WindowWithAudioContext extends Window {
  webkitAudioContext: typeof AudioContext;
}

export const useAudioLevels = (videoRef: React.RefObject<HTMLVideoElement>) => {
  const [audioLevels, setAudioLevels] = useState({ left: 0, right: 0 });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);

  const animationFrameId = useRef<number>(0);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const setupAudioContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          (window as unknown as WindowWithAudioContext).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;

      // IMPORTANT: createMediaElementSource can be called only once per <video>
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaElementSource(videoElement);
      }

      const source = sourceRef.current;

      const splitter = audioContext.createChannelSplitter(2);
      const merger = audioContext.createChannelMerger(2);

      analyserLRef.current = audioContext.createAnalyser();
      analyserRRef.current = audioContext.createAnalyser();

      const analyserL = analyserLRef.current;
      const analyserR = analyserRRef.current;

      analyserL.fftSize = 32;
      analyserR.fftSize = 32;

      // wiring
      source.connect(splitter);

      // left channel
      splitter.connect(analyserL, 0);

      // right channel may not exist → fallback to left
      try {
        splitter.connect(analyserR, 1);
      } catch {
        splitter.connect(analyserR, 0);
      }

      analyserL.connect(merger, 0, 0);
      analyserR.connect(merger, 0, 1);

      // If you don't want audio output, comment next line.
      merger.connect(audioContext.destination);

      const dataArrayL = new Uint8Array(analyserL.frequencyBinCount);
      const dataArrayR = new Uint8Array(analyserR.frequencyBinCount);

      const updateLevels = () => {
        analyserL.getByteFrequencyData(dataArrayL);
        analyserR.getByteFrequencyData(dataArrayR);

        const leftLevel =
          dataArrayL.reduce((sum, val) => sum + val, 0) / dataArrayL.length / 255;
        const rightLevel =
          dataArrayR.reduce((sum, val) => sum + val, 0) / dataArrayR.length / 255;

        setAudioLevels({ left: leftLevel, right: rightLevel });
        animationFrameId.current = requestAnimationFrame(updateLevels);
      };

      updateLevels();
    };

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId.current);

      // keep audio context open across rerenders? you had close().
      // closing is fine, but it will require user gesture to resume on some browsers.
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
      sourceRef.current = null;
      analyserLRef.current = null;
      analyserRRef.current = null;
    };

    videoElement.oncanplay = () => {
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        audioContextRef.current.resume().catch(() => {});
      }
    };

    setupAudioContext();
    return cleanup;
  }, [videoRef]);

  return audioLevels;
};
