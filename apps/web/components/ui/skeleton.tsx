import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-control bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
