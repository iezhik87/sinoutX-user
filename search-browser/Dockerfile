# Dedicated public-search renderer; no lab sessions or user login state.
FROM mcr.microsoft.com/playwright/python:v1.64.1-noble
WORKDIR /app
RUN python3 -m pip install --no-cache-dir playwright==1.64.1
COPY server.py /app/server.py
USER pwuser
ENV PORT=8090
EXPOSE 8090
CMD ["python3", "/app/server.py"]
