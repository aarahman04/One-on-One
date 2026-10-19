"""Entrypoint: one dual-stack socket on [::]:$PORT.

Railway private networking is IPv6 (newer environments also resolve IPv4), and
asyncio's own "::" bind is IPv6-only, so bind with V6ONLY off ourselves.
"""
import os
import socket

import uvicorn

sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
sock.bind(("::", int(os.environ.get("PORT", "8000"))))
uvicorn.Server(uvicorn.Config("app.main:app", workers=1, access_log=False)).run(sockets=[sock])
