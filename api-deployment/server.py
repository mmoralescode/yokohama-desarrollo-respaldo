"""Vercel entrypoint. Package only application code, catalogs and policy."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
from app.main import app  # noqa: E402,F401
