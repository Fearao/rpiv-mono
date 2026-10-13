import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMPT_GUIDELINES, registerAskUserQuestionTool } from "./ask-user-question.js";
import extension from "./index.js";
import { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.js";
import { MAX_QUESTIONS, type QuestionnaireResult, QuestionParamsSchema } from "./tool/types.js";
import { validateQuestionnaire } from "./tool/validate-questionnaire.js";

const question = (i = 0) => ({
	question: `Q${i}?`,
	header: `H${i}`,
	options: [
		{ label: "A", description: "a" },
		{ label: "B", description: "b" },
	],
});
const params = { questions: [question(), question(1)] };
function config(notification: unknown) {
	const path = join(process.env.HOME!, ".config/rpiv-ask-user-question/config.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify({ notification }));
}
function setup() {
	const listeners = new Map<string, (payload: unknown) => unknown>();
	const mock = createMockPi({
		events: {
			on: vi.fn((name: string, handler: (payload: unknown) => unknown) => {
				listeners.set(name, handler);
				return () => {};
			}),
			emit: vi.fn((name: string, payload: unknown) => {
				listeners.get(name)?.(payload);
			}),
		},
	});
	extension(mock.pi);
	return {
		...mock,
		prompt: (text = "Pick?") =>
			listeners.get("rpiv:ask-user:prompt")?.({ questions: [{ ...question(), question: text }] }),
	};
}

describe("fork question limit", () => {
	it("accepts eight unique questions in both validators and rejects nine", () => {
		const eight = { questions: Array.from({ length: 8 }, (_, i) => question(i)) };
		expect(MAX_QUESTIONS).toBe(8);
		expect(Value.Check(QuestionParamsSchema, eight)).toBe(true);
		expect(validateQuestionnaire(eight)).toEqual({ ok: true });
		const nine = { questions: [...eight.questions, question(8)] };
		expect(Value.Check(QuestionParamsSchema, nine)).toBe(false);
		expect(validateQuestionnaire(nine)).toMatchObject({ ok: false, error: "too_many_questions" });
	});
	it("registers only one sequential question tool and recommends small batches", () => {
		const { captured } = setup();
		expect([...captured.tools.keys()]).toEqual(["ask_user_question"]);
		expect(captured.tools.get("ask_user_question")?.executionMode).toBe("sequential");
		const guidance = DEFAULT_PROMPT_GUIDELINES.join("\n");
		expect(guidance).toContain("2-4 related questions");
		expect(guidance).toContain("permission");
		expect(guidance).toContain("plan approval");
		expect(guidance).toContain("unanswered");
	});
});

describe("fork cancellation policy", () => {
	it("marks explicit cancellation as terminating but not errors or absent UI results", () => {
		expect(buildQuestionnaireResponse({ answers: [], cancelled: true }, params)).toHaveProperty("terminate", true);
		for (const result of [
			null,
			{ answers: [], cancelled: true, error: "no_custom_ui" },
		] as (QuestionnaireResult | null)[]) {
			expect(buildQuestionnaireResponse(result, params)).not.toHaveProperty("terminate", true);
		}
		expect(buildToolResult("UI unavailable", { answers: [], cancelled: true, error: "no_ui" })).not.toHaveProperty(
			"terminate",
			true,
		);
	});
	it("keeps empty submissions distinct from cancellation", () => {
		const result = buildQuestionnaireResponse({ answers: [], cancelled: false }, params);
		expect(result.details).toMatchObject({ cancelled: false, unanswered: [0, 1] });
		expect(result.content[0].text).not.toContain("declined");
		expect(result.content[0].text).toContain("Do not infer");
		expect(result).not.toHaveProperty("terminate", true);
	});
	it("does not invite blind continuation for partial answers", () => {
		const result = buildQuestionnaireResponse(
			{ cancelled: false, answers: [{ questionIndex: 0, question: "Q0?", kind: "option", answer: "A" }] },
			params,
		);
		expect(result.details.unanswered).toEqual([1]);
		expect(result.content[0].text).toContain("Do not infer");
		expect(result.content[0].text).not.toContain("You can now continue");
	});
	it("aborts the current operation only after actual question cancellation", async () => {
		const { captured } = setup();
		const abort = vi.fn();
		const shutdown = vi.fn();
		const ctx = { ...createMockCtx(), abort, shutdown };
		const handlers = captured.events.get("tool_result") ?? [];
		expect(handlers).toHaveLength(1);
		const emit = async (toolName: string, details: unknown, isError = false) => {
			for (const handler of handlers) await handler({ toolName, details, isError }, ctx);
		};
		await emit("ask_user_question", { answers: [], cancelled: false, unanswered: [0] });
		await emit("ask_user_question", { answers: [], cancelled: true, error: "no_ui" });
		await emit("ask_user_question", { answers: [], cancelled: true }, true);
		await emit("bash", { answers: [], cancelled: true });
		await emit("ask_user_question", undefined);
		expect(abort).not.toHaveBeenCalled();
		await emit("ask_user_question", { answers: [], cancelled: true });
		expect(abort).toHaveBeenCalledOnce();
		expect(shutdown).not.toHaveBeenCalled();
	});
	it("TUI and RPC cancel terminate, but no-UI and unusable-host results do not", async () => {
		const { pi, captured } = createMockPi();
		registerAskUserQuestionTool(pi);
		const tool = captured.tools.get("ask_user_question")!;
		const execute = (ctx: ReturnType<typeof createMockCtx>) => tool.execute("tc", params, undefined, undefined, ctx);
		const tui = await execute(
			createMockCtx({ hasUI: true, ui: { custom: vi.fn(async () => ({ answers: [], cancelled: true })) } as never }),
		);
		expect(tui).toHaveProperty("terminate", true);
		const rpc = await execute(
			createMockCtx({
				hasUI: true,
				mode: "rpc",
				ui: { select: vi.fn(async () => undefined), input: vi.fn() } as never,
			}),
		);
		expect(rpc).toHaveProperty("terminate", true);
		const noUi = await execute(createMockCtx({ hasUI: false }));
		expect(noUi).not.toHaveProperty("terminate", true);
		const failed = await execute(
			createMockCtx({
				hasUI: true,
				ui: { custom: vi.fn(async () => undefined), select: undefined, input: undefined } as never,
			}),
		);
		expect(failed.details).toMatchObject({ error: "no_custom_ui" });
		expect(failed).not.toHaveProperty("terminate", true);
	});
});

describe("fork larknotify adapter", () => {
	it("is enabled by default and uses larknotify's default target", () => {
		const { pi, prompt } = setup();
		prompt("你选哪个方案？");
		expect(pi.exec).toHaveBeenCalledWith("larknotify", ["send", "[Pi] 需要你回答：你选哪个方案？"], {
			timeout: 5000,
		});
	});
	it("can be disabled explicitly and rejects malformed overrides", () => {
		const { pi, prompt } = setup();
		for (const notification of [
			{ enabled: false },
			null,
			{ enabled: "true" },
			{ receiver: 1 },
			{ receiver: " " },
			{ receiver: "-flag" },
			{ receiver: "bad\nreceiver" },
		]) {
			config(notification);
			prompt();
		}
		expect(pi.exec).not.toHaveBeenCalled();
	});
	it("passes an optional trimmed target after the message", () => {
		config({ receiver: " test-receiver " });
		const { pi, prompt } = setup();
		prompt("你选哪个方案？");
		expect(pi.exec).toHaveBeenCalledOnce();
		expect(pi.exec).toHaveBeenCalledWith("larknotify", ["send", "[Pi] 需要你回答：你选哪个方案？", "test-receiver"], {
			timeout: 5000,
		});
	});
	it("does not block the questionnaire on a pending notification", async () => {
		config({ receiver: "test-receiver" });
		const { pi, captured } = setup();
		vi.mocked(pi.exec).mockImplementation(() => new Promise(() => {}));
		const custom = vi.fn(async () => ({ answers: [], cancelled: true }));
		await captured.tools
			.get("ask_user_question")!
			.execute("tc", params, undefined, undefined, createMockCtx({ hasUI: true, ui: { custom } as never }));
		expect(custom).toHaveBeenCalledOnce();
		expect(pi.exec).toHaveBeenCalledOnce();
	});
	it.each(["throw", "reject", "nonzero"])(
		"notification %s is contained and does not leak private text",
		async (failure) => {
			config({ receiver: "test-receiver" });
			const { pi, prompt } = setup();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			vi.mocked(pi.exec).mockImplementation(() => {
				if (failure === "throw") throw new Error("PRIVATE");
				if (failure === "reject") return Promise.reject(new Error("PRIVATE"));
				return Promise.resolve({ stdout: "PRIVATE", stderr: "PRIVATE", code: 1, killed: false });
			});
			expect(() => prompt("PRIVATE")).not.toThrow();
			await Promise.resolve();
			await Promise.resolve();
			expect(warn).toHaveBeenCalledOnce();
			expect(JSON.stringify(warn.mock.calls)).not.toContain("PRIVATE");
		},
	);
	it("invalid or no-UI calls do not notify", async () => {
		config({ receiver: "test-receiver" });
		const { pi, captured } = setup();
		const tool = captured.tools.get("ask_user_question")!;
		await tool.execute("tc", { questions: [] }, undefined, undefined, createMockCtx({ hasUI: true }));
		await tool.execute("tc", params, undefined, undefined, createMockCtx({ hasUI: false }));
		expect(pi.exec).not.toHaveBeenCalled();
	});
});

it("Git install manifest loads only the questionnaire extension", () => {
	const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
	expect(root.pi).toEqual({
		extensions: ["./packages/rpiv-ask-user-question/index.ts"],
		skills: [],
		prompts: [],
		themes: [],
	});
});

it("Git consumer install skips Husky when npm explicitly omits devDependencies", () => {
	const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
	expect(root.scripts.prepare).toBe("node scripts/prepare.mjs");
	const result = spawnSync(process.execPath, [new URL("../../scripts/prepare.mjs", import.meta.url).pathname], {
		env: { ...process.env, npm_config_omit: "dev" },
		encoding: "utf-8",
	});
	expect(result.status, result.stderr).toBe(0);
});
