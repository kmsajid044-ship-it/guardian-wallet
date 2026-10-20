# Guardian Wallet hosted online demo (Hugging Face Spaces, Docker SDK, port 7860).
# A four-node FISCO BCOS network, the agent API, Risk Intel, and the owner console in one container.
# Research prototype: USD and CNY demo balances on a simulated ledger, no real money.
# Keys are generated inside the container at start (hosted/start.sh); none are baked into the image.
FROM --platform=linux/amd64 ubuntu:22.04

ARG NODE_VERSION=22.20.0
ARG NODE_SHA256=00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc
ARG PNPM_VERSION=10.33.2
ARG FOUNDRY_VERSION=v1.8.5
ARG FOUNDRY_SHA256=6c66ffcc55fa4249197721baa3098bc208014ea1d8aa04b2ed50ac6bccffb226
ARG FISCO_VERSION=v3.16.4
ARG FISCO_SHA256=7015851c8e7eab3b05a882cfdd71d18567f69bb2b7b79f68205c0b77d8b9d18c
ARG BUILD_CHAIN_SHA256=7656ca5c72c45accd0d2754ed2ecee96f46d03b4d21da979e9c38b40e16cc4b9
ARG FISCO_CONSOLE_VERSION=v3.8.0
ARG FISCO_CONSOLE_SHA256=255f1b67b22f0672612e41f93e816c2ba53a9dd3684ccc2a64c75e1b02fb6d1a

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq perl openssl xxd lsof procps \
      openjdk-17-jre-headless xz-utils python3 make g++ tini \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 && rm /tmp/node.tar.xz \
 && npm install -g "pnpm@${PNPM_VERSION}" && node --version && pnpm --version

RUN curl -fsSL "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_amd64.tar.gz" -o /tmp/foundry.tar.gz \
 && echo "${FOUNDRY_SHA256}  /tmp/foundry.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/foundry.tar.gz -C /usr/local/bin forge cast anvil && rm /tmp/foundry.tar.gz && forge --version

# Hugging Face runs Spaces as uid 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.foundry/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /home/user/app

# FISCO BCOS binary, the official chain builder, and the Java SDK console (used once per deploy to
# enable balances for the local Web3 accounts), fetched and checked at build time.
RUN mkdir -p .fisco/bin \
 && curl -fsSL "https://github.com/FISCO-BCOS/FISCO-BCOS/releases/download/${FISCO_VERSION}/fisco-bcos-linux-x86_64.tar.gz" -o /tmp/fisco.tar.gz \
 && echo "${FISCO_SHA256}  /tmp/fisco.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/fisco.tar.gz -C .fisco/bin && rm /tmp/fisco.tar.gz && .fisco/bin/fisco-bcos --version \
 && curl -fsSL "https://raw.githubusercontent.com/FISCO-BCOS/FISCO-BCOS/${FISCO_VERSION}/tools/BcosAirBuilder/build_chain.sh" -o .fisco/build_chain.sh \
 && echo "${BUILD_CHAIN_SHA256}  .fisco/build_chain.sh" | sha256sum -c - && chmod 0755 .fisco/build_chain.sh \
 && curl -fsSL "https://github.com/FISCO-BCOS/console/releases/download/${FISCO_CONSOLE_VERSION}/console.tar.gz" -o /tmp/console.tar.gz \
 && echo "${FISCO_CONSOLE_SHA256}  /tmp/console.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/console.tar.gz -C .fisco && rm /tmp/console.tar.gz

COPY --chown=user:user package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=user:user agent/package.json agent/
COPY --chown=user:user web/package.json web/
COPY --chown=user:user eval/package.json eval/
COPY --chown=user:user risk-intel/package.json risk-intel/
COPY --chown=user:user contracts/package.json contracts/
RUN pnpm install --frozen-lockfile

COPY --chown=user:user . .
RUN cd contracts && forge build --quiet
# The console is built once for the online demo: same origin as the gateway, owner actions via the gateway.
ARG DEMO_HOST_LABEL=""
RUN cd web && VITE_DEMO_HOST_LABEL="${DEMO_HOST_LABEL}" VITE_DEMO_PUBLIC=1 VITE_AGENT_API_URL=/api VITE_NETWORK=fisco pnpm exec vite build

ENV DEMO_PUBLIC=1 PORT=7860 CHAIN_BACKEND=fisco NODE_ENV=production
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s CMD curl -fsS http://127.0.0.1:7860/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "hosted/start.sh"]
