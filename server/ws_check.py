#!/usr/bin/env python3
"""Minimal, dependency-free WebSocket smoke test for the Jodoo sync server.

Connects to a ws:// or wss:// URL, performs the RFC 6455 handshake by hand,
and expects the server to immediately push a JSON {"type":"snapshot",...}
message per the /ws/{key} protocol. Exits 0 if one arrives, non-zero
otherwise. Uses only the standard library so live_test.sh has no extra pip
dependencies to install on whatever machine it's run from.
"""
import base64
import json
import os
import socket
import ssl
import struct
import sys
from urllib.parse import urlsplit


class BufferedSocket:
    """Wraps a socket so leftover bytes read past the HTTP handshake headers
    can be handed back to the WebSocket frame parser instead of being lost.
    """

    def __init__(self, sock, initial=b""):
        self.sock = sock
        self.buf = initial

    def recv(self, n):
        if self.buf:
            chunk, self.buf = self.buf[:n], self.buf[n:]
            if len(chunk) < n:
                chunk += self.sock.recv(n - len(chunk))
            return chunk
        return self.sock.recv(n)


def recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("socket closed early")
        data += chunk
    return data


def read_frame(sock):
    header = recv_exact(sock, 2)
    b1, b2 = header[0], header[1]
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(sock, 8))[0]
    mask_key = recv_exact(sock, 4) if masked else b""
    payload = recv_exact(sock, length) if length else b""
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def main():
    if len(sys.argv) != 2:
        print("usage: ws_check.py <ws-url>", file=sys.stderr)
        return 2

    url = urlsplit(sys.argv[1])
    host = url.hostname
    port = url.port or (443 if url.scheme == "wss" else 80)
    path = url.path + ("?" + url.query if url.query else "")

    raw = socket.create_connection((host, port), timeout=10)
    if url.scheme == "wss":
        sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host)
    else:
        sock = raw

    ws_key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {ws_key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    sock.sendall(request.encode())

    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(4096)
        if not chunk:
            print("connection closed during handshake", file=sys.stderr)
            return 1
        resp += chunk
    head, _, leftover = resp.partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode(errors="replace")
    if " 101 " not in status_line:
        print(f"handshake failed: {status_line}", file=sys.stderr)
        return 1

    buffered = BufferedSocket(sock, leftover)
    sock.settimeout(10)
    opcode, payload = read_frame(buffered)
    if opcode != 0x1:  # text frame
        print(f"unexpected opcode: {opcode}", file=sys.stderr)
        return 1

    try:
        msg = json.loads(payload.decode())
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        print(f"non-JSON payload: {e}", file=sys.stderr)
        return 1

    if msg.get("type") != "snapshot":
        print(f"unexpected message type: {msg.get('type')!r}", file=sys.stderr)
        return 1

    print(f"received snapshot: version={msg.get('version')} name={msg.get('name')!r}")

    # Best-effort close handshake; ignore failures since the check already passed.
    try:
        sock.sendall(bytes([0x88, 0x80]) + os.urandom(4))
    except OSError:
        pass
    sock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
