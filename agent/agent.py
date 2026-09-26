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
AGENT_VERSION = "1.1.0"
last_rgb = None
last_size = None


def print_consent_notice():
    print("")
    print("INTERNAL REMOTE CONTROL AGENT")
    print("This program shares this device's screen and accepts mouse/keyboard commands.")
    print("Run it only on systems you own or where the user has explicitly consented.")
    print(f"Server: {args.server}")
    print(f"Room:   {args.room}")
    print("Press Ctrl+C to stop sharing immediately.")
    print("")


def changed_region(previous, current, width, height):
    min_x = width
    min_y = height
    max_x = -1
    max_y = -1
    stride = width * 3

    for y in range(height):
        row_start = y * stride
        previous_row = previous[row_start:row_start + stride]
        current_row = current[row_start:row_start + stride]
        if previous_row == current_row:
            continue

        for x in range(width):
            index = x * 3
            if previous_row[index:index + 3] != current_row[index:index + 3]:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
        min_y = min(min_y, y)
        max_y = max(max_y, y)

    if max_x < 0:
        return None
    return {"x": min_x, "y": min_y, "width": max_x - min_x + 1, "height": max_y - min_y + 1}


def crop_rgb(rgb, width, region):
    stride = width * 3
    crop_stride = region["width"] * 3
    rows = []
    for y in range(region["y"], region["y"] + region["height"]):
        start = y * stride + region["x"] * 3
        rows.append(rgb[start:start + crop_stride])
    return b"".join(rows)


def capture_screen(force_full=False):
    global last_rgb, last_size
    with mss() as sct:
        monitor = sct.monitors[1]
        raw = sct.grab(monitor)
        current_rgb = raw.rgb
        current_size = raw.size

    if not force_full and last_rgb is not None and last_size == current_size:
        region = changed_region(last_rgb, current_rgb, raw.width, raw.height)
        last_rgb = current_rgb
        if region is None:
            return {
                "type": "NO_CHANGE",
                "mime": "image/png",
                "width": raw.width,
                "height": raw.height,
                "size": 0,
            }

        cropped = crop_rgb(current_rgb, raw.width, region)
        data = tools.to_png(cropped, (region["width"], region["height"]))
        return {
            "type": "DELTA",
            "image": base64.b64encode(data).decode("ascii"),
            "mime": "image/png",
            "width": raw.width,
            "height": raw.height,
            "size": len(data),
            "region": region,
        }

    data = tools.to_png(current_rgb, current_size)
    last_rgb = current_rgb
    last_size = current_size
    return {
        "type": "FULL",
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
            "version": AGENT_VERSION,
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
        frame = capture_screen(data.get("forceFull", False))
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
