import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./ask-user-question.js";
import { isQuestionnaireResult } from "./tool/types.js";

/** terminate alone only ends an all-terminating batch in pi; abort also stops mixed batches. */
export function registerQuestionCancellationPolicy(pi: ExtensionAPI): void {
	pi.on("tool_result", (event, ctx) => {
		if (event.toolName !== ASK_USER_QUESTION_TOOL_NAME || event.isError) return;
		if (!isQuestionnaireResult(event.details) || !event.details.cancelled || event.details.error) return;
		ctx.abort();
	});
}
