import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DebugOverlayProps {
  data: unknown;
  title?: string;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({ data, title = "Debug Info" }) => {
  // Show last 10 items if it's an array
  const displayData = Array.isArray(data) ? data.slice(-10) : data;

  return (
    <Card className="mt-4 bg-gray-900 text-white border-gray-700">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-xs whitespace-pre-wrap break-all bg-black p-2 rounded max-h-60 overflow-y-auto">
          {JSON.stringify(displayData, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
};
