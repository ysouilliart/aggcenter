FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        ca-certificates \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

# The Cloud Agent runs as the `ubuntu` user, which already exists in this image.
USER ubuntu
