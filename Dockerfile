# DigitalOcean App Platform Debug Container
# A comprehensive debugging container with all tools needed for
# diagnosing connectivity, database, and infrastructure issues.

FROM python:3.11-slim-bookworm

LABEL maintainer="DigitalOcean App Platform Debug"
LABEL description="Debug container for testing connectivity and diagnosing issues in App Platform"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system packages for debugging
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Network diagnostic tools
    curl \
    wget \
    netcat-openbsd \
    dnsutils \
    iputils-ping \
    traceroute \
    iproute2 \
    net-tools \
    tcpdump \
    nmap \
    # SSL/TLS tools
    openssl \
    ca-certificates \
    # Database clients
    postgresql-client \
    default-mysql-client \
    redis-tools \
    # System diagnostic tools
    procps \
    htop \
    lsof \
    strace \
    # File and text utilities
    vim-tiny \
    less \
    jq \
    tree \
    file \
    # General utilities
    bash-completion \
    tmux \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for database and HTTP testing
RUN pip install --no-cache-dir \
    psycopg2-binary \
    pymysql \
    redis \
    requests \
    httpx \
    pymongo \
    boto3

# Create app directory
WORKDIR /app

# Copy diagnostic scripts
COPY scripts/ /app/scripts/
RUN chmod +x /app/scripts/*.sh 2>/dev/null || true

# Set standard PS1 for SDK compatibility
ENV PS1='\u@\h:\w\$ '

# Default port (can be overridden)
ENV PORT=8080

# Copy and set up the main diagnostic server
COPY server.py /app/server.py

# Expose the port
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Run the diagnostic server
CMD ["python", "server.py"]
