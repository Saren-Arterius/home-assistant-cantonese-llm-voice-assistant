ARG BUILD_FROM
FROM ${BUILD_FROM}

ARG WHISPER_CPP_VERSION

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install runtime dependencies including sysstat for CPU monitoring
RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
    netcat-traditional \
    sysstat

RUN \
    git clone https://github.com/ggerganov/whisper.cpp.git whisper.cpp \
    && cd whisper.cpp \
    && git reset --hard v${WHISPER_CPP_VERSION} \
    && cmake -B build -DGGML_SYCL=ON -DCMAKE_C_COMPILER=icx -DCMAKE_CXX_COMPILER=icpx -DGGML_SYCL_F16=ON \
    && cmake --build build -j --config Release

WORKDIR /whisper.cpp

COPY entrypoint.sh /entrypoint.sh
# Make the entrypoint script executable
RUN chmod +x /entrypoint.sh

# Set the entrypoint for the container. The 'command' from docker-compose will be passed as arguments.
ENTRYPOINT ["/entrypoint.sh"]

# Healthcheck remains to integrate with docker-compose service dependency health.
# HAProxy waits for this to pass before routing traffic.
HEALTHCHECK --start-period=10m \
    CMD echo '{ "type": "describe" }' \
    | nc -w 1 localhost 8910 \
    | grep -iq "whisper.cpp" \
    || exit 1
