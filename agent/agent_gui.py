import base64
import platform
import socket
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk

import socketio
from mss import mss, tools
from pynput.keyboard import Controller as KeyboardController, Key
from pynput.mouse import Button, Controller as MouseController


AGENT_VERSION = "1.1.0"

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
    "PageDown": Key.down,
    " ": Key.space,
}


class RemoteAgentApp:
    def __init__(self, root):
        self.root = root
        self.root.title("RDP Agent - Remote Control")
        self.root.geometry("460x440")
        self.root.resizable(False, False)

        self.sio = None
        self.room_id = ""
        self.last_rgb = None
        self.last_size = None
        self.mouse = MouseController()
        self.keyboard = KeyboardController()

        self.server_var = tk.StringVar(value="http://localhost:3000")
        self.room_var = tk.StringVar(value="test123")
        self.token_var = tk.StringVar(value="test-secret-123")
        self.status_var = tk.StringVar(value="Disconnected")

        self.build_ui()

    def build_ui(self):
        self.root.configure(bg="#0b111a")
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background="#0b111a")
        style.configure("Card.TFrame", background="#111827", relief="flat")
        style.configure("TLabel", background="#0b111a", foreground="#dbe7f6", font=("Arial", 12))
        style.configure("Muted.TLabel", background="#0b111a", foreground="#8fa0b7", font=("Arial", 10))
        style.configure("Title.TLabel", background="#0b111a", foreground="#f8fafc", font=("Arial", 22, "bold"))
        style.configure("Status.TLabel", background="#111827", foreground="#67e8f9", font=("Arial", 12, "bold"))
        style.configure("TButton", font=("Arial", 12, "bold"), padding=10)
        style.configure("TEntry", fieldbackground="#070b12", foreground="#f8fafc", padding=8)

        frame = ttk.Frame(self.root, padding=24)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="RDP Agent", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text="Visible paired-device client for internal lab testing.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(4, 22))

        self.add_field(frame, "Server URL", self.server_var)
        self.add_field(frame, "Room ID", self.room_var)
        self.add_field(frame, "Access Token", self.token_var, show="*")

        actions = ttk.Frame(frame)
        actions.pack(fill="x", pady=(14, 18))
        ttk.Button(actions, text="Connect", command=self.connect).pack(side="left", fill="x", expand=True)
        ttk.Button(actions, text="Disconnect", command=self.disconnect).pack(side="left", padx=(10, 0), fill="x", expand=True)

        status_card = ttk.Frame(frame, style="Card.TFrame", padding=16)
        status_card.pack(fill="x")
        ttk.Label(status_card, textvariable=self.status_var, style="Status.TLabel").pack(anchor="center")

        notice = (
            "This agent shares this device screen and accepts remote input commands. "
            "Use only on devices you own or where the user has explicitly consented."
        )
        ttk.Label(frame, text=notice, style="Muted.TLabel", wraplength=400).pack(anchor="w", pady=(18, 0))

    def add_field(self, parent, label, variable, show=None):
        ttk.Label(parent, text=label).pack(anchor="w", pady=(0, 6))
        entry = ttk.Entry(parent, textvariable=variable, show=show)
        entry.pack(fill="x", pady=(0, 12))
        return entry

    def set_status(self, text):
        self.root.after(0, self.status_var.set, text)

    def connect(self):
        if self.sio and self.sio.connected:
            messagebox.showinfo("Already connected", "Agent is already connected.")
            return

        server = self.server_var.get().strip()
        self.room_id = self.room_var.get().strip()
        token = self.token_var.get().strip()

        if not server or not self.room_id or not token:
            messagebox.showerror("Missing fields", "Server URL, Room ID, and Access Token are required.")
            return

        self.set_status("Connecting...")
        thread = threading.Thread(target=self.connect_worker, args=(server, token), daemon=True)
        thread.start()

    def connect_worker(self, server, token):
        self.sio = socketio.Client(reconnection=True)
        self.register_socket_handlers()
        try:
            self.sio.connect(server, auth={"token": token}, transports=["websocket", "polling"])
            self.sio.wait()
        except Exception as exc:
            self.set_status(f"Connection failed: {exc}")

    def disconnect(self):
        if self.sio:
            self.sio.disconnect()
        self.set_status("Disconnected")

    def register_socket_handlers(self):
        @self.sio.event
        def connect():
            self.set_status(f"Connected to room {self.room_id}")
            self.sio.emit("agent:join", {
                "roomId": self.room_id,
                "device": {
                    "host": socket.gethostname(),
                    "platform": platform.platform(),
                    "python": sys.version.split()[0],
                    "client": "RDP Agent GUI",
                    "version": AGENT_VERSION,
                },
            })

        @self.sio.event
        def disconnect():
            self.set_status("Disconnected")

        @self.sio.event
        def connect_error(data):
            self.set_status(f"Connection error: {data}")

        @self.sio.on("agent:capture-screen")
        def on_capture_screen(data):
            try:
                frame = self.capture_screen(data.get("forceFull", False))
                frame["roomId"] = self.room_id
                self.sio.emit("agent:screen", frame)
            except Exception as exc:
                self.set_status(f"Screen capture failed: {exc}")

        @self.sio.on("agent:mouse-move")
        def on_mouse_move(data):
            size = data.get("screenSize") or {}
            remote_width = float(size.get("width") or 1)
            remote_height = float(size.get("height") or 1)
            with mss() as sct:
                monitor = sct.monitors[1]
            x = monitor["left"] + (float(data.get("x", 0)) / remote_width) * monitor["width"]
            y = monitor["top"] + (float(data.get("y", 0)) / remote_height) * monitor["height"]
            self.mouse.position = (int(x), int(y))

        @self.sio.on("agent:mouse-click")
        def on_mouse_click(data):
            button = Button.right if data.get("button") == "right" else Button.left
            self.mouse.click(button, 1)

        @self.sio.on("agent:mouse-scroll")
        def on_mouse_scroll(data):
            delta = int(float(data.get("deltaY", 0)) / -120)
            self.mouse.scroll(0, delta)

        @self.sio.on("agent:key")
        def on_key(data):
            key = self.key_from_name(data.get("key", ""))
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
                self.keyboard.press(mod)
            self.keyboard.press(key)
            self.keyboard.release(key)
            for mod in reversed(modifiers):
                self.keyboard.release(mod)

    def changed_region(self, previous, current, width, height):
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

    def crop_rgb(self, rgb, width, region):
        stride = width * 3
        crop_stride = region["width"] * 3
        rows = []
        for y in range(region["y"], region["y"] + region["height"]):
            start = y * stride + region["x"] * 3
            rows.append(rgb[start:start + crop_stride])
        return b"".join(rows)

    def capture_screen(self, force_full=False):
        with mss() as sct:
            monitor = sct.monitors[1]
            raw = sct.grab(monitor)
            current_rgb = raw.rgb
            current_size = raw.size

        if not force_full and self.last_rgb is not None and self.last_size == current_size:
            region = self.changed_region(self.last_rgb, current_rgb, raw.width, raw.height)
            self.last_rgb = current_rgb
            if region is None:
                return {
                    "type": "NO_CHANGE",
                    "mime": "image/png",
                    "width": raw.width,
                    "height": raw.height,
                    "size": 0,
                }

            cropped = self.crop_rgb(current_rgb, raw.width, region)
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
        self.last_rgb = current_rgb
        self.last_size = current_size
        return {
            "type": "FULL",
            "image": base64.b64encode(data).decode("ascii"),
            "mime": "image/png",
            "width": raw.width,
            "height": raw.height,
            "size": len(data),
        }

    def key_from_name(self, name):
        if name in SPECIAL_KEYS:
            return SPECIAL_KEYS[name]
        if len(name) == 1:
            return name
        return None


if __name__ == "__main__":
    root = tk.Tk()
    app = RemoteAgentApp(root)
    root.mainloop()
