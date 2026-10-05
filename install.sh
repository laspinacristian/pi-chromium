#!/usr/bin/env bash
# Install:   curl -fsSL https://raw.githubusercontent.com/laspinacristian/pi-chromium/main/install.sh | bash
# Uninstall: curl -fsSL https://raw.githubusercontent.com/laspinacristian/pi-chromium/main/install.sh | bash -s -- --uninstall
#            (add --purge to delete the browser profile too)
#
# Checks the dependencies, installs the skill with pi and sets up two systemd user services:
#   pi-chromium-vdisplay the virtual display :99 Chromium runs on (Xvnc, VNC on localhost:5999)
#   pi-chromium-novnc   the web page to watch and use that display (noVNC, port 6080)
# No root needed: it does not install system packages, it tells you which ones are missing.
# The VNC password goes in ~/.pi/agent/chromium ($PI_CODING_AGENT_DIR/chromium), next to
# the browser profile.
set -euo pipefail

SOURCE=git:github.com/laspinacristian/pi-chromium
DISPLAY_NUM=99 # display :99, 1920x1080: the same values as skills/chromium/server.js
SIZE=1920x1080
PORT=6080
DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/chromium" # the same as skills/chromium/server.js
PROFILE="$DIR/profile"
UNITS="$HOME/.config/systemd/user"
WEB="$HOME/.local/share/pi-chromium/novnc"

die() { echo "Error: $*" >&2; exit 1; }

# Clean up first, so that installing again (to update) starts from scratch.
# Chromium first: it runs on the display and closes gracefully, saving its data.
stop_services() {
    systemctl --user stop pi-chromium.service 2>/dev/null || true
    systemctl --user disable --now pi-chromium-novnc.service pi-chromium-vdisplay.service 2>/dev/null || true
    rm -f "$UNITS/pi-chromium-vdisplay.service" "$UNITS/pi-chromium-novnc.service"
    systemctl --user daemon-reload
    rm -rf "$WEB"
}

case "${1:-}" in
    --uninstall)
        stop_services
        rm -rf "$DIR/vncpasswd" "$HOME/.local/share/pi-chromium"
        xauth remove ":$DISPLAY_NUM" 2>/dev/null || true
        if command -v pi >/dev/null; then pi remove "$SOURCE" || true; fi
        if [[ "${2:-}" == --purge ]]; then
            rm -rf "$DIR"
            echo "Uninstalled pi-chromium and deleted the browser profile."
        else
            echo "Uninstalled pi-chromium. The browser profile (logins, history) is kept in $PROFILE"
        fi
        exit 0 ;;
    '') ;;
    *) die "unknown option: $1" ;;
esac

# ---- Dependencies ------------------------------------------------------------

find_novnc() {
    local dir
    for dir in ${NOVNC_DIR:-} /usr/share/novnc /usr/share/webapps/novnc /usr/local/share/novnc; do
        if [[ -f "$dir/vnc.html" ]]; then echo "$dir"; return 0; fi
    done
    return 1
}

missing=()
for cmd in pi node systemctl Xvnc vncpasswd websockify xauth mcookie scrot; do
    command -v "$cmd" >/dev/null || missing+=("$cmd")
done
command -v chromium-browser >/dev/null || command -v chromium >/dev/null || missing+=(chromium)
NOVNC=$(find_novnc) || missing+=(noVNC)
if (( ${#missing[@]} )); then
    echo "Missing: ${missing[*]}. Install them with your package manager." >&2
    echo "noVNC in another directory: NOVNC_DIR=/path/to/novnc" >&2
    exit 1
fi
systemctl --user show-environment >/dev/null 2>&1 || die "no systemd user session (systemctl --user does not work)."

# ---- Skill -------------------------------------------------------------------

if pi list 2>/dev/null | grep -qE "^\s*$SOURCE\s*$"; then
    pi update --extension "$SOURCE"
else
    pi install "$SOURCE"
fi

# ---- Display and noVNC -------------------------------------------------------

stop_services

# VNC password, only the first time (VNC uses at most 8 characters)
mkdir -p "$DIR"
password=
if [[ ! -s "$DIR/vncpasswd" ]]; then
    cookie=$(mcookie)
    password=${cookie:0:8}
    (umask 077; printf '%s\n' "$password" | vncpasswd -f > "$DIR/vncpasswd")
fi

# X11 cookie for the display in ~/.Xauthority: only this user's programs can use it
if ! xauth list ":$DISPLAY_NUM" 2>/dev/null | grep -q .; then
    xauth add ":$DISPLAY_NUM" . "$(mcookie)"
fi

# noVNC's files, plus an entry page that opens it already configured, from any address
# (directly on the port or behind a reverse proxy under a path such as /browser/)
mkdir -p "$WEB"
for file in app core vendor vnc.html package.json; do
    if [[ -e "$NOVNC/$file" ]]; then ln -s "$NOVNC/$file" "$WEB/$file"; fi
done
cat > "$WEB/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pi-chromium</title>
<script>
  // noVNC wants the WebSocket path without the leading "/". Settings go after the #,
  // so that noVNC does not save them in the site's localStorage.
  const dir = location.pathname.replace(/[^/]*$/, "");
  const settings = new URLSearchParams({ path: dir.slice(1) + "websockify", autoconnect: "1", resize: "scale", reconnect: "1" });
  location.replace("vnc.html#" + settings);
</script>
</head>
<body></body>
</html>
EOF

mkdir -p "$UNITS"
cat > "$UNITS/pi-chromium-vdisplay.service" <<EOF
# Installed by pi-chromium (install.sh). Virtual display :$DISPLAY_NUM the agent's Chromium runs on,
# with a VNC server on localhost:$((5900 + DISPLAY_NUM)) (password in $DIR/vncpasswd).
[Unit]
Description=Virtual display :$DISPLAY_NUM for the Pi agent's Chromium (pi-chromium)

[Service]
ExecStart=$(command -v Xvnc) :$DISPLAY_NUM -geometry $SIZE -depth 24 -auth %h/.Xauthority -nolisten tcp -localhost -rfbport $((5900 + DISPLAY_NUM)) -SecurityTypes VncAuth -PasswordFile $DIR/vncpasswd -AlwaysShared -AcceptSetDesktopSize=0 -desktop pi-chromium
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
cat > "$UNITS/pi-chromium-novnc.service" <<EOF
# Installed by pi-chromium (install.sh). Web page (noVNC) to watch and use the display of
# pi-chromium-vdisplay from a browser, on port $PORT. It asks for the VNC password.
[Unit]
Description=noVNC for the Pi agent's Chromium (pi-chromium)
Wants=pi-chromium-vdisplay.service
After=pi-chromium-vdisplay.service

[Service]
ExecStart=$(command -v websockify) --web $WEB --file-only --heartbeat 30 0.0.0.0:$PORT localhost:$((5900 + DISPLAY_NUM))
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now pi-chromium-vdisplay.service pi-chromium-novnc.service
sleep 1
for unit in pi-chromium-vdisplay pi-chromium-novnc; do
    systemctl --user is-active --quiet "$unit" || die "$unit did not start. Logs: journalctl --user -u $unit"
done

echo
echo "Installed. Watch and use the browser at http://$(hostname):$PORT/"
if [[ -n "$password" ]]; then
    echo "VNC password: $password"
fi
echo "Change the VNC password with: vncpasswd $DIR/vncpasswd"
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
    echo "Note: the services start when you log in. To start them at boot: loginctl enable-linger"
fi
