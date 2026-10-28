"""Vercel's WSGI entrypoint. The Desktop app remains `python -m webapp`."""
from webapp.cloud import create_app

app = create_app()
