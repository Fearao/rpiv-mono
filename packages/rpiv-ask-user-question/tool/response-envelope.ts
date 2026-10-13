import { formatAnswerScalar } from "./format-answer.js";
import type { QuestionAnswer, QuestionnaireResult, QuestionParams } from "./types.js";

export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const PARTIAL_SUFFIX =
	"Do not infer unanswered decisions or treat them as accepting recommendations. Clarify any still-blocking decision before taking actions that depend on it.";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

/** Explicit cancellation stops; missing UI and errors are not user decisions.
 * Partial (including empty) submissions retain unanswered indexes and forbid assumptions.
 */
export function buildQuestionnaireResponse(
	result: QuestionnaireResult | null | undefined,
	params: QuestionParams,
): ReturnType<typeof buildToolResult> & { terminate?: boolean } {
	if (!result) {
		return buildToolResult("The questionnaire returned no usable result; ask as plain chat text instead.", {
			answers: [],
			cancelled: true,
			error: "no_custom_ui",
		});
	}
	if (result.error)
		return buildToolResult(
			`Questionnaire unavailable (${result.error}); this is not a user cancellation. Ask as plain chat text instead.`,
			result,
		);
	if (result.cancelled) {
		return { ...buildToolResult(DECLINE_MESSAGE, result), terminate: true };
	}
	const segments: string[] = [];
	const unanswered: number[] = [];
	for (let i = 0; i < params.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(buildAnswerSegment(a));
		else unanswered.push(i);
	}
	const hasGlobalNote = result.globalNote !== undefined && result.globalNote.length > 0;
	const prefix = segments.length === 0 && !hasGlobalNote ? "User submitted no answers:" : ENVELOPE_PREFIX;
	if (unanswered.length > 0) segments.push(buildUnansweredSegment(unanswered, params));
	// Global note rides after the per-question segments: raw multiline echo (no
	// reformatting), trailing period mirroring `buildAnswerSegment`'s shape.
	if (hasGlobalNote) segments.push(`global note: ${result.globalNote}.`);
	const details = unanswered.length > 0 ? { ...result, unanswered } : result;
	return buildToolResult(
		`${prefix} ${segments.join(" ")} ${unanswered.length > 0 ? PARTIAL_SUFFIX : ENVELOPE_SUFFIX}`,
		details,
	);
}

/** `unanswered: "<question>", "<question>".` — the questions shown but left blank on a partial submit. */
export function buildUnansweredSegment(indexes: readonly number[], params: QuestionParams): string {
	return `unanswered: ${indexes.map((i) => `"${params.questions[i]?.question}"`).join(", ")}.`;
}

/**
 * Format a single answer segment for the envelope. Pure of `a`. The `"Q"="A"` shape and
 * the optional `selected preview:` / `user notes:` suffixes are pinned by envelope tests.
 */
export function buildAnswerSegment(a: QuestionAnswer): string {
	const parts: string[] = [`"${a.question}"="${formatAnswerScalar(a, "envelope")}"`];
	if (a.preview && a.preview.length > 0) parts.push(`selected preview: ${a.preview}`);
	if (a.notes && a.notes.length > 0) parts.push(`user notes: ${a.notes}`);
	return `${parts.join(". ")}.`;
}

export function buildToolResult(text: string, details: QuestionnaireResult) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}
