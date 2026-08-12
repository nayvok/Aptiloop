import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryError, SafeQueryError } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocaleProvider } from "@/lib/i18n";

let isOnline = true;

function renderLocalized(children: React.ReactNode) {
  return render(
    <LocaleProvider initialLocale="en-US" syncSettings={false}>
      {children}
    </LocaleProvider>,
  );
}

beforeEach(() => {
  isOnline = true;
  vi.spyOn(window.navigator, "onLine", "get").mockImplementation(
    () => isOnline,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("honest UI state primitives", () => {
  it("keeps the actual local error and adds a secondary offline hint", () => {
    isOnline = false;

    renderLocalized(<QueryError message="Aptiloop Core is unavailable." />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load data");
    expect(alert).toHaveTextContent("Aptiloop Core is unavailable.");
    expect(alert).toHaveTextContent("You're offline");
    expect(alert).toHaveTextContent(
      "This browser reports that it is offline. Reconnect to the network, then try again.",
    );
  });

  it("restores Core-unavailable copy when the browser comes back online", () => {
    isOnline = false;
    renderLocalized(<QueryError message="Aptiloop Core is unavailable." />);

    expect(screen.getByRole("alert")).toHaveTextContent("You're offline");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Aptiloop Core is unavailable.",
    );

    isOnline = true;
    fireEvent(window, new Event("online"));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load data");
    expect(alert).toHaveTextContent("Aptiloop Core is unavailable.");
    expect(alert).not.toHaveTextContent("You're offline");
  });

  it("keeps route retry and technical details available while offline", () => {
    isOnline = false;
    const retry = vi.fn();
    renderLocalized(
      <QueryError
        message="Aptiloop Core is unavailable."
        diagnostic="core-connection-refused"
        retry={retry}
      />,
    );

    expect(screen.getByText("core-connection-refused")).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("core-connection-refused")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders a compact warning query error with custom copy and recovery", () => {
    const retry = vi.fn();
    renderLocalized(
      <QueryError
        kind="warning"
        title="Course revision unavailable"
        message="The exact revision could not be loaded."
        diagnostic="diagnostic-id"
        retry={retry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-kind", "warning");
    expect(alert).toHaveClass(
      "grid",
      "bg-surface-soft/80",
      "before:bg-warning",
      "p-4",
    );
    expect(alert).toHaveTextContent("Course revision unavailable");
    expect(screen.getByText("diagnostic-id")).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("diagnostic-id")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("maps typed API failures to safe copy and keeps only the diagnostic ID closed", () => {
    renderLocalized(
      <SafeQueryError
        error={Object.assign(new Error("raw provider response with a secret"), {
          status: 503,
          failure: {
            code: "provider_unavailable",
            retryable: true,
            messageKey: "ai.failure.providerUnavailable",
            diagnosticId: "provider-hub:diagnostic-1",
            recoveryAction: null,
          },
        })}
        operation="settings.ai.save"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.querySelector("p")).toHaveTextContent(
      "The selected AI provider is unavailable.",
    );
    expect(alert).not.toHaveTextContent("raw provider response with a secret");
    expect(screen.getByText("provider-hub:diagnostic-1")).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(screen.getByText("provider-hub:diagnostic-1")).toBeVisible();
  });

  it("falls back to operation copy for unknown server message keys", () => {
    renderLocalized(
      <SafeQueryError
        error={Object.assign(new Error("raw backend storage path"), {
          status: 500,
          failure: {
            code: "future_failure",
            retryable: false,
            messageKey: "server.future.untrusted",
            diagnosticId: "diagnostic-safe-2",
            recoveryAction: null,
          },
        })}
        operation="course.create"
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.querySelector("p")).toHaveTextContent(
      "The local Course draft could not be created. Try again.",
    );
    expect(alert).not.toHaveTextContent("raw backend storage path");
    expect(screen.getByText("diagnostic-safe-2")).not.toBeVisible();
  });

  it("never exposes hostile untyped or diagnostic-free API messages", () => {
    const { rerender } = renderLocalized(
      <SafeQueryError
        error={new Error("C:\\private\\workspace\\credential.txt")}
        operation="session.load"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This lesson could not be loaded.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("credential.txt");
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument();

    rerender(
      <LocaleProvider initialLocale="en-US" syncSettings={false}>
        <SafeQueryError
          error={Object.assign(new Error("provider secret in raw message"), {
            status: 503,
            failure: {
              code: "provider_unavailable",
              retryable: true,
              messageKey: "ai.failure.providerUnavailable",
              recoveryAction: null,
            },
          })}
          operation="settings.ai.save"
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selected AI provider is unavailable.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("provider secret");
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
  });

  it.each([
    "diagnostic with spaces",
    `diagnostic-${"x".repeat(200)}`,
    "diagnostic\u0000secret",
    "<script>diagnostic</script>",
  ])("rejects an unsafe diagnostic ID: %s", (diagnosticId) => {
    renderLocalized(
      <SafeQueryError
        error={{
          status: 503,
          failure: {
            messageKey: "ai.failure.providerUnavailable",
            diagnosticId,
          },
        }}
        operation="settings.ai.save"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selected AI provider is unavailable.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(diagnosticId);
    expect(screen.queryByText("Technical details")).not.toBeInTheDocument();
  });

  it("provides warning alerts and underline-free segmented and rail tabs", () => {
    renderLocalized(
      <>
        <Alert variant="warning">
          <AlertTitle>AI Off</AlertTitle>
          <AlertDescription>Configure AI to continue.</AlertDescription>
        </Alert>
        <Tabs defaultValue="one">
          <TabsList variant="segmented" aria-label="Workspace">
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First pane</TabsContent>
          <TabsContent value="two">Second pane</TabsContent>
        </Tabs>
        <Tabs defaultValue="interface" orientation="vertical">
          <TabsList variant="rail" aria-label="Settings">
            <TabsTrigger value="interface">Interface</TabsTrigger>
          </TabsList>
          <TabsContent value="interface">Interface pane</TabsContent>
        </Tabs>
      </>,
    );

    expect(screen.getByRole("alert")).toHaveClass(
      "border-warning/45",
      "px-4",
      "py-4",
    );
    const workspace = screen.getByRole("tablist", { name: "Workspace" });
    const settings = screen.getByRole("tablist", { name: "Settings" });
    expect(workspace).toHaveAttribute("data-variant", "segmented");
    expect(settings).toHaveAttribute("data-variant", "rail");
    const selectedWorkspaceTab = screen.getByRole("tab", { name: "One" });
    expect(selectedWorkspaceTab).toHaveAttribute("aria-selected", "true");
    expect(selectedWorkspaceTab).toHaveClass(
      "group-data-[variant=segmented]/tabs-list:data-[state=active]:shadow-none",
      "transition-[color,background-color,border-color]",
      "motion-reduce:transition-none",
    );
    expect(selectedWorkspaceTab).not.toHaveClass("transition-all");
  });
});
