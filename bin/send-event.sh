#!/bin/bash

# send-event.sh - Script to send Quilt package-revision events
# Usage: ./send-event.sh [bucket_name]
# If bucket_name is provided, it will be included in the event detail

set -e

BUCKET_NAME="$1"

# Generate a unique event ID
EVENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Get current timestamp in ISO format
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Create event detail with or without bucket
if [ -n "$BUCKET_NAME" ]; then
  DETAIL_JSON=$(jq -n \
    --arg bucket "$BUCKET_NAME" \
    '{
      version: "0.1",
      type: "created",
      bucket: $bucket,
      handle: "test/2024-01-18",
      topHash: "39cb81fc1a02d5487d982d9adfbfabf328e4fa07161813497f5571c35674def2"
    }')
else
  DETAIL_JSON=$(jq -n \
    '{
      version: "0.1",
      type: "created",
      handle: "test/2024-01-18",
      topHash: "39cb81fc1a02d5487d982d9adfbfabf328e4fa07161813497f5571c35674def2"
    }')
fi

# Create the full event structure (like bucket-*.json format)
EVENT_JSON=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg timestamp "$TIMESTAMP" \
  --argjson detail "$DETAIL_JSON" \
  '{
    version: "0",
    id: $id,
    "detail-type": "package-revision",
    source: "com.quiltdata",
    account: "012345678901",
    time: $timestamp,
    region: "us-east-2",
    resources: [],
    detail: $detail
  }')

# Also create the EventBridge format (like event-*.json format)
DETAIL_STRING=$(echo "$DETAIL_JSON" | jq -c '.')
EVENTBRIDGE_JSON=$(jq -n \
  --arg detail_str "$DETAIL_STRING" \
  '[{
    Source: "com.quiltdata",
    DetailType: "package-revision",
    Detail: $detail_str,
    EventBusName: "default"
  }]')

echo "Generated event (full format):"
echo "$EVENT_JSON" | jq '.'
echo
echo "Generated event (EventBridge format):"
echo "$EVENTBRIDGE_JSON" | jq '.'

# Check if AWS CLI is available and send the event
if command -v aws &> /dev/null; then
  echo
  read -p "Send this event to EventBridge? (y/N): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Sending event to EventBridge..."
    echo "$EVENTBRIDGE_JSON" | jq -c '.[]' | while read -r event; do
      aws events put-events --entries "$event"
    done
    echo "Event sent successfully!"
  else
    echo "Event not sent."
  fi
else
  echo "AWS CLI not found. Event generated but not sent."
  echo "To send manually, use: aws events put-events --entries '<eventbridge_json>'"
fi
