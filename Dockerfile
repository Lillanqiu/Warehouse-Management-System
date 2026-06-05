FROM python:3.12-slim

WORKDIR /app

ENV PORT=8000
ENV DATA_DIR=/data
ENV PYTHONUNBUFFERED=1

COPY index.html styles.css app.js server.py ./
COPY templates ./templates

EXPOSE 8000

CMD ["python", "server.py"]
