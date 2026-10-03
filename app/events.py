"""Thread-safe pub/sub bridge from worker threads to WebSocket clients."""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queues: set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._throttle: dict[str, float] = {}

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        with self._lock:
            self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        with self._lock:
            self._queues.discard(q)

    def publish(self, type_: str, data: Any = None, *, throttle_key: str | None = None, interval: float = 0.25) -> None:
        """Send an event to every client. With `throttle_key`, drop events arriving faster than `interval`."""
        if throttle_key:
            now = time.monotonic()
            if now - self._throttle.get(throttle_key, 0) < interval:
                return
            self._throttle[throttle_key] = now
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        msg = {"type": type_, "data": data}
        with self._lock:
            queues = list(self._queues)
        for q in queues:
            loop.call_soon_threadsafe(_put, q, msg)

    def toast(self, message: str, level: str = "info") -> None:
        self.publish("toast", {"message": message, "level": level})


def _put(q: asyncio.Queue, msg: dict) -> None:
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        pass


bus = EventBus()
