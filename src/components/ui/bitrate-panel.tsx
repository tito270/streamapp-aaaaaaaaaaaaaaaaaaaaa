import React from 'react';
import BitrateGraph from './bitrate-graph';

interface BitratePanelProps {
  title?: string;
  subtitle?: string;
  data: { time: number; bitrate: number }[];
  color?: string;
  maxBitrate?: number;
}

const BitratePanel: React.FC<BitratePanelProps> = ({ title = 'Bitrate', subtitle, data, color, maxBitrate }) => {
  return (
    <div className="p-3 bg-stream-bg border-stream-border rounded">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && <div className="text-xs text-muted-foreground font-mono">{subtitle}</div>}
        </div>
      </div>
      <BitrateGraph data={data} color={color} maxBitrate={maxBitrate} />
    </div>
  );
};

export default BitratePanel;
