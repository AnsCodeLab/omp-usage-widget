/**
 * Provider usage widget for narrow terminals.
 *
 * omp's built-in status line is a single row (the input editor's top border)
 * and drops segments on overflow — the `usage` segment is among the first
 * left-side segments to go. This extension renders the active model's
 * provider usage windows (Anthropic 5h/7d, OpenAI Codex 5h/7d, Cursor
 * monthly, Google Antigravity weekly, …) as a dedicated line below the
 * editor whenever the terminal is too narrow for the status line to keep
 * the segment, so the usage bar effectively "wraps" to its own line instead
 * of vanishing.
 *
 * Data comes from the same auth-broker usage reports the built-in segment
 * uses (authStorage.fetchUsageReports), cached for 5 minutes. Which
 * provider's usage is shown is driven entirely by the active model: switch
 * from Claude to Codex, Cursor, or Google Antigravity and the widget
 * follows, matching whichever report's `provider` equals the active
 * model's `provider`.
 *
 * By default the widget is always visible (whenever the active model's
 * provider has a usage report with at least one numeric window). Set
 * OMP_USAGE_WIDGET_COLS to a column count to switch to narrow-only mode: the
 * widget then shows only below that width, deferring to the built-in
 * `usage` status-line segment when wide.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const WIDGET_KEY = "claude-usage-line";
const NARROW_COLS = Number(process.env.OMP_USAGE_WIDGET_COLS) || Number.POSITIVE_INFINITY;
const FETCH_TTL_MS = 5 * 60_000;
const RENDER_EVERY_MS = 30_000;

interface WindowSnap {
	code: string;
	percent: number;
	resetsAt?: number;
}

// Short label per raw windowId, mirroring the built-in `usage` segment's
// window classes (5h/7d for Anthropic and OpenAI Codex, monthly for
// Cursor, weekly for Google Antigravity — plus daily variants some
// providers use).
const WINDOW_CODE: Record<string, string> = {
	"5h": "5h",
	"7d": "7d",
	daily: "1d",
	"24h": "1d",
	"1d": "1d",
	weekly: "wk",
	monthly: "mo",
	"30d": "mo",
};

function windowCode(windowId: string | undefined, durationMs: number | undefined): string {
	if (windowId && WINDOW_CODE[windowId]) return WINDOW_CODE[windowId];
	if (typeof durationMs === "number") {
		if (Math.abs(durationMs - 5 * 3_600_000) <= 60_000) return "5h";
		if (Math.abs(durationMs - 86_400_000) <= 60_000) return "1d";
		if (Math.abs(durationMs - 7 * 86_400_000) <= 60_000) return "7d";
		if (Math.abs(durationMs - 30 * 86_400_000) <= 86_400_000) return "mo";
	}
	return (windowId ?? "?").slice(0, 2);
}

// Best-effort match between a report limit and the active model. Some
// providers (Google Antigravity) split one window across model families in
// the same report — e.g. a Gemini weekly bucket and a shared Claude/GPT
// weekly bucket — distinguished only by a family segment in the limit id.
function limitMatchesModel(limitId: string, model: { id?: string; identity?: { family?: string } } | undefined): boolean {
	if (!model) return false;
	const id = limitId.toLowerCase();
	const modelId = (model.id ?? "").toLowerCase();
	const family = (model.identity?.family ?? "").toLowerCase();
	const isGemini = modelId.includes("gemini") || family.includes("gemini");
	if (id.includes(":google:")) return isGemini;
	if (id.includes(":anthropic:") || id.includes(":openai:")) return !isGemini;
	return false;
}

export default function (api: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let windows: WindowSnap[] = [];
	let fetchedAt = 0;
	let fetching = false;
	let timer: NodeJS.Timeout | undefined;
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
		// omp >= 18 moved this to authStorage.usage.reports(); older builds expose
		// authStorage.fetchUsageReports().
		const authStorage = ctx.modelRegistry.authStorage as any;
		const fetchReports: ((opts: { signal: AbortSignal }) => Promise<any[] | null>) | undefined =
			typeof authStorage?.usage?.reports === "function"
				? (opts) => authStorage.usage.reports(opts)
				: typeof authStorage?.fetchUsageReports === "function"
					? (opts) => authStorage.fetchUsageReports(opts)
					: undefined;
		if (!fetchReports) return;
		const activeModel = ctx.models.current();
		const activeProvider = activeModel?.provider;
		fetching = true;
		try {
			const reports = await fetchReports({ signal: AbortSignal.timeout(5_000) });
			fetchedAt = Date.now();
			const byCode: Record<string, { snap: WindowSnap; matchesModel: boolean; tiered: boolean }> = {};
			if (activeProvider) {
				for (const report of reports ?? []) {
					if (report?.provider !== activeProvider) continue;
					for (const limit of report.limits ?? []) {
						const fraction = limit.amount?.usedFraction;
						if (typeof fraction !== "number") continue;
						const code = windowCode(limit.scope?.windowId, limit.window?.durationMs);
						const matchesModel = limitMatchesModel(limit.id ?? "", activeModel);
						const tiered = Boolean(limit.scope?.tier);
						const candidate = { snap: { code, percent: fraction * 100, resetsAt: limit.window?.resetsAt }, matchesModel, tiered };
						const existing = byCode[code];
						// One rendered window per code: prefer a limit matching the
						// active model's family, then an untiered/shared one, then
						// whichever the report listed first.
						if (
							!existing ||
							(candidate.matchesModel && !existing.matchesModel) ||
							(!existing.matchesModel && !candidate.tiered && existing.tiered)
						) {
							byCode[code] = candidate;
						}
					}
				}
			}
			windows = Object.values(byCode).map((v) => v.snap);
		} catch {
			fetchedAt = Date.now(); // back off until the TTL elapses
		} finally {
			fetching = false;
		}
	}

	function render(): void {
		if (!ctx?.hasUI) return;
		const cols = process.stdout.columns ?? 120;
		if (cols >= NARROW_COLS || windows.length === 0) {
			if (widgetShown) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				widgetShown = false;
			}
			return;
		}
		const parts = windows.map((w) => `${w.code} ${color(w.percent)}${Math.round(w.percent)}%\x1b[0m${fmtReset(w.resetsAt)}`);
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
