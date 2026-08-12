import { CircleNotchIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Spinner({
  className,
  ...props
}: ComponentProps<typeof CircleNotchIcon>) {
  return (
    <CircleNotchIcon
      {...props}
      aria-hidden
      className={cn(
        "size-4 animate-spin motion-reduce:animate-none",
        className,
      )}
      data-slot="spinner"
    />
  );
}
