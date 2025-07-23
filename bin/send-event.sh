#!/bin/bash

# send-event.sh - Script to send Quilt package-revision events
# Usage: ./send-event.sh [--write filename] [bucket_name]
# If bucket_name is provided, it will be included in the event detail
# If --write is provided, saves event to file instead of sending

# Auto-load .env file if it exists
if [[ -f ".env" ]]; then
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
fi

# Check for required tools
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

if ! command -v uuidgen &> /dev/null; then
  echo "Error: uuidgen is required but not installed." >&2
  exit 1
fi

# Check for deployment-config.json
if [ ! -f "deployment-config.json" ]; then
    echo "Error: deployment-config.json not found" >&2
    echo "Please run 'npm run cdk:synth' first to generate deployment-config.json" >&2
    exit 1
fi

# Load configuration from deployment-config.json
ACCOUNT=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).account")
NODE_STATUS=$?
if [[ $NODE_STATUS -ne 0 ]]; then
    echo "Error: Failed to read account from deployment-config.json" >&2
    exit 1
fi

REGION=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).region")
NODE_STATUS=$?
if [[ $NODE_STATUS -ne 0 ]]; then
    echo "Error: Failed to read region from deployment-config.json" >&2
    exit 1
fi

# Validate required configuration
if [ -z "$ACCOUNT" ] || [ -z "$REGION" ]; then
    echo "Error: Invalid deployment-config.json - missing account or region" >&2
    exit 1
fi

# Use region precedence: AWS_DEFAULT_REGION > CDK_DEFAULT_REGION > config file region > us-east-1
EFFECTIVE_REGION="${AWS_DEFAULT_REGION:-${CDK_DEFAULT_REGION:-${REGION:-us-east-1}}}"

echo "Using AWS Account: $ACCOUNT"
echo "Using AWS Region: $EFFECTIVE_REGION"

# Parse options
OUTPUT_DIR=""
if [[ "$1" == "--write" ]]; then
    OUTPUT_DIR="$2"
    shift 2
fi

BUCKET_NAME="$1"

# Generate a unique event ID
EVENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Get current timestamp in ISO format
TIMESTAMP=$(date -u +"%Y-%m-%dT%H%M%S")

# Create event detail with or without bucket
DETAIL_JSON=$(jq -n \
  --arg bucket "$BUCKET_NAME" \
  --arg timestamp "$TIMESTAMP" \
  '{
    version: "0.1",
    type: "created",
    handle: ("test/" + $timestamp),
    topHash: "39cb81fc1a02d5487d982d9adfbfabf328e4fa07161813497f5571c35674def2"
  } + (if $bucket != "" then {bucket: $bucket} else {} end)')

# Create the full event structure (like bucket-*.json format)
EVENT_JSON=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg timestamp "$TIMESTAMP" \
  --arg account "$ACCOUNT" \
  --arg region "$REGION" \
  --argjson detail "$DETAIL_JSON" \
  '{
    version: "0",
    id: $id,
    "detail-type": "package-revision",
    source: "com.quiltdata",
    account: $account,
    time: $timestamp,
    region: $region,
    resources: [],
    detail: $detail
  }')

# Also create the EventBridge format (like event-*.json format)
EVENTBRIDGE_JSON=$(jq -n \
  --argjson detail "$DETAIL_JSON" \
  '[{
    Source: "com.quiltdata",
    DetailType: "package-revision",
    Detail: ($detail | tostring),
    EventBusName: "default"
  }]')

# If writing to file, save and exit
if [[ -n "$OUTPUT_DIR" ]]; then
    OUTPUT_PATH="$OUTPUT_DIR/initial-event.json"
    echo "$EVENTBRIDGE_JSON" > "$OUTPUT_PATH"
    WRITE_STATUS=$?
    if [[ $WRITE_STATUS -ne 0 ]]; then
        echo "Error: Failed to write event to $OUTPUT_PATH" >&2
        exit 1
    fi
    echo "Event written to $OUTPUT_PATH"
    exit 0
fi

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
      aws events put-events --entries "$event" --region "$EFFECTIVE_REGION"
      AWS_STATUS=$?
      if [[ $AWS_STATUS -ne 0 ]]; then
        echo "Error: Failed to send event to EventBridge" >&2
        exit 1
      fi
    done
    echo "Event sent successfully!"
  else
    echo "Event not sent."
  fi
else
  echo "AWS CLI not found. Event generated but not sent."
  echo "To send manually, use: aws events put-events --entries '<eventbridge_json>' --region \"$EFFECTIVE_REGION\""
fi
