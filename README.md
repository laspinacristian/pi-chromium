# pi-chromium

A [Pi](https://pi.dev) skill that gives the agent a real Chromium browser. You watch it and use it from your own browser through noVNC.

## Requirements

- Chromium: the browser
- TigerVNC (`Xvnc`, `vncpasswd`): the virtual display the browser runs on
- noVNC and websockify: the web page to watch the display
- xauth: access to the display for your user only
- scrot: screenshots of the whole display
- pi, Node.js 22.12+, systemd

```bash
sudo dnf install chromium tigervnc-x11-server novnc python3-websockify xorg-x11-xauth scrot      # Fedora
sudo apt install chromium tigervnc-standalone-server tigervnc-tools novnc websockify xauth scrot  # Debian/Ubuntu
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/laspinacristian/pi-chromium/main/install.sh | bash
```

Then open `http://<server>:6080/` with the VNC password the installer prints. To change it: `vncpasswd ~/.pi/agent/chromium/vncpasswd`.

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
