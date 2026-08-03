FROM almir/webhook:2.8.1

# Install git, docker CLI, docker compose plugin, and bash for deploy.sh
RUN apk add --no-cache git docker-cli docker-cli-compose bash

# NOTE: The container MUST be launched with the -template flag to evaluate
# the {{ getenv "WEBHOOK_SECRET" }} inside hooks.json.
