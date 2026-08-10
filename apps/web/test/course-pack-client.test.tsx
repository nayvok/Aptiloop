import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoursePackClient } from "@/components/course-pack-client";

const { apiMock, pushMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const contentHash = `sha256:${"a".repeat(64)}`;
const report = {
  validatorVersion: "m3-v1",
  valid: true,
  errors: 0,
  warnings: 0,
  diagnostics: [],
  limits: { maxBytes: 1_048_576 },
};

function renderWithQuery(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  pushMock.mockReset();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: vi.fn(() => "123e4567-e89b-42d3-a456-426614174000"),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CoursePackClient", () => {
  it("shows fail-closed diagnostics without exposing install actions", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        return {
          valid: false,
          storageAvailable: true,
          report: {
            ...report,
            valid: false,
            errors: 1,
            diagnostics: [
              {
                code: "PACK_AUTHORITY_FIELD",
                severity: "error",
                path: "/command",
                entityId: null,
                message: "Authority-bearing field is forbidden: command",
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithQuery(<CoursePackClient />);
    const file = new File(['{"command":"npm test"}'], "unsafe.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("JSON-файл"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить Pack" }));

    expect(await screen.findByText("Pack отклонён")).toBeInTheDocument();
    expect(screen.getByText("PACK_AUTHORITY_FIELD")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Установить и открыть" }),
    ).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      "/course-packs/validate",
      expect.objectContaining({ method: "POST", body: file }),
    );
  });

  it("requires Preview confirmation and opens the committed Course revision", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/course-packs") {
        return { storageAvailable: true, packs: [] };
      }
      if (path === "/course-packs/validate") {
        return {
          valid: true,
          storageAvailable: true,
          validationId: "123e4567-e89b-42d3-a456-426614174001",
          expiresAt: "2026-08-10T00:15:00.000Z",
          report,
          preview: {
            courseKey: "development-kernel-basics",
            revisionKey: "development-kernel-basics/v1",
            courseTitle: "Deterministic Learning Basics",
            revisionNumber: 1,
            primaryLocale: "en-US",
            availableLocales: ["en-US"],
            contentHash,
            lessonCount: 1,
            activityCount: 2,
            sourcePrivacyClasses: { public: 1, private: 0 },
            requirements: {
              activityTypes: ["study", "recall"],
              capabilities: [],
              environmentIds: [],
              checkIds: [],
            },
            provenance: {
              contentStatus: "development-fixture",
              author: "Aptiloop development fixture",
              origin: "original",
              ownership: "owned",
              licenseSpdx: null,
              termsUrl: "https://example.invalid/terms",
              attribution: "Synthetic fixture",
              createdAt: "2026-08-10T00:00:00.000Z",
              notes: null,
            },
          },
        };
      }
      if (path.includes("/course-packs/validations/")) {
        return {
          result: {
            courseId: "development-kernel-basics",
            revisionId: "development-kernel-basics/v1",
            contentHash,
            action: "install",
            revisionStatus: "published",
            installed: true,
            idempotent: false,
          },
          openPath:
            "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithQuery(<CoursePackClient />);
    const file = new File(["{}"], "course.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("JSON-файл"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Проверить Pack" }));

    expect(
      await screen.findByRole("heading", {
        name: "Deterministic Learning Basics",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(contentHash)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Установить и открыть" }),
    );

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/courses/development-kernel-basics/revisions/development-kernel-basics%2Fv1",
      ),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/course-packs/validations/123e4567-e89b-42d3-a456-426614174001/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "123e4567-e89b-42d3-a456-426614174000",
          action: "install",
          expectedContentHash: contentHash,
        }),
      }),
    );
  });
});
