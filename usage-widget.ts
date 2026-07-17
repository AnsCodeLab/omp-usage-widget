/**
 * Claude usage widget for narrow terminals.
 *
 * omp's built-in status line is a single row (the input editor's top border)
 * and drops segments on overflow — the `usage` segment is among the first
 * left-side segments to go. This extension renders the same Anthropic plan
 * windows (5h / 7d) as a dedicated line below the editor whenever the
 * terminal is too narrow for the status line to keep the segment, so the
 * usage bar effectively "wraps" to its own line instead of vanishing.
 *
 * Data comes from the same auth-broker usage reports the built-in segment
 * uses (authStorage.fetchUsageReports), cached for 5 minutes. The widget only
 * appears when the active model's provider is `anthropic`.
 *
 * Tune the width threshold with OMP_USAGE_WIDGET_COLS (default 140): below
 * this many columns the widget shows, at or above it the built-in status-line
 * segment is assumed to fit and the widget hides.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const WIDGET_KEY = "claude-usage-line";
const NARROW_COLS = Number(process.env.OMP_USAGE_WIDGET_COLS) || 140;
const FETCH_TTL_MS = 5 * 60_000;
const RENDER_EVERY_MS = 30_000;

interface WindowSnap {
	percent: number;
	resetsAt?: number;
}

export default function (api: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let fiveHour: WindowSnap | undefined;
	let sevenDay: WindowSnap | undefined;
	let fetchedAt = 0;
	let fetching = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let widgetShown = false;

	const color = (pct: number): string => (pct >= 80 ? "\x1b[31m" : pct >= 50 ? "\x1b[33m" : "\x1b[32m");

	// Absolute local reset time, "↻" standing in for "resets" to save width.
	const fmtReset = (resetsAt: number | undefined): string => {
		if (typeof resetsAt !== "number") return "";
		const d = new Date(resetsAt);
		const day = d.toLocaleDateString("en-US", { weekday: "short" });
		const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		return ` (↻ ${day} ${hm})`;
	};

	async function refresh(): Promise<void> {
		if (!ctx || fetching || Date.now() - fetchedAt < FETCH_TTL_MS) return;
		const authStorage = ctx.modelRegistry.authStorage;
		if (typeof authStorage?.fetchUsageReports !== "function") return;
		fetching = true;
		try {
			const reports = await authStorage.fetchUsageReports({ signal: AbortSignal.timeout(5_000) });
			fetchedAt = Date.now();
			fiveHour = sevenDay = undefined;
			for (const report of reports ?? []) {
				if (report?.provider !== "anthropic") continue;
				for (const limit of report.limits ?? []) {
					const fraction = limit.amount?.usedFraction;
					if (typeof fraction !== "number") continue;
					const snap: WindowSnap = { percent: fraction * 100, resetsAt: limit.window?.resetsAt };
					// Untiered limits win over tiered ones, mirroring the built-in segment.
					const tiered = Boolean(limit.scope?.tier);
					if (limit.scope?.windowId === "5h" && (!fiveHour || !tiered)) fiveHour = snap;
					else if (limit.scope?.windowId === "7d" && (!sevenDay || !tiered)) sevenDay = snap;
				}
			}
		} catch {
			fetchedAt = Date.now(); // back off until the TTL elapses
		} finally {
			fetching = false;
		}
	}

	function render(): void {
		if (!ctx?.hasUI) return;
		const cols = process.stdout.columns ?? 120;
		const anthropicActive = ctx.models.current()?.provider === "anthropic";
		if (cols >= NARROW_COLS || !anthropicActive || (!fiveHour && !sevenDay)) {
			if (widgetShown) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				widgetShown = false;
			}
			return;
		}
		const parts: string[] = [];
		if (fiveHour) {
			parts.push(`5h ${color(fiveHour.percent)}${Math.round(fiveHour.percent)}%\x1b[0m${fmtReset(fiveHour.resetsAt)}`);
		}
		if (sevenDay) {
			parts.push(`7d ${color(sevenDay.percent)}${Math.round(sevenDay.percent)}%\x1b[0m${fmtReset(sevenDay.resetsAt)}`);
		}
		ctx.ui.setWidget(WIDGET_KEY, [` ${parts.join(" · ")}`], { placement: "belowEditor" });
		widgetShown = true;
	}

	function tick(): void {
		void refresh().then(render);
	}

	api.on("session_start", (_event, c) => {
		ctx = c;
		tick();
		if (!timer) {
			timer = setInterval(tick, RENDER_EVERY_MS);
			(timer as unknown as { unref?: () => void }).unref?.();
			process.stdout.on?.("resize", render);
		}
	});
	api.on("turn_end", (_event, c) => {
		ctx = c;
		tick();
	});
	api.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});
}
