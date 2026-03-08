#!/usr/bin/env python3
"""
Bridge script: spawns an AI CLI and streams output to stdout.
Node.js cannot pipe certain CLI tools' stdout directly, but Python can.

Supports: claude, gemini, codex
"""

import argparse
import os
import pty
import subprocess
import sys
import signal
import threading


def log(msg):
    sys.stderr.write(f"[bridge] {msg}\n")
    sys.stderr.flush()


def build_command(cli, prompt, cwd, bin_path=None, session=None):
    """Build the CLI command based on the AI tool."""
    if cli == "claude":
        exe = bin_path or os.environ.get("CLAUDE_BIN", "claude")
        cmd = [exe, "-p", prompt, "--output-format", "stream-json", "--verbose"]
        if session:
            cmd.extend(["--resume", session])
        return cmd

    elif cli == "gemini":
        exe = bin_path or os.environ.get("GEMINI_BIN", "gemini")
        cmd = [exe, "-p", prompt, "--output-format", "json", "--yolo"]
        return cmd

    elif cli == "codex":
        exe = bin_path or os.environ.get("CODEX_BIN", "codex")
        model = os.environ.get("CODEX_MODEL", "gpt-5.2-codex")
        cmd = [exe, "exec", "--json", "--model", model, "--cd", cwd, "--full-auto", "--skip-git-repo-check", prompt]
        return cmd

    else:
        raise ValueError(f"Unknown CLI: {cli}")


def build_env(cli):
    """Build environment, removing vars that cause nested session errors."""
    env = {k: v for k, v in os.environ.items()
           if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
    if cli == "claude":
        env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
    # Node.js-based CLIs (gemini, codex) use #!/usr/bin/env node shebang.
    # Prepend the CLI binary's directory to PATH so `env node` resolves to
    # the same Node.js version the CLI was installed with (e.g. NVM v22).
    bin_key = {"gemini": "GEMINI_BIN", "codex": "CODEX_BIN"}.get(cli)
    if bin_key:
        bin_path = env.get(bin_key, "")
        if bin_path:
            node_dir = os.path.dirname(bin_path)
            if node_dir:
                env["PATH"] = node_dir + ":" + env.get("PATH", "")
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cli", required=True, choices=["claude", "gemini", "codex"])
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--session", default=None)
    parser.add_argument("--bin", default=None, help="Path to CLI binary")
    args = parser.parse_args()

    # Change THIS process's cwd to the project directory BEFORE spawning
    # This ensures CLI tools that check parent cwd get the right directory
    os.chdir(args.cwd)
    log(f"chdir to {os.getcwd()}")

    cmd = build_command(args.cli, args.prompt, args.cwd, args.bin, args.session)
    env = build_env(args.cli)

    log(f"cli={args.cli} cwd={args.cwd}")
    log(f"cmd: {cmd[:5]}...")

    # Claude CLI hangs when stdin is an open pipe (checks isTTY and waits
    # for input).  Use a PTY so it sees isTTY=true and proceeds with -p.
    # Other CLIs (gemini, codex) don't need this — use DEVNULL for them.
    master_fd = None
    if args.cli == "claude":
        master_fd, slave_fd = pty.openpty()
        stdin_arg = slave_fd
    else:
        stdin_arg = subprocess.DEVNULL

    proc = subprocess.Popen(
        cmd,
        cwd=args.cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=stdin_arg,
        env=env,
    )
    if args.cli == "claude":
        os.close(slave_fd)  # parent doesn't need the slave end

    log(f"spawned pid={proc.pid}")

    def handle_signal(sig, frame):
        proc.terminate()
        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass
        # os._exit() terminates immediately — no need to close stdin
        # (closing stdin deadlocks when relay_stdin thread holds the buffer lock)
        os._exit(0)
    signal.signal(signal.SIGTERM, handle_signal)

    # Relay stdin from parent (Node.js) → PTY master → Claude CLI (approve/deny)
    if master_fd is not None:
        def relay_stdin():
            try:
                for line in sys.stdin.buffer:
                    try:
                        os.write(master_fd, line)
                        log(f"stdin relay: {line.decode().strip()[:50]}")
                    except OSError:
                        break
            except (BrokenPipeError, OSError):
                pass

        stdin_thread = threading.Thread(target=relay_stdin, daemon=True)
        stdin_thread.start()

    # Read stderr in a thread
    def read_stderr():
        try:
            for line in proc.stderr:
                log(f"stderr: {line.decode().strip()[:200]}")
        except:
            pass

    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()

    # Stream stdout in a daemon thread.
    # Claude CLI may spawn child processes (agent teams, MCP servers) that
    # inherit the stdout pipe.  When Claude exits but children linger, the
    # pipe never gets EOF and a blocking read would hang forever.
    # By reading in a daemon thread we can detect process exit via wait()
    # and force-exit the bridge even if the pipe is still held open.
    def read_stdout():
        try:
            for line in proc.stdout:
                os.write(1, line)
        except (BrokenPipeError, OSError):
            pass

    stdout_thread = threading.Thread(target=read_stdout, daemon=True)
    stdout_thread.start()

    # Wait for the main CLI process to exit
    proc.wait()
    # Give stdout a moment to drain any final data
    stdout_thread.join(timeout=2.0)

    if master_fd is not None:
        try:
            os.close(master_fd)
        except OSError:
            pass

    # os._exit() terminates immediately without Python cleanup — daemon
    # threads and their buffer locks are irrelevant.  Do NOT call
    # sys.stdin.close() here: the relay_stdin thread holds the
    # BufferedReader lock, so close() deadlocks waiting for it.
    os._exit(proc.returncode or 0)


if __name__ == "__main__":
    main()
