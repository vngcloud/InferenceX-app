'use client';

import { useState, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Wraps a chart in a card with a header + expand button. Click the button to
 * open the chart in a large dialog. The `render` prop receives `expanded:true`
 * inside the dialog so charts can pick larger width/height.
 */
export function ExpandableChart({
  title,
  render,
}: {
  title: string;
  render: (expanded: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-4">
      <div className="flex items-start justify-between mb-3 gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <button
          type="button"
          aria-label="Expand chart"
          onClick={() => setOpen(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
      {render(false)}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(96vw,1400px)] w-[min(96vw,1400px)]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="w-full">{render(true)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
