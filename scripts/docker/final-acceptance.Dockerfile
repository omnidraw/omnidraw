FROM ubuntu:24.04

ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=22.17.0
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    BUN_INSTALL=/opt/bun \
    PATH=/opt/bun/bin:${PATH} \
    CI=1 \
    VIBECANVAS_CLEAN_TRACKED_SNAPSHOT=1 \
    VIBECANVAS_LEGACY_ACTOR_ENABLED=0 \
    VIBECANVAS_REQUIRE_FD_INSPECTION=1 \
    VITEST_MAX_WORKERS=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      lsof \
      pkg-config \
      python3 \
      unzip \
      xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "Unsupported Docker target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm -f /tmp/node.tar.xz \
    && test "$(node --version)" = "v${NODE_VERSION}" \
    && curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && test "$(bun --version)" = "${BUN_VERSION}"

WORKDIR /repo
COPY . .

RUN test ! -e node_modules \
    && bun install --frozen-lockfile

CMD ["bun", "run", "scripts/test-final-acceptance.ts", "--clean-snapshot"]
