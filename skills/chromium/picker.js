// Interactive element picker, run inside the page (based on browser-pick.js from
// badlogic/pi-skills). The user clicks the elements to select (a second click
// deselects), Enter confirms, Esc cancels. The outcome is left in window.__piPick,
// which the server polls, so no protocol call has to wait for the user.
export function startPicker(message) {
	window.__piPick = { done: false, result: null };
	const finish = (result) => {
		window.__piPick = { done: true, result };
	};

	const selected = new Set(); // in click order

	const overlay = document.createElement("div");
	overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none";
	const highlight = document.createElement("div");
	highlight.style.cssText = "position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s";
	overlay.appendChild(highlight);
	const banner = document.createElement("div");
	banner.style.cssText =
		"position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 24px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;z-index:2147483647";
	const updateBanner = () => {
		banner.textContent = `${message} — click to select (again to deselect), Enter to confirm, Esc to cancel · ${selected.size} selected`;
	};
	updateBanner();
	document.body.append(banner, overlay);

	// Unique CSS selector: the closest unique id, then tag:nth-of-type steps down to the element
	const cssSelector = (el) => {
		const parts = [];
		for (let cur = el; cur && cur.nodeType === 1 && cur !== document.documentElement; cur = cur.parentElement) {
			if (cur.id && document.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
				parts.unshift(`#${CSS.escape(cur.id)}`);
				break;
			}
			let part = cur.tagName.toLowerCase();
			const siblings = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : [];
			if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
			parts.unshift(part);
		}
		return parts.join(" > ");
	};
	const describe = (el) => ({
		selector: cssSelector(el),
		tag: el.tagName.toLowerCase(),
		id: el.id || null,
		class: el.className || null,
		text: el.textContent?.trim().slice(0, 200) || null,
		html: el.outerHTML.slice(0, 500),
	});

	const cleanup = () => {
		for (const [event, handler] of listeners) document.removeEventListener(event, handler, true);
		overlay.remove();
		banner.remove();
		for (const el of selected) el.style.outline = "";
	};
	const target = (e) => {
		const el = document.elementFromPoint(e.clientX, e.clientY);
		return el && !overlay.contains(el) && !banner.contains(el) ? el : null;
	};
	const onMove = (e) => {
		const el = target(e);
		if (!el) return;
		const r = el.getBoundingClientRect();
		Object.assign(highlight.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
	};
	// While picking, the page must not react: no focus, no menus opening on mouse down
	const block = (e) => {
		if (banner.contains(e.target)) return;
		e.preventDefault();
		e.stopPropagation();
	};
	const onClick = (e) => {
		if (banner.contains(e.target)) return;
		e.preventDefault();
		e.stopPropagation();
		const el = target(e);
		if (!el) return;
		if (selected.has(el)) {
			selected.delete(el);
			el.style.outline = "";
		} else {
			selected.add(el);
			el.style.outline = "3px solid #10b981";
		}
		updateBanner();
	};
	const onKey = (e) => {
		if (e.key === "Escape") {
			e.preventDefault();
			cleanup();
			finish(null);
		} else if (e.key === "Enter" && selected.size > 0) {
			e.preventDefault();
			e.stopPropagation();
			const elements = [...selected];
			cleanup(); // first: removes the green outlines, which are not part of the page
			finish(elements.map(describe));
		}
	};
	const listeners = [
		["mousemove", onMove],
		["click", onClick],
		["mousedown", block],
		["mouseup", block],
		["keydown", onKey],
	];
	for (const [event, handler] of listeners) document.addEventListener(event, handler, true);
}
