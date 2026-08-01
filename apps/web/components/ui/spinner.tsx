import { CircleNotchIcon } from "@phosphor-icons/react";

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <CircleNotchIcon
      aria-hidden
      className={`animate-spin ${className}`}
      data-slot="spinner"
    />
  );
}
