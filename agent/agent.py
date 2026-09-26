import argparse
import base64
import ctypes
import io
import platform
import socket
import sys
import time

import socketio
from mss import mss
from PIL import Image, ImageChops
from pynput.keyboard import Controller as KeyboardController, Key
from pynput.mouse import Button, Controller as MouseController


AGENT_VERSION = "1.2.0"
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
    parser.add_argument("--monitor", type=int, default=1, help="Monitor number to capture. Use 1 for primary.")
    parser.add_argument("--max-width", type=int, default=1600, help="Maximum screen image width in pixels.")
    return parser.parse_args()


args = parse_args()
mouse = MouseController()
keyboard = KeyboardController()
sio = socketio.Client(reconnection=True)
monitor_geometry = None
last_image = None


def print_consent_notice():
    print("")
    print("INTERNAL REMOTE CONTROL AGENT")
    print("This program shares this device's screen and accepts mouse/keyboard commands.")
    print("Run it only on systems you own or where the user has explicitly consented.")
    print(f"Server: {args.server}")
    print(f"Room:   {args.room}")
    print("Press Ctrl+C to stop sharing immediately.")
    print("")


def selected_monitor(sct):
    if args.monitor < 1 or args.monitor >= len(sct.monitors):
        return sct.monitors[1]
    return sct.monitors[args.monitor]


def encode_frame(image, quality):
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=max(10, min(int(quality), 90)))
    data = output.getvalue()
    return {
        "image": base64.b64encode(data).decode("ascii"),
        "mime": "image/jpeg",
        "size": len(data),
    }


def capture_screen(force_full=False, quality=None):
    global last_image, monitor_geometry
    with mss() as sct:
        monitor = selected_monitor(sct)
        monitor_geometry = monitor.copy()
        raw = sct.grab(monitor)
    image = Image.frombytes("RGB", raw.size, raw.rgb)
    if args.max_width > 0 and image.width > args.max_width:
        image.thumbnail((args.max_width, image.height), Image.Resampling.LANCZOS)

    if not force_full and last_image is not None and last_image.size == image.size:
        box = ImageChops.difference(last_image, image).getbbox()
        last_image = image
        if box is None:
            return {"type": "NO_CHANGE", "width": image.width, "height": image.height, "size": 0}
        x1, y1, x2, y2 = box
        frame = encode_frame(image.crop(box), quality or args.quality)
        frame.update({
            "type": "DELTA",
            "width": image.width,
            "height": image.height,
            "region": {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1},
        })
        return frame

    last_image = image
    frame = encode_frame(image, quality or args.quality)
    frame.update({"type": "FULL", "width": image.width, "height": image.height})
    return frame


def key_from_name(name):
    if name in SPECIAL_KEYS:
        return SPECIAL_KEYS[name]
    if len(name) == 1:
        return name
    return None


def accessibility_allowed():
    if sys.platform != "darwin":
        return None
    try:
        framework = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
        )
        framework.AXIsProcessTrusted.restype = ctypes.c_bool
        return bool(framework.AXIsProcessTrusted())
    except OSError:
        return None


def report_control(action, error=None):
    sio.emit("agent:control-result", {
        "roomId": args.room,
        "action": action,
        "error": str(error) if error else None,
    })


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
    allowed = accessibility_allowed()
    if allowed is not None:
        print(f"Accessibility permission: {'granted' if allowed else 'missing'}")
        sio.emit("agent:control-status", {"roomId": args.room, "accessibility": allowed})


@sio.event
def connect_error(data):
    print(f"Connection failed: {data}")


@sio.event
def disconnect():
    print("Disconnected from relay.")


@sio.on("agent:capture-screen")
def on_capture_screen(data):
    try:
        frame = capture_screen(data.get("forceFull", False), data.get("quality", args.quality))
        frame["roomId"] = args.room
        sio.emit("agent:screen", frame)
    except Exception as exc:
        print(f"Screen capture failed: {exc}")


@sio.on("agent:mouse-move")
def on_mouse_move(data):
    global monitor_geometry
    size = data.get("screenSize") or {}
    remote_width = float(size.get("width") or 1)
    remote_height = float(size.get("height") or 1)
    if monitor_geometry is None:
        with mss() as sct:
            monitor_geometry = selected_monitor(sct).copy()
    monitor = monitor_geometry
    x = monitor["left"] + (float(data.get("x", 0)) / remote_width) * monitor["width"]
    y = monitor["top"] + (float(data.get("y", 0)) / remote_height) * monitor["height"]
    mouse.position = (int(x), int(y))


@sio.on("agent:mouse-click")
def on_mouse_click(data):
    try:
        if "x" in data and "y" in data:
            on_mouse_move(data)
        button = Button.right if data.get("button") == "right" else Button.left
        mouse.click(button, 1)
        report_control("mouse click")
    except Exception as exc:
        print(f"Mouse click failed: {exc}")
        report_control("mouse click", exc)


@sio.on("agent:mouse-scroll")
def on_mouse_scroll(data):
    delta = int(float(data.get("deltaY", 0)) / -120)
    mouse.scroll(0, delta)


@sio.on("agent:key")
def on_key(data):
    key = key_from_name(data.get("key", ""))
    if key is None:
        report_control("key", f"Unsupported key: {data.get('key')}")
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

    try:
        for mod in modifiers:
            keyboard.press(mod)
        keyboard.press(key)
        keyboard.release(key)
        report_control("key")
    except Exception as exc:
        print(f"Keyboard input failed: {exc}")
        report_control("key", exc)
    finally:
        for mod in reversed(modifiers):
            try:
                keyboard.release(mod)
            except Exception:
                pass


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
