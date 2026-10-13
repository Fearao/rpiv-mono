import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.js";
import { ASK_USER_PROMPT_EVENT, type AskUserPromptEventPayload } from "./events.js";

/** Opt-in only. Never guess a recipient or pass command-line flags as a recipient. */
function receiverFromConfig(): string | undefined {
	const notification = loadConfig().notification;
	if (notification?.enabled !== true || typeof notification.receiver !== "string") return undefined;
	const receiver = notification.receiver.trim();
	if (!receiver || receiver.startsWith("-") || receiver.length > 200 || /[\x00-\x1f\x7f]/.test(receiver))
		return undefined;
	return receiver;
}

/** Keep failures diagnostic-only: subprocess errors may contain private question/recipient text. */
function reportFailure(): void {
	console.warn(
		"[ask-user-question] xnotify failed; questionnaire is unaffected. Check your local notification setup.",
	);
}

export function registerQuestionNotifications(pi: ExtensionAPI): void {
	pi.events.on(ASK_USER_PROMPT_EVENT, (data) => {
		if (!data || typeof data !== "object" || !("questions" in data) || !Array.isArray(data.questions)) return;
		const payload = data as AskUserPromptEventPayload;
		const receiver = receiverFromConfig();
		const first = payload.questions[0];
		if (!receiver || typeof first?.question !== "string") return;
		const text = first.question.replace(/[\x00-\x1f\x7f]/g, " ");
		const summary = Array.from(text).slice(0, 80).join("");
		const suffix = payload.questions.length > 1 ? `（共 ${payload.questions.length} 个）` : "";
		const message = `[Pi] 需要你回答：${summary}${Array.from(text).length > 80 ? "…" : ""}${suffix}`;
		try {
			void pi
				.exec("xnotify", [message, receiver], { timeout: 5000 })
				.then((result) => {
					if (result.code !== 0 || result.killed) reportFailure();
				})
				.catch(reportFailure);
		} catch {
			reportFailure();
		}
	});
}
