/**
 * The V3 experimental mode, as the application uses it.
 *
 * Client-safe by construction: every module here speaks JSON to a route handler
 * and imports no adapter, no solver and no `node:` module. The CP-SAT adapter
 * lives on the other side of `/api/planning/v3/solve` and is reachable only
 * from the server, which an import-boundary test asserts rather than assumes.
 */
export {
  acceptV3Result,
  describeV3Engine,
  v3TechnicalCaveats,
  V3_REJECTION_REASONS,
  type V3Acceptance,
  type V3RejectionReason,
} from "@/features/planning/v3/accept-v3-result"
export {
  baselineFromEditorState,
  editorStateFromV3Solution,
  v3ShiftId,
  v3ShiftsAndAssignments,
} from "@/features/planning/v3/editor-state-from-v3"
export { runV3Generation, type V3AttemptInput, type V3AttemptOutcome } from "@/features/planning/v3/run-v3-generation"
export { solvePlanningV3OverHttp, type SolveV3Options } from "@/features/planning/v3/solve-client"
export {
  parsePlanningV3Request,
  PLANNING_V3_DEFAULT_TIMEOUT_SECONDS,
  PLANNING_V3_ENDPOINT_PATH,
  PLANNING_V3_ENDPOINT_VERSION,
  PLANNING_V3_MAX_PAYLOAD_BYTES,
  PLANNING_V3_MAX_TIMEOUT_SECONDS,
  PLANNING_V3_MIN_TIMEOUT_SECONDS,
  type PlanningV3RequestErrorCode,
  type PlanningV3SolveRequestBody,
} from "@/features/planning/v3/solve-endpoint-contract"
