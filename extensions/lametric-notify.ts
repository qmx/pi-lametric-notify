import os from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SUCCESS_ICON = "a8813";
const ERROR_ICON = "a423";
const SUCCESS_SOUND = "knock-knock";
const ERROR_SOUND = "negative1";
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
			return message.stopReason === "error";
		}
		return false;
	});
}

async function getTmuxWindow(pi: ExtensionAPI, signal: AbortSignal): Promise<string | undefined> {
	if (!process.env.TMUX && !process.env.TMUX_PANE) return undefined;

	try {
		const result = await pi.exec("tmux", ["display-message", "-p", TMUX_FORMAT], {
			timeout: 2000,
			signal,
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

async function sendNotification(
	host: string,
	apiKey: string,
	frames: LaMetricFrame[],
	isError: boolean,
	controller: AbortController,
): Promise<void> {
	const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
	timeout.unref?.();

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
					...(process.env.LAMETRIC_TIME_SOUND
						? {
								sound: {
									category: "notifications",
									id: isError ? ERROR_SOUND : SUCCESS_SOUND,
									repeat: 1,
								},
							}
						: {}),
				},
			}),
			signal: controller.signal,
		});

		void response.body?.cancel?.();
	} finally {
		clearTimeout(timeout);
	}
}

async function notifyLaMetric(pi: ExtensionAPI, messages: any[], controller: AbortController): Promise<void> {
	const host = process.env.LAMETRIC_TIME_HOST;
	const apiKey = process.env.LAMETRIC_TIME_API_KEY;
	if (!host || !apiKey) return;

	const tmuxWindow = await getTmuxWindow(pi, controller.signal);
	const isError = didAgentRunFail(messages);
	const frames = buildFrames(isError, tmuxWindow);
	await sendNotification(host, apiKey, frames, isError, controller);
}

export default function lametricNotifyExtension(pi: ExtensionAPI): void {
	const inFlightNotifications = new Set<AbortController>();

	pi.on("agent_end", (event) => {
		const task = async () => {
			const controller = new AbortController();
			inFlightNotifications.add(controller);
			try {
				await notifyLaMetric(pi, event.messages, controller);
			} finally {
				inFlightNotifications.delete(controller);
			}
		};

		void task().catch(() => {
			// Never let notification failures affect pi.
		});
	});

	pi.on("session_shutdown", () => {
		for (const controller of inFlightNotifications) {
			controller.abort();
		}
		inFlightNotifications.clear();
	});
}
