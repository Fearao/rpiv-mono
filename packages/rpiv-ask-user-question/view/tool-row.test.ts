import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { makeTheme } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it } from "vitest";
import type { QuestionnaireResult } from "../tool/types.js";
import {
	buildResultLines,
	headersFromArgs,
	ROW_BAR,
	ROW_TITLE,
	renderCallRow,
	renderResultRow,
	titleRuleLine,
} from "./tool-row.js";

const theme = makeTheme() as unknown as Theme;
const WIDTH = 60;

const ARGS = {
	questions: [
		{ header: "Auth method", question: "Which login should we build?", options: [] },
		{ header: "Library", question: "Which date library?", options: [] },
	],
};

function answered(partial: Partial<QuestionnaireResult> = {}): QuestionnaireResult {
	return {
		answers: [
			{ questionIndex: 0, question: "Which login should we build?", kind: "option", answer: "Magic link" },
			{ questionIndex: 1, question: "Which date library?", kind: "custom", answer: "date-fns" },
		],
		cancelled: false,
		...partial,
	};
}

/** Strip ANSI so assertions read the rendered glyphs, not the escape codes. */
function plain(lines: readonly string[]): string[] {
	return lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
}

describe("titleRuleLine", () => {
	it("inlines the tool name in a rule that spans the viewport", () => {
		const line = plain([titleRuleLine(WIDTH, theme)])[0]!;
		expect(line).toContain(ROW_TITLE);
		expect(line.startsWith("─── ")).toBe(true);
		expect(visibleWidth(line)).toBe(WIDTH);
	});

	it("degenerates to a full rule when the viewport cannot seat the title", () => {
		const line = plain([titleRuleLine(ROW_TITLE.length, theme)])[0]!;
		expect(line).not.toContain(ROW_TITLE);
		expect(line).toBe("─".repeat(ROW_TITLE.length));
	});
});

describe("headersFromArgs", () => {
	it("reads the authored header chips in question order", () => {
		expect(headersFromArgs(ARGS)).toEqual(["Auth method", "Library"]);
	});

	it("tolerates partial or missing args (the header renders before arguments complete)", () => {
		expect(headersFromArgs(undefined)).toEqual([]);
		expect(headersFromArgs({})).toEqual([]);
		expect(headersFromArgs({ questions: [{ question: "Q?" }] })).toEqual([""]);
	});
});

describe("buildResultLines — collapsed", () => {
	it("renders one `▸ header → answer` row per question", () => {
		const lines = plain(buildResultLines(ARGS, answered(), false, WIDTH, theme));
		expect(lines).toEqual(["│ ▸ Auth method → Magic link", "│ ▸ Library → date-fns"]);
	});

	it("joins multi-line custom answers into a single row", () => {
		const details = answered({
			answers: [{ questionIndex: 0, question: "Q?", kind: "custom", answer: "line one\nline two" }],
		});
		const lines = plain(buildResultLines(ARGS, details, false, WIDTH, theme));
		expect(lines[0]).toBe("│ ▸ Auth method → line one line two");
	});

	it("marks a question left blank on a partial submit", () => {
		const details = answered({ answers: [answered().answers[0]!], unanswered: [1] });
		const lines = plain(buildResultLines(ARGS, details, false, WIDTH, theme));
		expect(lines[1]).toBe("│ ▸ Library → (no input)");
	});

	it("draws the left bar in front of every answer row", () => {
		const lines = plain(buildResultLines(ARGS, answered(), false, WIDTH, theme));
		expect(lines.every((line) => line.startsWith(ROW_BAR))).toBe(true);
	});

	it("keeps every row within the viewport width", () => {
		const details = answered({
			answers: [{ questionIndex: 0, question: "Q?", kind: "custom", answer: "x".repeat(200) }],
		});
		const lines = buildResultLines(ARGS, details, false, 30, theme);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(30);
	});

	it("names a cancelled questionnaire instead of inventing answers", () => {
		const lines = plain(buildResultLines(ARGS, { answers: [], cancelled: true }, false, WIDTH, theme));
		expect(lines).toEqual(["│ ▸ cancelled"]);
	});

	it("names the error code when the questionnaire could not run", () => {
		const lines = plain(
			buildResultLines(ARGS, { answers: [], cancelled: true, error: "no_custom_ui" }, false, WIDTH, theme),
		);
		expect(lines).toEqual(["│ ▸ error: no_custom_ui"]);
	});

	it("names every question as (no input) when a submit carried no answers", () => {
		const lines = plain(buildResultLines(ARGS, { answers: [], cancelled: false }, false, WIDTH, theme));
		expect(lines).toEqual(["│ ▸ Auth method → (no input)", "│ ▸ Library → (no input)"]);
	});

	it("falls back to a single (no input) row when the args are gone", () => {
		const lines = plain(buildResultLines(undefined, { answers: [], cancelled: false }, false, WIDTH, theme));
		expect(lines).toEqual(["│ ▸ (no input)"]);
	});
});

describe("buildResultLines — expanded", () => {
	it("shows the full question, the answer and any note", () => {
		const details = answered({
			answers: [
				{
					questionIndex: 0,
					question: "Which login should we build?",
					kind: "multi",
					answer: null,
					selected: ["Magic link", "SSO"],
					notes: "SSO only for staff",
				},
			],
		});
		const lines = plain(buildResultLines(ARGS, details, true, WIDTH, theme));
		expect(lines[0]).toBe("│ ▸ Auth method Which login should we build?");
		expect(lines[1]).toBe("│   → Magic link, SSO");
		expect(lines[2]).toBe("│   Notes: SSO only for staff");
	});

	it("renders the global note below the answers", () => {
		const lines = plain(buildResultLines(ARGS, answered({ globalNote: "ship it" }), true, WIDTH, theme));
		expect(lines.at(-1)).toBe("│   Notes: ship it");
	});

	it("keeps the global note visible on a cancelled questionnaire", () => {
		const lines = plain(
			buildResultLines(ARGS, { answers: [], cancelled: true, globalNote: "stop here" }, true, WIDTH, theme),
		);
		expect(lines).toEqual(["│ ▸ cancelled — stop here"]);
	});
});

describe("renderers", () => {
	it("renderCall draws only the title rule", () => {
		const lines = plain(renderCallRow(ARGS, theme).render(WIDTH));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain(ROW_TITLE);
	});

	it("renderResult closes the frame with a full-width rule", () => {
		const lines = plain(
			renderResultRow({ details: answered() }, { expanded: false }, theme, { args: ARGS }).render(WIDTH),
		);
		expect(lines).toHaveLength(3);
		expect(lines.at(-1)).toBe("─".repeat(WIDTH));
	});

	it("renderResult lays out per render width rather than the width it was created at", () => {
		const component = renderResultRow({ details: answered() }, { expanded: false }, theme, { args: ARGS });
		expect(visibleWidth(component.render(20).at(-1)!)).toBe(20);
		expect(visibleWidth(component.render(80).at(-1)!)).toBe(80);
	});

	it("renderResult returns the plain result text when the payload has no questionnaire details", () => {
		const component = renderResultRow(
			{ content: [{ type: "text", text: "questionnaire unavailable" }], details: undefined },
			{ expanded: false },
			theme,
			{ args: ARGS },
		);
		const lines = plain(component.render(WIDTH));
		expect(lines.join("\n")).toContain("questionnaire unavailable");
		expect(lines.join("\n")).not.toContain(ROW_TITLE);
	});
});
