"""Windows lab window for observing capture protection in the RDP viewer.

Run this file on the Windows device whose screen is being shared. It changes the
display affinity of this process's own top-level window only.
"""

import ctypes
import sys
import tkinter as tk
from ctypes import wintypes
from tkinter import ttk


WDA_NONE = 0x00000000
WDA_EXCLUDEFROMCAPTURE = 0x00000011
GA_ROOT = 2


class CaptureProtectionDemo:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Capture protection demo")
        self.root.geometry("560x350")
        self.root.minsize(480, 310)

        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.GetAncestor.argtypes = (wintypes.HWND, wintypes.UINT)
        self.user32.GetAncestor.restype = wintypes.HWND
        self.user32.SetWindowDisplayAffinity.argtypes = (
            wintypes.HWND,
            wintypes.DWORD,
        )
        self.user32.SetWindowDisplayAffinity.restype = wintypes.BOOL

        frame = ttk.Frame(root, padding=24)
        frame.pack(fill="both", expand=True)

        ttk.Label(
            frame,
            text="Capture protection demo",
            font=("Segoe UI", 19, "bold"),
        ).pack(anchor="w")
        ttk.Label(
            frame,
            text="This window belongs to the demo app on your Windows device.",
            wraplength=500,
        ).pack(anchor="w", pady=(8, 18))

        sample = tk.Frame(frame, bg="#2563eb", height=90)
        sample.pack(fill="x")
        sample.pack_propagate(False)
        tk.Label(
            sample,
            text="VISIBLE TEST CONTENT",
            bg="#2563eb",
            fg="white",
            font=("Segoe UI", 16, "bold"),
        ).pack(expand=True)

        buttons = ttk.Frame(frame)
        buttons.pack(anchor="w", pady=(20, 14))
        ttk.Button(
            buttons,
            text="Allow capture",
            command=lambda: self.set_affinity(WDA_NONE),
        ).pack(side="left", padx=(0, 10))
        ttk.Button(
            buttons,
            text="Exclude from capture",
            command=lambda: self.set_affinity(WDA_EXCLUDEFROMCAPTURE),
        ).pack(side="left")

        self.status = tk.StringVar(value="Starting…")
        ttk.Label(frame, textvariable=self.status, wraplength=500).pack(anchor="w")
        ttk.Label(
            frame,
            text="Compare this window on the Windows display and in the remote viewer.",
            wraplength=500,
        ).pack(anchor="w", pady=(12, 0))

        # Tk must create its native window before SetWindowDisplayAffinity runs.
        root.after(0, lambda: self.set_affinity(WDA_NONE))

    def set_affinity(self, affinity: int) -> None:
        # Tk can return a child HWND; the API requires our top-level window.
        hwnd = self.user32.GetAncestor(self.root.winfo_id(), GA_ROOT)
        if not hwnd:
            self.status.set("Could not find the demo window's top-level handle.")
            return

        ctypes.set_last_error(0)
        if not self.user32.SetWindowDisplayAffinity(hwnd, affinity):
            error = ctypes.get_last_error()
            self.status.set(
                f"Windows could not change capture protection "
                f"(error {error}: {ctypes.FormatError(error).strip()})."
            )
            return

        if affinity == WDA_NONE:
            self.status.set("Capture allowed: this window should appear in the viewer.")
        else:
            self.status.set(
                "Excluded from capture: this window may disappear or appear blank "
                "in the viewer. Click 'Allow capture' here on Windows to restore it."
            )


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("This demo runs on Windows only.")

    root = tk.Tk()
    CaptureProtectionDemo(root)
    root.mainloop()


if __name__ == "__main__":
    main()
