# pi-chromium

A [Pi](https://pi.dev) skill that gives the agent a real Chromium browser. You watch it and use it from your own browser through noVNC.

## Requirements

- Chromium: the browser
- TigerVNC (`Xvnc`): the virtual display the browser runs on
- noVNC and websockify: the web page to watch the display
- xauth: access to the display for your user only
- scrot: screenshots of the whole display
- pi, Node.js 22.12+, systemd

```bash
sudo dnf install chromium tigervnc-x11-server novnc python3-websockify xorg-x11-xauth scrot      # Fedora
sudo apt install chromium tigervnc-standalone-server novnc websockify xauth scrot  # Debian/Ubuntu
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/laspinacristian/pi-chromium/main/install.sh | bash
```

noVNC listens on `127.0.0.1:6080` and has no password of its own: put it behind a reverse proxy that adds HTTPS and authentication, and open `vnc.html`.

noVNC reads its settings from the URL. With [Caddy](https://caddyserver.com), on its own hostname, already connected and scaled to the window:

```caddyfile
browser.example.com {
	basic_auth {
		user <hash from: caddy hash-password>
	}
	redir / /vnc.html#autoconnect=true&resize=scale&reconnect=true&path=websockify
	reverse_proxy 127.0.0.1:6080
}
```

Run the same command again to update.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/laspinacristian/pi-chromium/main/install.sh | bash -s -- --uninstall
```

The browser profile stays in `~/.pi/agent/chromium/profile`. Add `--purge` to delete it too.

## Credits

Based on the `browser-tools` skill in [badlogic/pi-skills](https://github.com/badlogic/pi-skills) by Mario Zechner.

## License

[MIT](LICENSE)
