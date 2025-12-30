# DigitalOcean App Platform Debug Container
# Multi-stage build with Go health server and configurable runtime (Python/Node.js)
#
# Build variants:
#   docker build --target debug-python -t debug-python .
#   docker build --target debug-node -t debug-node .

# =============================================================================
# Stage 1: Build Go health server
# =============================================================================
FROM golang:1.21-alpine AS health-builder

WORKDIR /build
COPY health-server/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o health-server main.go

# =============================================================================
# Stage 2: Base image with common tools and all database clients
# =============================================================================
FROM ubuntu:24.04 AS base

LABEL maintainer="DigitalOcean App Platform"
LABEL description="Debug container for App Platform troubleshooting"

ENV DEBIAN_FRONTEND=noninteractive
ENV PS1='\u@\h:\w\$ '

# Install common packages and network diagnostic tools
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
    gnupg \
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
    git \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# -----------------------------------------------------------------------------
# Database Clients
# -----------------------------------------------------------------------------

# PostgreSQL client
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# MySQL client
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

# Redis client (works with Valkey too)
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# MongoDB Shell (mongosh)
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends mongodb-mongosh \
    && rm -rf /var/lib/apt/lists/*

# Kafka client tools (kcat/kafkacat)
RUN apt-get update && apt-get install -y --no-install-recommends \
    kafkacat \
    && rm -rf /var/lib/apt/lists/*

# OpenSearch/Elasticsearch - use curl with JSON (REST API, curl + jq is standard)

# -----------------------------------------------------------------------------
# DigitalOcean CLI (doctl)
# -----------------------------------------------------------------------------
RUN DOCTL_VERSION=$(curl -s https://api.github.com/repos/digitalocean/doctl/releases/latest | jq -r '.tag_name' | sed 's/v//') \
    && curl -sL "https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-amd64.tar.gz" -o /tmp/doctl.tar.gz \
    && tar -xzf /tmp/doctl.tar.gz -C /tmp \
    && mv /tmp/doctl /usr/local/bin/doctl \
    && chmod +x /usr/local/bin/doctl \
    && rm /tmp/doctl.tar.gz

# Create app directory and user
RUN useradd -m -s /bin/bash debuguser \
    && echo "debuguser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

WORKDIR /app

# Copy health server from builder
COPY --from=health-builder /build/health-server /usr/local/bin/health-server

# Copy scripts
COPY scripts/ /app/scripts/
RUN chmod +x /app/scripts/*.sh 2>/dev/null || true \
    && ln -sf /app/scripts/diagnose.sh /usr/local/bin/diagnose.sh \
    && ln -sf /app/scripts/test-db.sh /usr/local/bin/test-db.sh \
    && ln -sf /app/scripts/test-connectivity.sh /usr/local/bin/test-connectivity.sh \
    && ln -sf /app/scripts/test-spaces.sh /usr/local/bin/test-spaces.sh

# Copy startup script
COPY scripts/startup.sh /app/startup.sh
RUN chmod +x /app/startup.sh

ENV PORT=8080
EXPOSE 8080

# =============================================================================
# Stage 3: Python Debug Container
# =============================================================================
FROM base AS debug-python

LABEL runtime="python"
ENV DEBUG_RUNTIME=python
ENV DEBUG_CONTAINER_TYPE=debug-python

# Install Python and pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install Python database adapters and utilities
RUN pip3 install --no-cache-dir --break-system-packages \
    # PostgreSQL
    psycopg2-binary \
    # MySQL
    pymysql \
    cryptography \
    # Redis/Valkey
    redis \
    # MongoDB
    pymongo \
    # Kafka
    confluent-kafka \
    kafka-python-ng \
    # OpenSearch
    opensearch-py \
    # HTTP clients
    requests \
    httpx \
    # AWS SDK (for Spaces)
    boto3 \
    # Utilities
    rich \
    python-dotenv

USER debuguser
CMD ["/app/startup.sh"]

# =============================================================================
# Stage 4: Node.js Debug Container
# =============================================================================
FROM base AS debug-node

LABEL runtime="node"
ENV DEBUG_RUNTIME=node
ENV DEBUG_CONTAINER_TYPE=debug-node

# Install Node.js LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install global npm packages for database testing
RUN npm install -g \
    # PostgreSQL
    pg \
    # MySQL
    mysql2 \
    # Redis/Valkey
    redis \
    ioredis \
    # MongoDB
    mongodb \
    # Kafka
    kafkajs \
    # OpenSearch
    @opensearch-project/opensearch \
    # HTTP
    axios \
    node-fetch \
    # AWS SDK (for Spaces)
    @aws-sdk/client-s3 \
    # Utilities
    dotenv

USER debuguser
CMD ["/app/startup.sh"]
