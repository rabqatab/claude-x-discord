#!/usr/bin/env python3
"""
PTY bridge for `claude remote-control`.

The remote-control TUI (Ink/React) suppresses output when stdout is not a TTY.
This script allocates a PTY so the TUI renders, then relays stdout to the
parent Node.js process (which reads it as a pipe).

Unlike claude-bridge.py this is simpler: no stdin relay needed (RC is
controlled from the web UI, not stdin), and the process is long-lived.
"""

import argparse
import os
import pty
import signal
import subprocess
import sys
import threading


def log(msg):
    sys.stderr.write(f"[rc-bridge] {msg}\n")
    sys.stderr.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--bin", default=None, help="Path to claude binary")
    args = parser.parse_args()

    exe = args.bin or os.environ.get("CLAUDE_BIN", "claude")
    cmd = [exe, "remote-control", "--name", args.name]

    env = {k: v for k, v in os.environ.items()
           if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}

    os.chdir(args.cwd)
    log(f"cwd={os.getcwd()} cmd={cmd}")

    master_fd, slave_fd = pty.openpty()

    proc = subprocess.Popen(
        cmd,
        cwd=args.cwd,
        stdout=slave_fd,
        stderr=subprocess.PIPE,
        stdin=slave_fd,
        env=env,
    )
    os.close(slave_fd)

    log(f"spawned pid={proc.pid}")

    def handle_signal(sig, frame):
        proc.terminate()
        try:
            os.close(master_fd)
        except OSError:
            pass
        os._exit(0)
    signal.signal(signal.SIGTERM, handle_signal)

    def read_stderr():
        try:
            for line in proc.stderr:
                log(f"stderr: {line.decode().strip()[:200]}")
        except:
            pass

    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()

    # Relay PTY master → stdout (pipe to Node.js)
    def read_master():
        try:
            while True:
                data = os.read(master_fd, 4096)
                if not data:
                    break
                os.write(1, data)
        except OSError:
            pass

    stdout_thread = threading.Thread(target=read_master, daemon=True)
    stdout_thread.start()

    proc.wait()
    stdout_thread.join(timeout=2.0)

    try:
        os.close(master_fd)
    except OSError:
        pass

    os._exit(proc.returncode or 0)


if __name__ == "__main__":
    main()
