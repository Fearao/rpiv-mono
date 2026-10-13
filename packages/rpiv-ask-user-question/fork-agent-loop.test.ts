import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	Type,
} from "@earendil-works/pi-ai";
import { createMockCtx, createMockPi } from "@juicesharp/rpiv-test-utils";
import { describe, expect, it, vi } from "vitest";
import extension from "./index.js";
import type { QuestionnaireResult } from "./tool/types.js";

const model: Model<"openai-completions"> = {
	id: "offline-test",
	name: "Offline test",
	api: "openai-completions",
	provider: "test",
	baseUrl: "http://unused.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 1000,
};
const params = {
	questions: [
		{
			question: "Choose?",
			header: "Pick",
			options: [
				{ label: "A", description: "a" },
				{ label: "B", description: "b" },
			],
		},
	],
};

describe("fork cancellation — real pi agent loop, offline provider", () => {
	it.each([
		{ label: "cancel", result: { answers: [], cancelled: true }, expectedAfter: 0 },
		{ label: "empty submit", result: { answers: [], cancelled: false }, expectedAfter: 1 },
		{ label: "host failure", result: undefined, expectedAfter: 1 },
	])("$label in a mixed batch", async ({ result, expectedAfter }) => {
		const { pi, captured } = createMockPi();
		extension(pi);
		const questionTool = captured.tools.get("ask_user_question")!;
		const before = vi.fn(async () => ({ content: [{ type: "text" as const, text: "before" }], details: {} }));
		const after = vi.fn(async () => ({ content: [{ type: "text" as const, text: "after" }], details: {} }));
		const ctx = createMockCtx({
			hasUI: true,
			ui: { custom: vi.fn(async () => result), select: undefined, input: undefined } as never,
		});
		let rounds = 0;
		const streamFn = vi.fn((_model, _context, options?: SimpleStreamOptions) => {
			if (options?.signal?.aborted) throw new Error("Operation aborted before provider request");
			const message: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				timestamp: Date.now(),
				stopReason: rounds++ === 0 ? "toolUse" : "stop",
				content:
					rounds === 1
						? [
								{ type: "toolCall", id: "before", name: "before", arguments: {} },
								{ type: "toolCall", id: "question", name: "ask_user_question", arguments: params },
								{ type: "toolCall", id: "after", name: "after", arguments: {} },
							]
						: [{ type: "text", text: "Done" }],
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
			return stream;
		});
		let agent: Agent;
		agent = new Agent({
			streamFn,
			initialState: {
				model,
				tools: [
					{ name: "before", label: "Before", description: "Before", parameters: Type.Object({}), execute: before },
					{
						name: questionTool.name,
						label: questionTool.label,
						description: questionTool.description,
						parameters: questionTool.parameters,
						executionMode: questionTool.executionMode,
						execute: (id, args, signal, update) => questionTool.execute(id, args, signal, update, ctx),
					},
					{ name: "after", label: "After", description: "After", parameters: Type.Object({}), execute: after },
				],
			},
			afterToolCall: async ({ toolCall, result: toolResult, isError }) => {
				for (const handler of captured.events.get("tool_result") ?? []) {
					await handler(
						{ toolName: toolCall.name, details: toolResult.details, isError },
						{ ...ctx, abort: () => agent.abort() },
					);
				}
				return undefined;
			},
		});
		await agent.prompt("Offline cancellation check");
		expect(before).toHaveBeenCalledOnce();
		expect(after).toHaveBeenCalledTimes(expectedAfter);
		const questionResult = agent.state.messages.find(
			(m) => m.role === "toolResult" && m.toolName === "ask_user_question",
		);
		expect(questionResult).toBeDefined();
		if (result?.cancelled) {
			expect((questionResult as { details: QuestionnaireResult }).details.cancelled).toBe(true);
			expect(agent.state.isStreaming).toBe(false);
			// Pi may enter the stream function again with an already-aborted signal.
			// Real providers honor this; there is only one non-aborted provider request.
			expect(rounds).toBe(1);
		} else expect(streamFn).toHaveBeenCalledTimes(2);
	});
});
