from __future__ import annotations

import argparse
import logging
import time

from ..core.config import WORKER_CONCURRENCY, MUSIC_WORKER_CONCURRENCY
from .worker import MotionAnalysisWorker, MusicAnalysisWorker, DanceAnalysisWorker, MagicAnalysisWorker


def _build_workers(worker_type: str, count: int, poll_interval: float):
    workers = []
    for _ in range(count):
        if worker_type == "motion":
            worker = MotionAnalysisWorker(poll_interval=poll_interval)
        elif worker_type == "dance":
            worker = DanceAnalysisWorker(poll_interval=poll_interval)
        elif worker_type == "magic":
            worker = MagicAnalysisWorker(poll_interval=poll_interval)
        else:
            worker = MusicAnalysisWorker(poll_interval=poll_interval)
        worker.start()
        workers.append(worker)
    return workers


def main() -> None:
    parser = argparse.ArgumentParser(description="Run analysis workers as standalone processes.")
    parser.add_argument("--type", choices=["motion", "dance", "magic", "music"], required=True, help="Worker type to run.")
    parser.add_argument("--concurrency", type=int, default=None, help="Number of workers to run.")
    parser.add_argument("--poll-interval", type=float, default=2.0, help="Polling interval in seconds.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    if args.type in ("motion", "dance", "magic"):
        default_count = WORKER_CONCURRENCY
    else:
        default_count = MUSIC_WORKER_CONCURRENCY

    count = max(args.concurrency or default_count, 1)
    logging.info("Starting %s workers: count=%s poll_interval=%s", args.type, count, args.poll_interval)

    workers = _build_workers(args.type, count, args.poll_interval)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logging.info("Stopping workers...")
        for worker in workers:
            worker.stop()


if __name__ == "__main__":
    main()
