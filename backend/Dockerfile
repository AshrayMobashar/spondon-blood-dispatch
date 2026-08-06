# --- Base image: hালকা (slim) Python 3.11 ---
FROM python:3.11-slim

# Container-er ভেতরে working directory
WORKDIR /app

# Age শুধু requirements.txt copy kore install kori,
# eতে Docker cache use hoy — code change korle pip install abar dhore run hobe na
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Baki shob backend code copy koro
COPY . .

# Container er 1184 port ke "expose" korlam (documentation purpose,
# actual mapping docker-compose.yml e hobe)
EXPOSE 1184

# Container start hole ei command ta run hobe
CMD ["python", "-m", "app.main"]
