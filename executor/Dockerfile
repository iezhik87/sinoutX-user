# Code-execution sandbox. Minimal Python image, runs as a non-root user, no deps.
FROM python:3.12-slim

RUN useradd -m -u 10001 sandbox
WORKDIR /app
COPY server.py /app/server.py
USER sandbox

ENV PORT=8088
EXPOSE 8088
CMD ["python3", "/app/server.py"]
