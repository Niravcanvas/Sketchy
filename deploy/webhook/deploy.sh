#!/bin/bash
set -euo pipefail

# Ensure we have the lock to prevent concurrent deployments
(
  flock -n 9 || {
    echo "Deploy already in progress. Exiting."
    exit 0
  }

  echo "Starting deployment..."
  cd /opt/game
  
  git fetch origin main
  git reset --hard origin/main
  
  # Generate short SHA for tagging the image to preserve history
  GIT_SHA=$(git rev-parse --short HEAD)
  
  echo "Building images with tag ${GIT_SHA}..."
  export WEB_IMAGE="sketchy-web:${GIT_SHA}"
  export API_IMAGE="sketchy-api:${GIT_SHA}"
  
  docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod build
  
  # Prune older images (keep last 3 builds)
  echo "Cleaning up old images..."
  docker image prune -f --filter "until=168h" || true
  
  # Keep only the last 3 tagged images for web and api to allow for rollback
  for IMAGE_NAME in "sketchy-web" "sketchy-api"; do
    IMAGES_TO_DELETE=$(docker images --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' "$IMAGE_NAME" \
      | sort -r \
      | awk 'NR>3 {print $2}')
    if [ -n "$IMAGES_TO_DELETE" ]; then
      echo "Removing old $IMAGE_NAME images:"
      echo "$IMAGES_TO_DELETE"
      echo "$IMAGES_TO_DELETE" | xargs -r docker rmi || echo "Warning: some old images could not be removed (may be in use)."
    else
      echo "No old $IMAGE_NAME images to remove."
    fi
  done
  
  echo "Taking Postgres backup before migration..."
  mkdir -p /opt/game/backups
  docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod exec -T postgres pg_dump -U sketchy sketchy -F c > /opt/game/backups/db_backup_$(date +%Y%m%d%H%M%S).dump || echo "Warning: Backup failed or postgres not running yet"
  
  echo "Cleaning up old backups..."
  find /opt/game/backups -name "db_backup_*.dump" -type f -mtime +14 -delete || true
  
  echo "Running database migrations..."
  docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile migrate run --rm migrate
  
  echo "Bringing up production stack..."
  if ! docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile voice up -d --wait; then
    echo "Error: Containers failed to become healthy. Fetching recent logs..."
    docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile voice logs --tail=100
    exit 1
  fi
  
  echo "Deployment successful."

) 9>/tmp/sketchy-deploy.lock
