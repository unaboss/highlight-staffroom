# Classroom Fast Track (CFT): one image, two stages.
# 1) node builds the React app into web/dist
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) python serves the API, the React build and the static apps
FROM python:3.12-slim
LABEL org.opencontainers.image.title="Classroom Fast Track" org.opencontainers.image.description="AI staff for online schools, and a game that gets learners exam-ready"
WORKDIR /srv/staffroom
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY tools ./tools
COPY data/demo ./data/demo
COPY data/real ./data/real
COPY --from=web /web/dist ./web/dist

# Public demo by default: only the made-up demo course, read-only settings, no Note button.
# Mount a volume at /data to keep the database between restarts.
ENV FASTTRACK_DATA=real FASTTRACK_PUBLIC=1 FASTTRACK_PUBLIC_AI=1 FASTTRACK_PUBLIC_IMAGES=1 STAFFROOM_DB=/data/staffroom.db PORT=8000
RUN mkdir -p /data
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
