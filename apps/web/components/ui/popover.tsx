"use client";

import * as React from "react";
import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";

const PopoverRoot = Popover.Root;
const PopoverTrigger = Popover.Trigger;
const PopoverAnchor = Popover.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof Popover.Content>,
  React.ComponentPropsWithoutRef<typeof Popover.Content>
>(({ className, align = "center", sideOffset = 8, ...props }, ref) => (
  <Popover.Portal>
    <Popover.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-56 rounded-panel border border-border/60 bg-popover p-4 text-popover-foreground shadow-focus outline-none data-[state=closed]:animate-[popover-out_120ms_ease-out] data-[state=open]:animate-[popover-in_160ms_ease-out]",
        className,
      )}
      {...props}
    />
  </Popover.Portal>
));
PopoverContent.displayName = "PopoverContent";

export { PopoverRoot, PopoverTrigger, PopoverContent, PopoverAnchor };
