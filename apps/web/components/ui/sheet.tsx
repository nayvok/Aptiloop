"use client";

import * as React from "react";
import { Dialog } from "radix-ui";

import { XIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const Sheet = Dialog.Root;
const SheetTrigger = Dialog.Trigger;
const SheetClose = Dialog.Close;
const SheetPortal = Dialog.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof Dialog.Overlay>,
  React.ComponentPropsWithoutRef<typeof Dialog.Overlay>
>(({ className, ...props }, ref) => (
  <Dialog.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-[overlay-out_160ms_ease-out] data-[state=open]:animate-[overlay-in_160ms_ease-out]",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const SheetContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
    side?: "right" | "left";
  }
>(({ side = "right", className, children, ...props }, ref) => {
  const { t } = useI18n();

  return (
    <SheetPortal>
      <SheetOverlay />
      <Dialog.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 z-50 flex w-full max-w-md flex-col overscroll-contain bg-surface-raised shadow-focus outline-none",
          side === "right" &&
            "right-0 border-l border-border/50 data-[state=closed]:animate-[sheet-out-right_160ms_ease-out] data-[state=open]:animate-[sheet-in-right_180ms_ease-out]",
          side === "left" &&
            "left-0 border-r border-border/50 data-[state=closed]:animate-[sheet-out-left_160ms_ease-out] data-[state=open]:animate-[sheet-in-left_180ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close
          data-slot="sheet-close"
          aria-label={t("ui.close")}
          className="absolute top-4 right-4 grid size-11 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised md:size-10 motion-reduce:transition-none"
        >
          <XIcon aria-hidden className="size-4" />
        </Dialog.Close>
      </Dialog.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

function SheetHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 pt-6 pe-16 pb-4 ps-6 text-left",
        className,
      )}
      {...props}
    />
  );
}

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-col-reverse gap-2 bg-surface-soft/60 p-4 sm:flex-row sm:justify-end sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={cn("text-base font-semibold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={cn("text-sm leading-6 text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
