"use client";

import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { useI18n } from "@/lib/i18n";

const Toaster = ({
  containerAriaLabel,
  toastOptions,
  ...props
}: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const { t } = useI18n();
  const visibleTheme: NonNullable<ToasterProps["theme"]> =
    theme === "light" || theme === "dark" ? theme : "system";

  return (
    <Sonner
      theme={visibleTheme}
      className="toaster group"
      containerAriaLabel={containerAriaLabel ?? t("toast.notifications")}
      toastOptions={{
        closeButtonAriaLabel: t("toast.close"),
        ...toastOptions,
      }}
      icons={{
        success: <CheckCircleIcon className="size-4" weight="fill" />,
        info: <InfoIcon className="size-4" />,
        warning: <WarningCircleIcon className="size-4" weight="fill" />,
        error: <XCircleIcon className="size-4" weight="fill" />,
        loading: <SpinnerGapIcon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--shape-control)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
