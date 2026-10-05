#!/usr/bin/env node
// The service that owns Chromium: the systemd user unit pi-chromium, started by browser.js.
//
// It stays connected to the browser, so it always knows the agent's tab, follows new
// tabs the agent opens and can answer JavaScript dialogs (Chromium lets only a client
// that was listening when a dialog opened answer it). browser.js sends it commands as
// JSON over a private unix socket, whose path it passes as the only argument. On stop
// it closes Chromium gracefully, so cookies still in memory are written to the profile.
import { execFileSync, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { startPicker } from "./picker.js";

const SOCKET = process.argv[2];
const CHROMIUM = execSync("command -v chromium-browser || command -v chromium", { encoding: "utf8" }).trim(); // chromium-browser on Fedora
const DISPLAY = ":99"; // the virtual display of install.sh (pi-chromium-vdisplay), 1920x1080
const WINDOW_SIZE = "1920,1080";
const PROFILE = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "chromium", "profile");

const browser = await puppeteer.launch({
	executablePath: CHROMIUM,
	headless: false,
	pipe: true, // DevTools over a pipe: no debugging port that other processes could use
	ignoreDefaultArgs: true, // only the flags below: puppeteer's own mark the browser as automated
	args: [
		`--user-data-dir=${PROFILE}`,
		"--ozone-platform=x11",
		`--window-size=${WINDOW_SIZE}`,
		"--window-position=0,0",
		"--no-first-run",
		"--no-default-browser-check",
		"--hide-crash-restore-bubble", // after a crash, no "Restore pages?" bubble: the agent does not need it
		"--password-store=basic", // no keyring on the server: saved cookies stay readable
		"about:blank",
	],
	env: { ...process.env, DISPLAY },
	defaultViewport: null,
	handleSIGINT: false,
	handleSIGTERM: false,
	handleSIGHUP: false,
});

// ---- State -------------------------------------------------------------------

let agentTab; // the tab the agent works in
const dialogs = new Map(); // tab → open JavaScript dialog
let notices = []; // what happened during a command, reported with its reply

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

function watch(page) {
	// Driven over DevTools, Chromium sets navigator.webdriver, which sites read to spot
	// automated browsers: keep it false, as in a normal browser
	page
		.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }))
		.catch(() => {});
	page.on("dialog", (dialog) => {
		dialogs.set(page, dialog);
		if (page === agentTab) {
			notices.push(`⚠ JavaScript dialog opened (${dialog.type()}: "${dialog.message()}"). The page is blocked: answer it with browser.js dialog accept|dismiss`);
		}
	});
	// A link or script of the agent's tab opened a new tab: follow it, like a user would
	page.on("popup", (popup) => {
		if (page !== agentTab || !popup) return;
		agentTab = popup;
		notices.push(() => `↗ A new tab opened and is now the agent tab: ${popup.url()}`);
	});
	page.on("close", () => {
		dialogs.delete(page);
		if (page === agentTab) agentTab = undefined;
	});
	// The user may answer a dialog in the browser window
	page
		.createCDPSession()
		.then(async (session) => {
			session.on("Page.javascriptDialogClosed", () => dialogs.delete(page));
			await session.send("Page.enable");
		})
		.catch(() => {});
}

browser.on("targetcreated", async (target) => {
	const page = await target.page().catch(() => null);
	if (page) watch(page);
});
for (const page of await browser.pages()) watch(page);
agentTab = (await browser.pages())[0];

// ---- Helpers -----------------------------------------------------------------

const tabs = async () => (await browser.pages()).filter((p) => !p.url().startsWith("devtools://"));

// A tab blocked by a dialog cannot run scripts: page.title() would hang
const titleOf = async (page) => (dialogs.has(page) ? "(blocked by a JavaScript dialog)" : await page.title());

/** The agent's tab, in front so the user sees it. Throws when a dialog blocks it. */
async function agent() {
	if (!agentTab || agentTab.isClosed()) {
		agentTab = (await tabs()).at(-1) ?? (await browser.newPage());
		notices.push(`ℹ Agent tab is now: ${agentTab.url()}`);
	}
	const dialog = dialogs.get(agentTab);
	if (dialog) {
		throw new Error(
			`The agent tab is blocked by a JavaScript dialog (${dialog.type()}: "${dialog.message()}"). ` +
				"Answer it with browser.js dialog accept|dismiss (see it with browser.js screenshot --screen)",
		);
	}
	await agentTab.bringToFront();
	return agentTab;
}

/** Addresses without a scheme, like the address bar: example.com → https://, localhost:3000 → http:// */
function normalizeUrl(url) {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|chrome|file|view-source):/i.test(url)) return url;
	const host = url.split(/[/:?#]/)[0];
	const local = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
	return `${local ? "http" : "https"}://${url}`;
}

/** Strings as they are, everything else as readable JSON. */
const format = (value) => (typeof value === "string" ? value : value === undefined ? "undefined" : JSON.stringify(value, null, 2));

/** Run fn on the page; a JavaScript dialog opening meanwhile ends the wait instead of hanging it. */
async function untilDialog(page, fn) {
	let onDialog;
	const opened = new Promise((resolve) => page.once("dialog", (onDialog = () => resolve({ dialog: true }))));
	try {
		return await Promise.race([fn().then((value) => ({ value })), opened]);
	} finally {
		page.off("dialog", onDialog);
	}
}

// ---- Commands ----------------------------------------------------------------

const commands = {
	ping: async () => "pong",

	async open({ url, newTab }) {
		url = normalizeUrl(url);
		let page;
		if (newTab) {
			page = agentTab = await browser.newPage();
			await page.bringToFront();
		} else {
			page = await agent();
		}
		try {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
		} catch (e) {
			throw new Error(`Navigation to ${url} failed: ${firstLine(e)}`);
		}
		await sleep(300);
		return `✓ ${page.url()}\n  Title: ${await titleOf(page)}`;
	},

	async tabs({ action, index }) {
		const list = await tabs();
		if (!action) {
			const lines = [];
			for (const [i, page] of list.entries()) {
				lines.push(`${i + 1}. ${await titleOf(page)} — ${page.url()}${page === agentTab ? "   ← agent tab" : ""}`);
			}
			return lines.join("\n") || "No tabs open";
		}
		const page = list[index - 1];
		if (!page) throw new Error(`No tab ${index}: there are ${list.length}. Run browser.js tabs to list them`);
		if (action === "switch") {
			agentTab = page;
			await page.bringToFront();
			return `✓ Agent tab: ${await titleOf(page)} — ${page.url()}`;
		}
		const url = page.url();
		await page.close();
		return `✓ Closed: ${url}`;
	},

	async eval({ code }) {
		const page = await agent();
		let result;
		try {
			result = await untilDialog(page, () =>
				page.evaluate(async (c) => {
					const AsyncFunction = (async () => {}).constructor;
					const value = await new AsyncFunction(`return (${c})`)();
					// DOM nodes are not serializable: return their HTML (or text) instead
					const describe = (v) =>
						v instanceof Element ? v.outerHTML.slice(0, 2000) : v instanceof Node ? (v.textContent ?? "").slice(0, 2000) : v;
					return value instanceof NodeList || value instanceof HTMLCollection ? Array.from(value, describe) : describe(value);
				}, code),
			);
		} catch (e) {
			// The code made the page navigate (e.g. it submitted a form): that is not an error
			if (/context was destroyed|detached Frame/i.test(e.message)) {
				await sleep(1000);
				return `✓ The page navigated to ${page.url()}\n  Title: ${await titleOf(page)}`;
			}
			const syntax = /SyntaxError|Unexpected token|Unexpected identifier/.test(e.message);
			throw new Error(
				firstLine(e) + (syntax ? "\n  The code must be an expression. Wrap statements in an IIFE: '(function() { ...; return x; })()'" : ""),
			);
		}
		await sleep(300); // let new tabs and dialogs opened by the code show up
		return result.dialog ? "" : format(result.value);
	},

	async dialog({ action, text }) {
		const open = [...dialogs].sort(([a], [b]) => (b === agentTab) - (a === agentTab));
		if (!action) {
			return open.map(([page, d]) => `${d.type()}: "${d.message()}" — ${page.url()}${page === agentTab ? "   ← agent tab" : ""}`).join("\n") || "No JavaScript dialog is open";
		}
		if (open.length === 0) return "✓ No JavaScript dialog is open";
		const [page, d] = open[0];
		dialogs.delete(page);
		await (action === "accept" ? d.accept(text) : d.dismiss());
		await sleep(300);
		return `✓ ${d.type()} "${d.message()}" ${action === "accept" ? "accepted" : "dismissed"}`;
	},

	async screenshot({ screen }) {
		const path = join(tmpdir(), `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
		if (screen) {
			// The whole display, browser interface and dialogs included: it does not go
			// through the page, so it also works while a dialog blocks it
			execFileSync("scrot", ["--overwrite", path], { env: { ...process.env, DISPLAY }, stdio: "pipe" });
		} else {
			await (await agent()).screenshot({ path });
		}
		return path;
	},

	async pick({ message }) {
		const page = await agent();
		await page.evaluate(startPicker, message);
		for (let t = 0; t < 600; t++) {
			await sleep(1000);
			if (dialogs.has(page)) throw new Error("Picker interrupted by a JavaScript dialog");
			const state = await page.evaluate(() => window.__piPick).catch(() => null);
			if (!state) throw new Error("Picker interrupted: the page changed");
			if (state.done) return state.result === null ? "Selection cancelled by the user" : format(state.result);
		}
		throw new Error("No selection within 10 minutes");
	},
};

// ---- Socket ------------------------------------------------------------------

let queue = Promise.resolve(); // one command at a time

const server = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => (body += chunk));
	req.on("end", () => {
		const reply = (data) => {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ...data, notices: notices.map((n) => (typeof n === "function" ? n() : n)) }));
		};
		const run = async () => {
			const { command, args } = JSON.parse(body || "{}");
			if (!commands[command]) throw new Error(`Unknown command: ${command}`);
			notices = [];
			return commands[command](args ?? {});
		};
		const job = queue.then(run, run);
		queue = job.catch(() => {});
		// Errors: our messages have at most a hint line; puppeteer's may carry a stack
		job.then((output) => reply({ output }), (e) => reply({ error: String(e?.message ?? e).split("\n").filter((l) => !/^\s+at /.test(l)).slice(0, 2).join("\n") }));
	});
});

rmSync(SOCKET, { force: true });
server.listen(SOCKET);

// ---- Shutdown ----------------------------------------------------------------
// Chromium writes cookies still in memory (e.g. a fresh login) while it shuts down:
// exit only once its process is gone, or systemd would kill it halfway.

const chromiumExited = new Promise((resolve) => browser.process().once("exit", resolve));
let closing = false;

async function shutdown() {
	if (closing) return;
	closing = true;
	server.close();
	await browser.close().catch(() => {});
	await Promise.race([chromiumExited, sleep(15000)]);
	rmSync(SOCKET, { force: true });
	process.exit(0);
}

process.on("SIGTERM", shutdown); // systemctl stop (browser.js stop, shutdown of the server)
process.on("SIGINT", shutdown);
browser.on("disconnected", shutdown); // the user closed the browser window
