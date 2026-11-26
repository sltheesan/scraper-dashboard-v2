#!/bin/bash
set -e

# Start virtual framebuffer
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1
export DISPLAY=:99

# Start VNC server on the virtual display (localhost only — noVNC connects to it)
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -listen 127.0.0.1 -q &

# Start noVNC web client (websockify proxies WebSocket → VNC)
websockify --web /usr/share/novnc 6080 localhost:5900 > /dev/null 2>&1 &

# Start the application
exec node dist/main.js
