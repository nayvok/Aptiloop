import { describe, expect, it, vi } from "vitest";

import CourseRevisionPage from "@/app/courses/[courseId]/revisions/[revisionId]/page";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  useRouter: vi.fn(),
}));

describe("Course revision route boundary", () => {
  it.each([
    { courseId: "", revisionId: "revision-2" },
    { courseId: "course-1", revisionId: "" },
  ])("routes empty params to not-found", async (params) => {
    await expect(
      CourseRevisionPage({ params: Promise.resolve(params) }),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(notFoundMock).toHaveBeenCalledOnce();
    notFoundMock.mockClear();
  });

  it("treats App Router params as decoded and encodes the exact endpoint once", async () => {
    const element = await CourseRevisionPage({
      params: Promise.resolve({
        courseId: "course one",
        revisionId: "revision/two",
      }),
    });

    expect(element.props).toMatchObject({
      surface: "revision",
      pathEndpoint:
        "/learning/courses/course%20one/revisions/revision%2Ftwo/path",
      selectionTarget: {
        courseId: "course one",
        revisionId: "revision/two",
      },
    });
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
