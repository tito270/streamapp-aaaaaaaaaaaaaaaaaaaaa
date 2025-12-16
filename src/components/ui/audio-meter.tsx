import React from 'react';
import { cn } from "@/lib/utils";

interface AudioMeterProps {
  level: number;       // Range: 0.0 to 1.0
  className?: string;
}

const AudioMeterBar: React.FC<AudioMeterProps> = ({ level, className }) => {
  const height = `${Math.min(100, level * 100)}%`;

  // Determine solid fill color based on level
  let fillColor = "#2cd40bff"; // green-400 by default
  if (level >= 0.8) {
    fillColor = "#f87171"; // red-400
  } else if (level >= 0.9) {
    fillColor = "#fde047"; // yellow-300
  }

  // Background gradient (blurred, faded)
  const backgroundGradient = `
    linear-gradient(to top, 
      #15803d 0%, #15803d 60%, 
      #b45309 60%, #b45309 80%, 
      #991b1b 80%, #991b1b 100%)
  `;

  return (
    <div className={cn("relative w-full h-20 overflow-hidden rounded", className)}>
      {/* Blurred gradient background */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background: backgroundGradient,
          filter: 'blur(0.5px) saturate(50%)',
          opacity: 0.50,
        }}
      />

      {/* Solid color level fill based on active range */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10"
        style={{
          height,
          transition: 'height 0.01 s ease-out',
          backgroundColor: fillColor,
        }}
      />
    </div>
  );
};

interface StereoAudioMeterProps {
  leftLevel: number;
  rightLevel: number;
  className?: string;
}

export const AudioMeter: React.FC<StereoAudioMeterProps> = ({
  leftLevel,
  rightLevel,
  className,
}) => {
  return (
    <div className={cn("flex items-end gap-1 p-1 rounded-lg", className)}>
      <AudioMeterBar level={leftLevel} className="w-1.5" />
      <AudioMeterBar level={rightLevel} className="w-1.5" />
    </div>
  );
};
