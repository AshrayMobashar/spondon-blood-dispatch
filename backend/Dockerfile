# Spondon backend — FastAPI + Beanie (async MongoDB ODM).
# Serves the API on port 1184 (last four digits of student ID 23101184).
FROM python:3.12-slim

# Unbuffered stdout so `docker logs` shows the dispatch/escalation log lines
# as they happen rather than after the buffer flushes.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=1184

WORKDIR /app

# Dependencies first: this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 1184

# Inside a container the DB is a sibling service, not localhost. Compose sets
# this too; the default keeps a bare `docker run --link`/network run working.
ENV MONGODB_URI=mongodb://mongo:27017

# Shell form so $PORT expands at runtime. Render (and most PaaS hosts) assign a
# port dynamically and require the process to bind to it; the 1184 fallback
# keeps `docker compose up` and a bare `docker run` behaving exactly as before.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-1184}"]
