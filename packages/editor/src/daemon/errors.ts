/**
 * Closed union of editor-domain error codes. The domain speaks codes; each
 * transport edge owns its own mapping (HTTP today via `httpStatus`; future
 * MCP/agent bindings map the same codes at their edges). Codes are part of the
 * command contract — clients branch on code; messages are for humans.
 */
export type EditorErrorCode =
  | "invalid-input"
  | "invalid-json"
  | "unknown-command"
  | "not-found"
  | "outside-root"
  | "already-exists"
  | "internal";

const HTTP_STATUS: Record<EditorErrorCode, number> = {
  "invalid-input": 400,
  "invalid-json": 400,
  "unknown-command": 404,
  "not-found": 404,
  // Traversal reports 404, not 400: don't reveal whether anything exists
  // outside the project root.
  "outside-root": 404,
  "already-exists": 409,
  internal: 500,
};

/** An editor-domain error: a contract `code` plus a human-readable message. */
export class EditorError extends Error {
  readonly code: EditorErrorCode;
  constructor(code: EditorErrorCode, message: string) {
    super(message);
    this.name = "EditorError";
    this.code = code;
  }
}

/** The HTTP edge's status mapping for an editor error code. */
export function httpStatus(code: EditorErrorCode): number {
  return HTTP_STATUS[code];
}
