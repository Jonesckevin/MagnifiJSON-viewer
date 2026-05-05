FROM python:3.12-slim

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python dependencies
COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create vendor directory and download static assets at build time
# (fully offline — no CDN dependency at runtime)
RUN mkdir -p /app/static/vendor/fonts

# Bootstrap 5.3.3
RUN curl -fsSL "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" \
        -o /app/static/vendor/bootstrap.min.css \
 && curl -fsSL "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" \
        -o /app/static/vendor/bootstrap.bundle.min.js

# Bootstrap Icons 1.11.3
RUN curl -fsSL "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" \
        -o /app/static/vendor/bootstrap-icons.min.css \
 && curl -fsSL "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2" \
        -o /app/static/vendor/fonts/bootstrap-icons.woff2 \
 && curl -fsSL "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff" \
        -o /app/static/vendor/fonts/bootstrap-icons.woff

# Apache ECharts 5.5.1
RUN curl -fsSL "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js" \
        -o /app/static/vendor/echarts.min.js

# Fix Bootstrap Icons CSS font paths to use local /static/vendor/fonts/
RUN sed -i 's|url("../fonts/bootstrap-icons.woff2|url("/static/vendor/fonts/bootstrap-icons.woff2|g' \
        /app/static/vendor/bootstrap-icons.min.css \
 && sed -i 's|url("../fonts/bootstrap-icons.woff"|url("/static/vendor/fonts/bootstrap-icons.woff"|g' \
        /app/static/vendor/bootstrap-icons.min.css

# Copy application code
COPY app/ .

# Create runtime directories
RUN mkdir -p /app/upload /app/exports

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--loop", "asyncio"]
