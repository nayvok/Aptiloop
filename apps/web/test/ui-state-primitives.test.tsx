import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueryError } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocaleProvider } from "@/lib/i18n";

function renderLocalized(children: React.ReactNode) {
  return render(
    <LocaleProvider initialLocale="en-US" syncSettings={false}>
      {children}
    </LocaleProvider>,
  );
}

afterEach(cleanup);

describe("honest UI state primitives", () => {
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
