import { timingSafeEqual } from "node:crypto";
import type { WorkerEnv } from "../alchemy.run.ts";

const maxArtifactBytes = 25 * 1024 * 1024;
const segmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const encoder = new TextEncoder();

type ArtifactPath = {
  project: string;
  version: string;
  filename?: string;
};

type ArtifactRow = {
  key: string;
  project: string;
  version: string;
  filename: string;
  size: number;
  sha256: string;
  content_type: string;
  uploaded_at: string;
};

const errorResponse = (error: string, status: number, headers?: HeadersInit) =>
  Response.json({ error }, { status, headers });

const safeEqual = (left: string, right: string) => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
};

const authorized = (request: Request, token: string) => {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") === true && safeEqual(value.slice(7), token);
};

const parsePath = (pathname: string): ArtifactPath | undefined => {
  let parts: string[];
  try {
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return undefined;
  }
  if (parts[0] !== "artifacts" || (parts.length !== 3 && parts.length !== 4)) {
    return undefined;
  }
  const [project, version, filename] = parts.slice(1);
  if (
    !project ||
    !version ||
    project.length > 128 ||
    version.length > 128 ||
    !segmentPattern.test(project) ||
    !segmentPattern.test(version) ||
    (filename !== undefined &&
      (filename.length > 255 || !segmentPattern.test(filename)))
  ) {
    return undefined;
  }
  return { project, version, filename };
};

const parseDigest = (value: string | null) => {
  const encoded = value?.match(/^sha-256=([A-Za-z0-9+/]{43}=)$/)?.[1];
  if (!encoded) return undefined;
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return bytes.byteLength === 32 ? { encoded, bytes } : undefined;
};

const artifactKey = ({ project, version, filename }: ArtifactPath) =>
  `${project}/${version}/${filename}`;

const upload = async (
  request: Request,
  env: WorkerEnv,
  path: ArtifactPath,
): Promise<Response> => {
  if (!path.filename || request.body === null) {
    return errorResponse("artifact body required", 400);
  }
  const size = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxArtifactBytes) {
    return errorResponse("content-length must be between 1 and 26214400", 413);
  }
  const digest = parseDigest(request.headers.get("digest"));
  if (!digest) {
    return errorResponse("Digest must contain a base64 SHA-256 value", 400);
  }

  const key = artifactKey(path);
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  let object: R2Object | null;
  try {
    object = await env.ARTIFACTS.put(key, request.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: digest.bytes,
      httpMetadata: { contentType },
      customMetadata: { sha256: digest.encoded },
    });
  } catch (error) {
    if (String(error).toLowerCase().includes("checksum")) {
      return errorResponse("body does not match the provided digest", 400);
    }
    throw error;
  }
  if (object === null) return errorResponse("artifact already exists", 409);

  try {
    await env.DB.prepare(
      `INSERT INTO artifacts
       (key, project, version, filename, size, sha256, content_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        key,
        path.project,
        path.version,
        path.filename,
        object.size,
        digest.encoded,
        contentType,
        object.uploaded.toISOString(),
      )
      .run();
  } catch (error) {
    await env.ARTIFACTS.delete(key);
    throw error;
  }

  return Response.json(
    { key, size: object.size, sha256: digest.encoded },
    {
      status: 201,
      headers: { location: `/artifacts/${key}`, etag: object.httpEtag },
    },
  );
};

const download = async (
  env: WorkerEnv,
  path: ArtifactPath,
  head: boolean,
): Promise<Response> => {
  if (!path.filename) return errorResponse("artifact filename required", 400);
  const object = await env.ARTIFACTS.get(artifactKey(path));
  if (object === null) return errorResponse("artifact not found", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-length", String(object.size));
  headers.set("etag", object.httpEtag);
  const digest = object.customMetadata?.sha256;
  if (digest) headers.set("digest", `sha-256=${digest}`);
  return new Response(head ? null : object.body, { status: 200, headers });
};

const list = async (env: WorkerEnv, path: ArtifactPath): Promise<Response> => {
  const result = await env.DB.prepare(
    `SELECT key, project, version, filename, size, sha256, content_type, uploaded_at
     FROM artifacts
     WHERE project = ? AND version = ?
     ORDER BY filename
     LIMIT 100`,
  )
    .bind(path.project, path.version)
    .all<ArtifactRow>();
  return Response.json({ artifacts: result.results });
};

export default {
  async fetch(request, env): Promise<Response> {
    if (!authorized(request, env.ARTIFACT_TOKEN)) {
      return errorResponse("unauthorized", 401, {
        "www-authenticate": "Bearer",
      });
    }

    const path = parsePath(new URL(request.url).pathname);
    if (!path) return errorResponse("not found", 404);

    try {
      if (request.method === "PUT") return await upload(request, env, path);
      if (request.method === "GET" && path.filename) {
        return await download(env, path, false);
      }
      if (request.method === "HEAD" && path.filename) {
        return await download(env, path, true);
      }
      if (request.method === "GET") return await list(env, path);
      return errorResponse("method not allowed", 405, {
        allow: "GET, HEAD, PUT",
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "request_failed", error: String(error) }));
      return errorResponse("internal error", 500);
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
