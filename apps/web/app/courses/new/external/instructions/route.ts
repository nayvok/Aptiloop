import { AuthoringBriefSchema } from "../../authoring-brief";
import {
  COURSE_AUTHORING_INSTRUCTION_FILENAME,
  createCourseAuthoringInstruction,
} from "../course-authoring-instruction";

const MAX_BRIEF_BYTES = 65_536;

async function readLimitedUtf8(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BRIEF_BYTES) {
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BRIEF_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return "";
  }
}

export async function POST(request: Request): Promise<Response> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return Response.json(
      { error: "The authoring brief must use application/json." },
      { status: 415 },
    );
  }

  const raw = await readLimitedUtf8(request);
  if (raw === null) {
    return Response.json(
      { error: "The authoring brief exceeds the local download limit." },
      { status: 413 },
    );
  }
  const body: unknown = (() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  })();
  const parsed = AuthoringBriefSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "The authoring brief is incomplete or invalid." },
      { status: 400 },
    );
  }

  return new Response(createCourseAuthoringInstruction(parsed.data), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${COURSE_AUTHORING_INSTRUCTION_FILENAME}"`,
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
