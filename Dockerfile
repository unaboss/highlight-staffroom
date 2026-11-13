FROM python:3.12-slim

WORKDIR /srv/staffroom
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data/demo ./data/demo

# Keep the database on a volume so it survives restarts: docker run -v staffroom:/data ...
ENV STAFFROOM_DB=/data/staffroom.db
VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
