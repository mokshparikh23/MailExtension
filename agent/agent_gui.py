import base64
import io
import json
import os
import platform
import socket
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk

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
    "PageDown": Key.down,
    " ": Key.space,
}


class RemoteAgentApp:
    def __init__(self, root, startup_config=None):
        self.root = root
        self.root.title("netrem - Remote Control")
        self.root.geometry("420x520")
        self.root.resizable(False, False)

        self.sio = None
        self.connecting = False
        self.keep_connecting = False
        self.room_id = ""
        self.last_image = None
        self.mouse = MouseController()
        self.keyboard = KeyboardController()

        startup_config = startup_config or {}
        self.server_var = tk.StringVar(value=startup_config.get("server", "http://localhost:3000"))
        self.room_var = tk.StringVar(value=startup_config.get("room", "test123"))
        self.token_var = tk.StringVar(value=os.environ.pop("RDP_AGENT_TOKEN", ""))
        self.monitor_var = tk.StringVar(value=str(startup_config.get("monitor", 1)))
        self.status_var = tk.StringVar(value="Disconnected")
        self.room_status_var = tk.StringVar(value="Not connected")
        self.device_var = tk.StringVar(value=f"Device: {socket.gethostname()}")

        self.build_ui()

    def build_ui(self):
        self.root.configure(bg="#f4f7fb")
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background="#f4f7fb")
        style.configure("Card.TFrame", background="#ffffff", relief="flat")
        style.configure("TLabel", background="#f4f7fb", foreground="#263243", font=("Arial", 11))
        style.configure("Muted.TLabel", background="#f4f7fb", foreground="#6b7788", font=("Arial", 9))
        style.configure("Title.TLabel", background="#f4f7fb", foreground="#1665c1", font=("Arial", 24, "bold"))
        style.configure("Version.TLabel", background="#f4f7fb", foreground="#9aa5b5", font=("Arial", 9, "bold"))
        style.configure("Status.TLabel", background="#ffffff", foreground="#23996b", font=("Arial", 12, "bold"))
        style.configure("TButton", font=("Arial", 12, "bold"), padding=10)
        style.configure("TEntry", fieldbackground="#ffffff", foreground="#111827", padding=8)

        frame = ttk.Frame(self.root, padding=22)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="netrem", style="Title.TLabel").pack(anchor="center")
        ttk.Label(frame, text=f"v{AGENT_VERSION}", style="Version.TLabel").pack(anchor="center", pady=(2, 18))

        status_card = ttk.Frame(frame, style="Card.TFrame", padding=16)
        status_card.pack(fill="x", pady=(0, 16))
        ttk.Label(status_card, textvariable=self.room_status_var, style="Status.TLabel").pack(anchor="center")
        ttk.Label(status_card, textvariable=self.device_var, style="Muted.TLabel").pack(anchor="center", pady=(6, 0))

        self.add_field(frame, "Server URL", self.server_var)
        self.add_field(frame, "Room ID", self.room_var)
        self.add_field(frame, "Access Token", self.token_var, show="*")
        self.add_field(frame, "Monitor number", self.monitor_var)

        actions = ttk.Frame(frame)
        actions.pack(fill="x", pady=(14, 18))
        ttk.Button(actions, text="Connect", command=self.connect).pack(side="left", fill="x", expand=True)
        ttk.Button(actions, text="Disconnect", command=self.disconnect).pack(side="left", padx=(10, 0), fill="x", expand=True)

        ttk.Label(frame, textvariable=self.status_var, style="Muted.TLabel").pack(anchor="center")

        notice = (
            "Visible lab agent: shares this device screen and accepts remote input commands for authorized testing."
        )
        ttk.Label(frame, text=notice, style="Muted.TLabel", wraplength=360, justify="center").pack(anchor="center", pady=(14, 0))

    def add_field(self, parent, label, variable, show=None):
        ttk.Label(parent, text=label).pack(anchor="w", pady=(0, 6))
        entry = ttk.Entry(parent, textvariable=variable, show=show)
        entry.pack(fill="x", pady=(0, 12))
        return entry

    def set_status(self, text):
        self.root.after(0, self.status_var.set, text)

    def set_room_status(self, text):
        self.root.after(0, self.room_status_var.set, text)

    def connect(self):
        if self.connecting or (self.sio and self.sio.connected):
            messagebox.showinfo("Already running", "The agent is connecting or already connected.")
            return

        server = self.server_var.get().strip()
        self.room_id = self.room_var.get().strip()
        token = self.token_var.get().strip()
        self.last_image = None

        if not server or not self.room_id or not token or not self.monitor_var.get().strip():
            messagebox.showerror("Missing fields", "Server URL, Room ID, Access Token, and Monitor number are required.")
            return

        self.set_status("Connecting...")
        self.set_room_status("Connecting...")
        self.keep_connecting = True
        self.connecting = True
        thread = threading.Thread(target=self.connect_worker, args=(server, token), daemon=True)
        thread.start()

    def connect_worker(self, server, token):
        try:
            while self.keep_connecting:
                self.sio = socketio.Client(reconnection=True)
                self.register_socket_handlers()
                try:
                    self.sio.connect(server, auth={"token": token}, transports=["websocket", "polling"])
                    self.sio.wait()
                except Exception as exc:
                    self.set_status(f"Connection failed: {exc}. Retrying...")
                    self.set_room_status("Waiting for relay")
                finally:
                    self.sio.disconnect()

                for _ in range(10):
                    if not self.keep_connecting:
                        break
                    time.sleep(1)
        finally:
            self.connecting = False

    def disconnect(self):
        self.keep_connecting = False
        if self.sio:
            self.sio.disconnect()
        self.set_status("Disconnected")
        self.set_room_status("Not connected")

    def register_socket_handlers(self):
        @self.sio.event
        def connect():
            self.set_status(f"Connected to room {self.room_id}")
            self.set_room_status(f"Connected to room\n{self.room_id}")
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
            if self.keep_connecting:
                self.set_status("Reconnecting...")
                self.set_room_status("Reconnecting...")
            else:
                self.set_status("Disconnected")
                self.set_room_status("Not connected")

        @self.sio.event
        def connect_error(data):
            self.set_status(f"Connection error: {data}")

        @self.sio.on("agent:capture-screen")
        def on_capture_screen(data):
            try:
                frame = self.capture_screen(data.get("forceFull", False), data.get("quality", 45))
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
                monitor = self.selected_monitor(sct)
            x = monitor["left"] + (float(data.get("x", 0)) / remote_width) * monitor["width"]
            y = monitor["top"] + (float(data.get("y", 0)) / remote_height) * monitor["height"]
            self.mouse.position = (int(x), int(y))

        @self.sio.on("agent:mouse-click")
        def on_mouse_click(data):
            if "x" in data and "y" in data:
                on_mouse_move(data)
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

    def encode_frame(self, image, quality):
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=max(10, min(int(quality), 90)))
        data = output.getvalue()
        return {"image": base64.b64encode(data).decode("ascii"), "mime": "image/jpeg", "size": len(data)}

    def capture_screen(self, force_full=False, quality=45):
        with mss() as sct:
            monitor = self.selected_monitor(sct)
            raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
        if image.width > 1600:
            image.thumbnail((1600, image.height), Image.Resampling.LANCZOS)

        if not force_full and self.last_image is not None and self.last_image.size == image.size:
            box = ImageChops.difference(self.last_image, image).getbbox()
            self.last_image = image
            if box is None:
                return {"type": "NO_CHANGE", "width": image.width, "height": image.height, "size": 0}
            x1, y1, x2, y2 = box
            frame = self.encode_frame(image.crop(box), quality)
            frame.update({
                "type": "DELTA", "width": image.width, "height": image.height,
                "region": {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1},
            })
            return frame

        self.last_image = image
        frame = self.encode_frame(image, quality)
        frame.update({"type": "FULL", "width": image.width, "height": image.height})
        return frame

    def selected_monitor(self, sct):
        try:
            index = int(self.monitor_var.get().strip())
        except ValueError:
            index = 1
        if index < 1 or index >= len(sct.monitors):
            index = 1
        return sct.monitors[index]

    def key_from_name(self, name):
        if name in SPECIAL_KEYS:
            return SPECIAL_KEYS[name]
        if len(name) == 1:
            return name
        return None


if __name__ == "__main__":
    auto_connect = "--autoconnect" in sys.argv
    config = {}
    if auto_connect:
        config_file = Path(os.environ["APPDATA"]) / "RDPAgent" / "config.json"
        try:
            config = json.loads(config_file.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise SystemExit(f"Could not read auto-start settings: {exc}") from exc

    root = tk.Tk()
    app = RemoteAgentApp(root, config)
    if auto_connect:
        root.after(500, app.connect)
    root.mainloop()
