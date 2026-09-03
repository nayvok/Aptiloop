import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-panel border border-border/60 px-4 py-4 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*5)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-px [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        warning:
          "border-warning/45 bg-warning/10 text-foreground *:data-[slot=alert-title]:text-warning-foreground *:data-[slot=alert-description]:text-foreground [&>svg]:text-warning-foreground",
        success:
          "border-success/35 bg-success/10 text-foreground *:data-[slot=alert-title]:text-success-foreground *:data-[slot=alert-description]:text-foreground [&>svg]:text-success-foreground",
        destructive:
          "border-destructive/30 bg-destructive/10 text-foreground *:data-[slot=alert-title]:text-destructive *:data-[slot=alert-description]:text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 min-h-5 font-semibold leading-5 tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm leading-6 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "col-start-2 mt-3 flex flex-wrap items-center gap-2 sm:absolute sm:inset-y-0 sm:right-4 sm:col-start-auto sm:mt-0 sm:items-center",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
