/**
 * Transcript-row rendering for `ask_user_question`.
 *
 * Pi composes a tool row from two slots — `renderCall` (header) and `renderResult`
 * (output). Without renderers the row falls back to plain text: the tool name plus raw
 * output lines, which collapse (`app.tools.expand`, `ctrl+o` by default) to a couple of
 * unadorned lines indistinguishable from any other tool's output.
 *
 * This module frames the row instead: `renderCall` draws the title rule, `renderResult`
 * draws one `▸ Header → answer` row per question behind a left bar, and a closing rule
 * ends the block, so the collapsed row reads as a card at a glance. `expanded` still adds
 * detail — the full question text and any notes — and an error result names the failure
 * inside the frame.
 *
 * Both slots only *read* the payload. `renderResult` re-reads `context.args` for the
 * authored `header` chips because `details.answers[]` carries the question text but not
 * the header.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { t } from "../state/i18n-bridge.js";
import { formatAnswerScalar, NO_INPUT_PLACEHOLDER } from "../tool/format-answer.js";
import { isQuestionnaireResult, type QuestionAnswer, type QuestionnaireResult } from "../tool/types.js";

/** Title shown in the top rule — the canonical tool name, matching `ASK_USER_QUESTION_TOOL_NAME`. */
export const ROW_TITLE = "ask_user_question";

const BULLET = "▸";
const ARROW = "→";
/** Left bar drawn in front of every result row; `BAR_WIDTH` is its column cost. */
export const ROW_BAR = "│ ";
const BAR_WIDTH = ROW_BAR.length;
const TITLE_RULE_LEAD = 3;
const CONTINUATION_INDENT = "  ";

/** Full-width horizontal rule in the mutest border color. */
function rule(width: number, theme: Theme): string {
	return theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
}

/**
 * Top rule with the tool name inlined: `─── ask_user_question ─────────────`.
 * Degenerates to a plain rule when the viewport is too narrow to seat the title.
 */
export function titleRuleLine(width: number, theme: Theme): string {
	const remaining = width - TITLE_RULE_LEAD - visibleWidth(ROW_TITLE) - 2;
	if (remaining < 1) return rule(width, theme);
	const lead = theme.fg("borderMuted", "─".repeat(TITLE_RULE_LEAD));
	const trail = theme.fg("borderMuted", "─".repeat(remaining));
	return `${lead} ${theme.fg("toolTitle", theme.bold(ROW_TITLE))} ${trail}`;
}

/** Authored header chip per question index, read off the (possibly partial) streamed args. */
export function headersFromArgs(args: unknown): string[] {
	const questions = (args as { questions?: unknown } | null | undefined)?.questions;
	if (!Array.isArray(questions)) return [];
	return questions.map((q) => {
		const header = (q as { header?: unknown } | null | undefined)?.header;
		return typeof header === "string" ? header : "";
	});
}

/** Fold an answer's multi-line text into one display line. */
function singleLine(text: string): string {
	return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * One row inside the frame: `▸ header → answer`. Either side may be absent — a cancelled
 * or failed questionnaire has no header, a question the user left blank has only the
 * `(no input)` placeholder. `answerTone` styles the answer segment only, so each row
 * carries exactly one color layer.
 */
function rowLine(
	parts: { header?: string; answer?: string; answerTone?: ThemeColor },
	width: number,
	theme: Theme,
): string {
	let out = theme.fg("accent", BULLET);
	if (parts.header) out += ` ${theme.fg("muted", parts.header)}`;
	if (parts.answer !== undefined && parts.answer.length > 0) {
		if (parts.header) out += ` ${theme.fg("dim", ARROW)}`;
		out += ` ${theme.fg(parts.answerTone ?? "toolOutput", parts.answer)}`;
	}
	return truncateToWidth(out, width, "…");
}

/** Wraps `text` to `width` and prefixes every line — hanging-indent helper for expanded rows. */
function indented(text: string, width: number, firstPrefix: string, restPrefix: string): string[] {
	const innerWidth = Math.max(1, width - Math.max(visibleWidth(firstPrefix), visibleWidth(restPrefix)));
	const out: string[] = [];
	for (const wrapped of wrapTextWithAnsi(singleLine(text), innerWidth)) {
		const prefix = out.length === 0 ? firstPrefix : restPrefix;
		out.push(truncateToWidth(`${prefix}${wrapped}`, width, "…"));
	}
	return out;
}

/** Expanded row: header + full question, then the answer and any note indented below. */
function expandedLines(
	header: string,
	question: string,
	answer: string,
	notes: string | undefined,
	width: number,
	theme: Theme,
): string[] {
	const head = `${theme.fg("accent", BULLET)} ${theme.fg("muted", header)} `;
	const lines =
		question.length > 0
			? indented(question, width, head, CONTINUATION_INDENT)
			: [truncateToWidth(`${head}${theme.fg("toolOutput", answer)}`, width, "…")];
	if (question.length > 0) {
		lines.push(...indented(answer, width, `${CONTINUATION_INDENT}${theme.fg("dim", ARROW)} `, CONTINUATION_INDENT));
	}
	if (notes && notes.length > 0) {
		const label = t("notes.header", "Notes:");
		lines.push(...indented(`${label} ${notes}`, width, CONTINUATION_INDENT, CONTINUATION_INDENT));
	}
	return lines;
}

/**
 * Answer lines for a settled questionnaire, laid out for `width`. `args` supplies the
 * authored header chips; `details` is the questionnaire payload behind the tool result.
 *
 * Every row sits behind a left bar (`│`), so the frame reads as an open-sided card under
 * the title rule instead of a floating block of text. The closing rule stays full-width.
 */
export function buildResultLines(
	args: unknown,
	details: QuestionnaireResult,
	expanded: boolean,
	width: number,
	theme: Theme,
): string[] {
	const inner = Math.max(1, width - BAR_WIDTH);
	const bar = theme.fg("borderMuted", ROW_BAR);
	const rows = bodyRows(args, details, expanded, inner, theme);
	return rows.map((row) => `${bar}${row}`);
}

/** Unprefixed rows of the result slot — `buildResultLines` adds the left bar. */
function bodyRows(
	args: unknown,
	details: QuestionnaireResult,
	expanded: boolean,
	width: number,
	theme: Theme,
): string[] {
	if (details.error) {
		return [rowLine({ answer: `${t("row.error", "error")}: ${details.error}`, answerTone: "error" }, width, theme)];
	}

	const globalNote = details.globalNote;
	if (details.cancelled) {
		const answer =
			expanded && globalNote
				? `${t("row.cancelled", "cancelled")} — ${globalNote}`
				: t("row.cancelled", "cancelled");
		return [rowLine({ answer, answerTone: "dim" }, width, theme)];
	}

	const answers = new Map<number, QuestionAnswer>();
	for (const answer of details.answers) answers.set(answer.questionIndex, answer);
	const headers = headersFromArgs(args);
	const indexes = headers.length > 0 ? headers.map((_, i) => i) : [...answers.keys()].sort((a, b) => a - b);

	const lines: string[] = [];
	for (const i of indexes) {
		const answer = answers.get(i);
		const header = headers[i] || answer?.question || "";
		if (!answer) {
			lines.push(rowLine({ header, answer: NO_INPUT_PLACEHOLDER, answerTone: "dim" }, width, theme));
			continue;
		}
		const text = formatAnswerScalar(answer, "summary");
		lines.push(
			...(expanded
				? expandedLines(header, answer.question, text, answer.notes, width, theme)
				: [rowLine({ header, answer: singleLine(text) }, width, theme)]),
		);
	}
	if (expanded && globalNote) {
		const label = t("notes.header", "Notes:");
		lines.push(...indented(`${label} ${globalNote}`, width, CONTINUATION_INDENT, CONTINUATION_INDENT));
	}
	// Answers can be empty on a "submitted no answers" result carrying only a global note.
	if (lines.length === 0) lines.push(rowLine({ answer: NO_INPUT_PLACEHOLDER, answerTone: "dim" }, width, theme));
	return lines;
}

/** Header slot: the title rule. The payload renders in the result slot. */
class TitleRuleComponent implements Component {
	constructor(private readonly theme: Theme) {}
	render(width: number): string[] {
		return [titleRuleLine(width, this.theme)];
	}
	invalidate(): void {}
}

/** Result slot: answer lines closed by a full-width rule. Laid out per render width. */
class ResultLinesComponent implements Component {
	constructor(
		private readonly args: unknown,
		private readonly details: QuestionnaireResult,
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}
	render(width: number): string[] {
		return [...buildResultLines(this.args, this.details, this.expanded, width, this.theme), rule(width, this.theme)];
	}
	invalidate(): void {}
}

/** `renderCall` slot for `ask_user_question`. */
export function renderCallRow(_args: unknown, theme: Theme): Component {
	return new TitleRuleComponent(theme);
}

/**
 * `renderResult` slot for `ask_user_question`. When the payload carries no questionnaire
 * details (envelope-only results, host fallbacks) the row falls back to the plain result
 * text — framed would be a lie, and hiding the text would drop the model-facing message.
 */
export function renderResultRow(
	result: { content?: readonly { type: string; text?: string }[]; details?: unknown },
	options: { expanded: boolean },
	theme: Theme,
	context: { args?: unknown },
): Component {
	const details = isQuestionnaireResult(result.details) ? result.details : undefined;
	if (!details) {
		const text = (result.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => block.text ?? "")
			.join("\n");
		return new Text(text, 0, 0);
	}
	return new ResultLinesComponent(context.args, details, options.expanded, theme);
}
