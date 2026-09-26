import argparse
import base64
import platform
import socket
import sys
import time

import socketio
from mss import mss, tools
from pynput.keyboard import Controller as KeyboardController, Key
from pynput.mouse import Button, Controller as MouseController


SPECIAL_KEYS = {
    "Backspace": Key.backspace,
    "Delete": Key.delete,
    "Enter": Key.enter,
    "Escape": Key.esc,
    "Tab": Key.tab,
    "ArrowUp": Key.up,
    "ArrowDown": Key.down,
    "ArrowLeft": Key.left,
    "ArrowRight": Key.right,
    "Home": Key.home,
    "End": Key.end,
    "PageUp": Key.page_up,
    "PageDown": Key.page_down,
    " ": Key.space,
}


def parse_args():
    parser = argparse.ArgumentParser(description="Visible internal remote-control device agent.")
    parser.add_argument("--server", required=True, help="Relay URL, for example https://remote.example.com")
    parser.add_argument("--room", required=True, help="Room ID shown to the controller.")
    parser.add_argument("--token", required=True, help="Shared ACCESS_TOKEN configured on the relay.")
    parser.add_argument("--quality", type=int, default=45, help="Default JPEG quality, 10-90.")
    return parser.parse_args()


args = parse_args()
mouse = MouseController()
keyboard = KeyboardController()
sio = socketio.Client(reconnection=True)


def print_consent_notice():
    print("")
    print("INTERNAL REMOTE CONTROL AGENT")
    print("This program shares this device's screen and accepts mouse/keyboard commands.")
    print("Run it only on systems you own or where the user has explicitly consented.")
    print(f"Server: {args.server}")
    print(f"Room:   {args.room}")
    print("Press Ctrl+C to stop sharing immediately.")
    print("")


def capture_screen(quality):
    with mss() as sct:
        monitor = sct.monitors[1]
        raw = sct.grab(monitor)
        data = tools.to_png(raw.rgb, raw.size)
    return {
        "image": base64.b64encode(data).decode("ascii"),
        "mime": "image/png",
        "width": raw.width,
        "height": raw.height,
        "size": len(data),
    }


def key_from_name(name):
    if name in SPECIAL_KEYS:
        return SPECIAL_KEYS[name]
    if len(name) == 1:
        return name
    return None


@sio.event
def connect():
    print("Connected to relay.")
    sio.emit("agent:join", {
        "roomId": args.room,
        "device": {
            "host": socket.gethostname(),
            "platform": platform.platform(),
            "python": sys.version.split()[0],
        },
    })


@sio.event
def connect_error(data):
    print(f"Connection failed: {data}")


@sio.event
def disconnect():
    print("Disconnected from relay.")


@sio.on("agent:capture-screen")
def on_capture_screen(data):
    try:
        frame = capture_screen(data.get("quality", args.quality))
        frame["roomId"] = args.room
        sio.emit("agent:screen", frame)
    except Exception as exc:
        print(f"Screen capture failed: {exc}")


@sio.on("agent:mouse-move")
def on_mouse_move(data):
    size = data.get("screenSize") or {}
    remote_width = float(size.get("width") or 1)
    remote_height = float(size.get("height") or 1)
    with mss() as sct:
        monitor = sct.monitors[1]
    x = monitor["left"] + (float(data.get("x", 0)) / remote_width) * monitor["width"]
    y = monitor["top"] + (float(data.get("y", 0)) / remote_height) * monitor["height"]
    mouse.position = (int(x), int(y))


@sio.on("agent:mouse-click")
def on_mouse_click(data):
    button = Button.right if data.get("button") == "right" else Button.left
    mouse.click(button, 1)


@sio.on("agent:mouse-scroll")
def on_mouse_scroll(data):
    delta = int(float(data.get("deltaY", 0)) / -120)
    mouse.scroll(0, delta)


@sio.on("agent:key")
def on_key(data):
    key = key_from_name(data.get("key", ""))
    if key is None:
        return

    modifiers = []
    if data.get("ctrlKey"):
        modifiers.append(Key.ctrl)
    if data.get("altKey"):
        modifiers.append(Key.alt)
    if data.get("shiftKey"):
        modifiers.append(Key.shift)
    if data.get("metaKey"):
        modifiers.append(Key.cmd)

    for mod in modifiers:
        keyboard.press(mod)
    keyboard.press(key)
    keyboard.release(key)
    for mod in reversed(modifiers):
        keyboard.release(mod)


def main():
    print_consent_notice()
    sio.connect(args.server, auth={"token": args.token}, transports=["websocket", "polling"])
    while True:
        time.sleep(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped by user.")
        sio.disconnect()
