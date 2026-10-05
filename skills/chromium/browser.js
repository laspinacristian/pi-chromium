#!/usr/bin/env node
// The agent's command: sends commands to server.js (the service that owns Chromium)
// and starts it when it is not running.
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT = "pi-chromium"; // server.js
const VDISPLAY_UNIT = "pi-chromium-vdisplay"; // the virtual display Chromium runs on (install.sh)
const SOCKET = join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, "pi-chromium.sock");

const USAGE = `Usage: browser.js <command>

  start                            Start Chromium (other commands start it when needed)
  stop                             Close Chromium
  open <url> [--new]               Navigate the agent tab, or open a new tab
  tabs [switch <n> | close <n>]    List tabs, make tab n the agent tab, close tab n
  eval '<js>'                      Evaluate a JavaScript expression in the agent tab
  dialog [accept [text] | dismiss] List or answer JavaScript dialogs
  screenshot [--screen]            Screenshot of the agent tab, or of the whole screen
  pick '<message>'                 Let the user pick elements in the page`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

function usage() {
	console.error(USAGE);
	process.exit(1);
}

/** One command to the server: { output } or { error }, plus notices; undefined if it is not running. */
function send(command, args = {}, timeoutMs = 120000) {
	return new Promise((resolve) => {
		const req = request({ socketPath: SOCKET, method: "POST", path: "/", timeout: timeoutMs }, (res) => {
			let body = "";
			res.on("data", (chunk) => (body += chunk));
			res.on("end", () => resolve(JSON.parse(body)));
		});
		req.on("error", () => resolve(undefined));
		req.on("timeout", () => {
			req.destroy();
			resolve({ error: `No answer from the browser within ${timeoutMs / 1000}s` });
		});
		req.end(JSON.stringify({ command, args }));
	});
}

async function ensureServer() {
	if (await send("ping", {}, 5000)) return;
	if (spawnSync("systemctl", ["--user", "is-active", "--quiet", VDISPLAY_UNIT]).status !== 0)
		fail(`The virtual display is not running. The user can start it with: systemctl --user start ${VDISPLAY_UNIT}`);
	const run = spawnSync(
		"systemd-run",
		[
			"--user", "--quiet", "--collect", `--unit=${UNIT}`,
			"--description=Chromium for the Pi agent (pi-chromium)",
			// On stop only server.js gets SIGTERM: it closes Chromium gracefully
			"--property=KillMode=mixed", "--property=TimeoutStopSec=20",
			...(process.env.PI_CODING_AGENT_DIR ? [`--setenv=PI_CODING_AGENT_DIR=${process.env.PI_CODING_AGENT_DIR}`] : []),
			process.execPath, join(dirname(fileURLToPath(import.meta.url)), "server.js"), SOCKET,
		],
		{ encoding: "utf8" },
	);
	// "already exists": it is starting (another command got there first)
	if (run.status !== 0 && !run.stderr.includes("already exists")) fail(`Could not start the browser: ${run.stderr.trim()}`);
	for (let i = 0; i < 60; i++) {
		if (await send("ping", {}, 5000)) return;
		await sleep(500);
	}
	fail(`The browser did not start. Logs: journalctl --user -u ${UNIT}`);
}

/** Run a command on the server and print what happened and its result. */
async function call(command, args, { timeoutMs } = {}) {
	await ensureServer();
	const reply = await send(command, args, timeoutMs);
	for (const notice of reply.notices ?? []) console.log(notice);
	if (reply.error) fail(reply.error);
	if (reply.output) console.log(reply.output);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case "start":
		await ensureServer();
		console.log("✓ Chromium is running. The user can watch and use it through noVNC");
		break;

	case "stop":
		spawnSync("systemctl", ["--user", "stop", UNIT], { stdio: "ignore" });
		console.log("✓ Chromium closed");
		break;

	case "open": {
		const url = args.find((a) => !a.startsWith("--"));
		if (!url) usage();
		await call("open", { url, newTab: args.includes("--new") });
		break;
	}

	case "tabs": {
		const [action, n] = args;
		if (action && (!["switch", "close"].includes(action) || !Number.isInteger(Number(n)))) usage();
		await call("tabs", action ? { action, index: Number(n) } : {});
		break;
	}

	case "eval":
		if (args.length === 0) usage();
		await call("eval", { code: args.join(" ") });
		break;

	case "dialog": {
		const [action, ...text] = args;
		if (action && !["accept", "dismiss"].includes(action)) usage();
		await call("dialog", { action, text: text.length ? text.join(" ") : undefined });
		break;
	}

	case "screenshot":
		await call("screenshot", { screen: args.includes("--screen") });
		break;

	case "pick":
		if (args.length === 0) usage();
		await call("pick", { message: args.join(" ") }, { timeoutMs: 11 * 60 * 1000 });
		break;

	default:
		usage();
}
