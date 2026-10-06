---
name: chromium
description: A real Chromium browser for interacting with web pages. Use when you need to browse sites, use pages that require JavaScript or a login, test frontends, take screenshots, or when the user wants to see or interact with the browser.
---

# Chromium

A Chromium browser you drive with one command, `{baseDir}/browser.js`. The window is visible: the user can watch it and use it from their own browser through noVNC. Its profile persists like a normal browser's, so the user may already be logged in to sites.

```bash
{baseDir}/browser.js start                          # Start Chromium (other commands start it when needed)
{baseDir}/browser.js stop                           # Close it when you are done
{baseDir}/browser.js open https://example.com       # Navigate the agent tab (scheme optional)
{baseDir}/browser.js open https://example.com --new # Open a new tab: it becomes the agent tab
{baseDir}/browser.js tabs                           # List tabs
{baseDir}/browser.js tabs switch 2                  # Make tab 2 the agent tab
{baseDir}/browser.js tabs close 2                   # Close tab 2
{baseDir}/browser.js eval 'document.title'          # Evaluate JavaScript in the agent tab
{baseDir}/browser.js dialog                         # List open JavaScript dialogs
{baseDir}/browser.js dialog accept ["text"]         # OK / Leave (with text: answer a prompt)
{baseDir}/browser.js dialog dismiss                 # Cancel / Stay
{baseDir}/browser.js screenshot                     # Screenshot of the agent tab's page
{baseDir}/browser.js screenshot --screen            # Screenshot of what the user sees
{baseDir}/browser.js pick "Click the submit button" # Let the user pick elements
```

## Rules

- **Agent tab.** Every command acts on your tab: the one you opened or switched to, even if the user opens other tabs. When an action of yours opens a new tab (e.g. a `target=_blank` link), you are told and it becomes your tab. Do not close tabs the user opened unless asked.
- **Logins.** Never ask for passwords or log in with credentials yourself. Ask the user to log in in the browser window (through noVNC), wait for their confirmation, then continue.
- **Dialogs.** `alert`, `confirm`, `prompt` and leave-page dialogs block the page; commands report them (`⚠ JavaScript dialog opened …`). Answer with `dialog accept|dismiss` before continuing. Accept a `confirm` only when the action is what the user asked for.
- **Leave the browser open** when you are done, so the user can see what you did. Close it with `stop` only when the user asks. The browser may already be open from an earlier task: your tab is kept, so run `tabs` to see where you are before navigating.

## Commands in detail

- `eval` runs in an async context and must be an expression: wrap statements in an IIFE (see below). Strings are printed as they are, other values as JSON; DOM elements as their HTML. Use it to read the page and to act on it (click, type, scroll).
- `screenshot` captures the page only. `screenshot --screen` captures the whole screen as the user sees it, tabs, address bar and dialogs included, and works even while a dialog blocks the page. Both print the path of a PNG file.
- `pick` shows a picker in the page: the user clicks the elements to select (a second click deselects), Enter confirms, Esc cancels. Tell the user what to select before running it; it waits up to 10 minutes. For each element it returns a unique CSS `selector` plus tag, id, class, text and HTML.

## Working with pages

**Read the page** as text, and its links only when you need them:

```bash
{baseDir}/browser.js eval 'document.body.innerText'
{baseDir}/browser.js eval '[...document.querySelectorAll("a[href]")].map(a => a.textContent.trim() + " → " + a.href)'
```

**Inspect the DOM rather than taking screenshots:**

```javascript
(function() {
  return {
    title: document.title,
    forms: document.forms.length,
    buttons: Array.from(document.querySelectorAll('button, [role="button"]')).map(b => b.textContent.trim()).slice(0, 20),
    inputs: Array.from(document.querySelectorAll('input, textarea, select')).map(i => i.name || i.id).slice(0, 20),
    text: document.body.innerText.slice(0, 2000)
  };
})()
```

**Do several things in one call:**

```javascript
(function() {
  document.querySelector('#accept-cookies')?.click();
  const items = Array.from(document.querySelectorAll('.result')).map(r => r.textContent.trim());
  return { count: items.length, items };
})()
```

**Type into inputs.** Setting `input.value` alone is ignored by React/Vue forms: use the native setter and fire the events (for a `<textarea>` use `HTMLTextAreaElement.prototype`):

```javascript
(function() {
  const input = document.querySelector('input[name="q"]');
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'hello');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.form?.requestSubmit();
  return 'submitted';
})()
```

**Wait for updates** inside the same call:

```javascript
(async function() {
  document.querySelector('#load-more').click();
  await new Promise(r => setTimeout(r, 500));
  return document.querySelectorAll('.item').length;
})()
```
