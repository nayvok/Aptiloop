"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-11 w-full resize-y rounded-control border border-input bg-background px-3 py-2 text-base leading-6 text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 aria-invalid:ring-offset-2 aria-invalid:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 md:text-sm motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
