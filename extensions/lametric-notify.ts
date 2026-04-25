import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SUCCESS_ICON = "a8813";
const ERROR_ICON = "a423";
const DEFAULT_TIMEOUT_MS = 3000;
const NOTIFICATION_CYCLES = 3;
const TMUX_FORMAT = "#S:#I.#P";

type LaMetricFrame = {
	icon?: string;
	text?: string;
};

function getLaMetricBaseUrl(host: string): string {
	const trimmed = host.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return `http://${trimmed}:8080`;
}

function didAgentRunFail(messages: any[]): boolean {
	return messages.some((message) => {
		if (!message || typeof message !== "object") return false;
		if (message.role === "toolResult") return message.isError === true;
		if (message.role === "assistant") {
			return message.stopReason === "error" || message.stopReason === "aborted";
		}
		return false;
	});
}

async function getTmuxWindow(pi: ExtensionAPI): Promise<string | undefined> {
	if (!process.env.TMUX && !process.env.TMUX_PANE) return undefined;

	try {
		const result = await pi.exec("tmux", ["display-message", "-p", TMUX_FORMAT], {
			timeout: 2000,
		});
		if (result.code !== 0) return undefined;
		const tmuxWindow = result.stdout.trim();
		return tmuxWindow.length > 0 ? tmuxWindow : undefined;
	} catch {
		return undefined;
	}
}

function buildFrames(isError: boolean, tmuxWindow?: string): LaMetricFrame[] {
	const frames: LaMetricFrame[] = [
		{
			icon: isError ? ERROR_ICON : SUCCESS_ICON,
			text: isError ? "error" : "done",
		},
		{
			text: os.hostname(),
		},
	];

	if (tmuxWindow) {
		frames.push({ text: tmuxWindow });
	}

	return frames;
}

async function sendNotification(host: string, apiKey: string, frames: LaMetricFrame[]): Promise<void> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

	try {
		const response = await fetch(`${getLaMetricBaseUrl(host)}/api/v2/device/notifications`, {
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(`dev:${apiKey}`, "utf8").toString("base64")}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				priority: "info",
				icon_type: "none",
				lifeTime: 15000,
				model: {
					frames,
					cycles: NOTIFICATION_CYCLES,
				},
			}),
			signal: controller.signal,
		});

		void response.body?.cancel?.();
	} finally {
		clearTimeout(timeout);
	}
}

export default function lametricNotifyExtension(pi: ExtensionAPI): void {
	pi.on("agent_end", async (event) => {
		const host = process.env.LAMETRIC_TIME_HOST;
		const apiKey = process.env.LAMETRIC_TIME_API_KEY;
		if (!host || !apiKey) return;

		try {
			const tmuxWindow = await getTmuxWindow(pi);
			const frames = buildFrames(didAgentRunFail(event.messages), tmuxWindow);
			await sendNotification(host, apiKey, frames);
		} catch {
			// Never let notification failures affect pi.
		}
	});
}
