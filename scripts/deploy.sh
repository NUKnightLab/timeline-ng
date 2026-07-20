#!/usr/bin/env bash
command -v aws >/dev/null 2>&1 || { echo >&2 "You must have the 'aws' command line tool installed."; exit 1; }

target="$1"

case $target in
  stg)
    BUCKET=timeline.knilab.com
    CLIENT_ID="https://timeline.knilab.com/ng/client-metadata.json"
    CLIENT_METADATA_SRC=packages/authoring/public/client-metadata.stg.json
    EMBED_BASE_URL="https://timeline.knilab.com/ng/embed/"
    SHARE_BASE_URL="https://timeline.knilab.com/ng/share"
    ;;
  prd)
    BUCKET=timeline.knightlab.com
    CLIENT_ID="https://timeline.knightlab.com/ng/client-metadata.json"
    CLIENT_METADATA_SRC=packages/authoring/public/client-metadata.prd.json
    EMBED_BASE_URL="https://timeline.knightlab.com/ng/embed/"
    SHARE_BASE_URL="https://timeline.knightlab.com/ng/share"
    ;;
  *)
    echo "You must specify either 'prd' or 'stg'" 1>&2
    exit 1
    ;;
esac

VITE_ATPROTO_PLC_URL=https://plc.directory \
  VITE_ATPROTO_HANDLE_RESOLVER=https://bsky.social \
  VITE_ATPROTO_ALLOW_HTTP=false \
  VITE_ATPROTO_CLIENT_ID="$CLIENT_ID" \
  pnpm run build

if [ $? -ne 0 ]; then
  echo "Build failed." >&2
  exit 1
fi

perl -pi -e "s|__TL_EMBED_BASE__|$EMBED_BASE_URL|g" packages/authoring/dist/index.html
perl -pi -e "s|__TL_SHARE_BASE__|$SHARE_BASE_URL|g" packages/authoring/dist/index.html

cp "$CLIENT_METADATA_SRC" packages/authoring/dist/client-metadata.json

aws s3 sync --only-show-errors --acl public-read packages/authoring/dist s3://$BUCKET/ng/ --exclude "client-metadata.*.json" \
  && aws s3 sync --only-show-errors --acl public-read packages/embed/dist s3://$BUCKET/ng/embed/
if [ $? -ne 0 ]; then
  echo "Deployment failed." >&2
  exit 1
else
  echo "Deployment to s3://$BUCKET/ng/ successful."
fi
