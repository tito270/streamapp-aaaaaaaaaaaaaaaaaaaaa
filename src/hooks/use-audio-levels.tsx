import { useState, useEffect, useRef } from 'react';

interface WindowWithAudioContext extends Window {
  webkitAudioContext: typeof AudioContext;
}

export const useAudioLevels = (videoRef: React.RefObject<HTMLVideoElement>) => {
  const [audioLevels, setAudioLevels] = useState({ left: 0, right: 0 });
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const animationFrameId = useRef<number>(0);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const setupAudioContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as WindowWithAudioContext).webkitAudioContext)();
      }
      const audioContext = audioContextRef.current;

      const source = audioContext.createMediaElementSource(videoElement);
      const splitter = audioContext.createChannelSplitter(2);
      const merger = audioContext.createChannelMerger(2);

      analyserLRef.current = audioContext.createAnalyser();
      analyserRRef.current = audioContext.createAnalyser();
      
      const analyserL = analyserLRef.current;
      const analyserR = analyserRRef.current;

      analyserL.fftSize = 32;
      analyserR.fftSize = 32;

      source.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      analyserL.connect(merger, 0, 0);
      analyserR.connect(merger, 0, 1);
      merger.connect(audioContext.destination);

      const dataArrayL = new Uint8Array(analyserL.frequencyBinCount);
      const dataArrayR = new Uint8Array(analyserR.frequencyBinCount);

      const updateLevels = () => {
        analyserL.getByteFrequencyData(dataArrayL);
        analyserR.getByteFrequencyData(dataArrayR);

        const leftLevel = dataArrayL.reduce((sum, val) => sum + val, 0) / dataArrayL.length / 255;
        const rightLevel = dataArrayR.reduce((sum, val) => sum + val, 0) / dataArrayR.length / 255;

        setAudioLevels({ left: leftLevel, right: rightLevel });
        animationFrameId.current = requestAnimationFrame(updateLevels);
      };

      updateLevels();
    };

    const cleanup = () => {
      cancelAnimationFrame(animationFrameId.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };

    videoElement.oncanplay = () => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
    };
    
    setupAudioContext();

    return cleanup;
  }, [videoRef]);

  return audioLevels;
};
