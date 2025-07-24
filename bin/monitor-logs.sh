#!/bin/bash

# Monitor CloudWatch logs for TitanicMergeTables Lambda function
# This script uses stack outputs to get the log group name

# Auto-load .env file if it exists
if [[ -f ".env" ]]; then
    set -a  # automatically export all variables
    source .env
    set +a  # stop automatically exporting
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine AWS region with proper precedence
REGION="${AWS_DEFAULT_REGION:-${CDK_DEFAULT_REGION:-us-east-1}}"
STACK_NAME="TitanicStack"

echo -e "${BLUE}🔍 Getting Lambda log group from CDK stack outputs...${NC}"
echo -e "${YELLOW}Using AWS region: $REGION${NC}"

# Get the log group name from stack outputs
LOG_GROUP=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`LambdaLogGroupName`].OutputValue' \
    --output text 2>/dev/null)
AWS_STATUS=$?

if [[ $AWS_STATUS -ne 0 ]]; then
    echo -e "${RED}❌ Failed to query CloudFormation stack outputs${NC}"
    echo -e "${YELLOW}💡 Check if AWS CLI is configured and you have permissions${NC}"
    exit 1
fi

if [ -z "$LOG_GROUP" ] || [ "$LOG_GROUP" = "None" ]; then
    echo -e "${RED}❌ Could not find log group name in stack outputs${NC}"
    echo -e "${YELLOW}💡 Make sure the TitanicStack is deployed with the latest version${NC}"
    exit 1
fi

echo -e "${GREEN}📋 Log group: $LOG_GROUP${NC}"

# Function to show recent logs
show_recent_logs() {
    local minutes=${1:-15}
    local start_time=$(($(date +%s) - minutes * 60))000
    
    echo -e "\n${BLUE}📊 Recent logs (last $minutes minute(s)):${NC}"
    aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --start-time "$start_time" \
        --region "$REGION" \
        --query 'events[*].[timestamp,message]' \
        --output text | \
    while IFS=$'\t' read -r timestamp message; do
        if [ -n "$timestamp" ] && [ -n "$message" ]; then
            # Convert timestamp to readable format (macOS date command)
            readable_time=$(date -r $((timestamp/1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Invalid timestamp")
            
            # Color code based on message content
            if [[ "$message" == *"ERROR"* ]] || [[ "$message" == *"❌"* ]]; then
                echo -e "${RED}[$readable_time] $message${NC}"
            elif [[ "$message" == *"WARN"* ]] || [[ "$message" == *"⚠️"* ]]; then
                echo -e "${YELLOW}[$readable_time] $message${NC}"
            elif [[ "$message" == *"✅"* ]] || [[ "$message" == *"SUCCESS"* ]]; then
                echo -e "${GREEN}[$readable_time] $message${NC}"
            else
                echo "[$readable_time] $message"
            fi
        fi
    done
    
    # Check if the aws logs command failed
    if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
        echo -e "${RED}❌ Failed to fetch logs from CloudWatch${NC}"
        return 1
    fi
}

# Function to show errors
show_errors() {
    local minutes=${1:-15}
    local start_time=$(($(date +%s) - minutes * 60))000
    
    echo -e "\n${RED}🚨 Errors (last $minutes minute(s)):${NC}"
    local error_count=$(aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --start-time "$start_time" \
        --region "$REGION" \
        --filter-pattern "ERROR" \
        --query 'length(events)' \
        --output text)
    
    if [ "$error_count" = "0" ]; then
        echo -e "${GREEN}✅ No errors found!${NC}"
    else
        aws logs filter-log-events \
            --log-group-name "$LOG_GROUP" \
            --start-time "$start_time" \
            --region "$REGION" \
            --filter-pattern "ERROR" \
            --query 'events[*].[timestamp,message]' \
            --output text | \
        while IFS=$'\t' read -r timestamp message; do
            if [ -n "$timestamp" ] && [ -n "$message" ]; then
                readable_time=$(date -r $((timestamp/1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Invalid timestamp")
                echo -e "${RED}[$readable_time] $message${NC}"
            fi
        done
    fi
}

# Function to tail logs
tail_logs() {
    echo -e "\n${BLUE}📡 Tailing logs (press Ctrl+C to stop)...${NC}"
    aws logs tail "$LOG_GROUP" --region "$REGION" --follow
    TAIL_STATUS=$?
    if [[ $TAIL_STATUS -ne 0 ]]; then
        echo -e "${RED}❌ Failed to tail logs from CloudWatch${NC}"
        exit 1
    fi
}

# Function to show Athena-related logs
show_athena_logs() {
    local minutes=${1:-15}
    local start_time=$(($(date +%s) - minutes * 60))000
    
    echo -e "\n${BLUE}🔍 Athena-related logs (last $minutes minute(s)):${NC}"
    aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --start-time "$start_time" \
        --region "$REGION" \
        --filter-pattern "Athena" \
        --query 'events[*].[timestamp,message]' \
        --output text | \
    while IFS=$'\t' read -r timestamp message; do
        if [ -n "$timestamp" ] && [ -n "$message" ]; then
            readable_time=$(date -r $((timestamp/1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Invalid timestamp")
            echo "[$readable_time] $message"
        fi
    done
}

# Function to show S3 bucket related logs
show_s3_logs() {
    local minutes=${1:-15}
    local start_time=$(($(date +%s) - minutes * 60))000
    
    echo -e "\n${BLUE}📦 S3 bucket-related logs (last $minutes minute(s)):${NC}"
    aws logs filter-log-events \
        --log-group-name "$LOG_GROUP" \
        --start-time "$start_time" \
        --region "$REGION" \
        --filter-pattern "bucket" \
        --query 'events[*].[timestamp,message]' \
        --output text | \
    while IFS=$'\t' read -r timestamp message; do
        if [ -n "$timestamp" ] && [ -n "$message" ]; then
            readable_time=$(date -r $((timestamp/1000)) '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Invalid timestamp")
            echo "[$readable_time] $message"
        fi
    done
}

# Parse command line arguments
case "${1:-help}" in
    "recent"|"r")
        show_recent_logs ${2:-15}
        ;;
    "errors"|"e")
        show_errors ${2:-15}
        ;;
    "tail"|"t")
        tail_logs
        ;;
    "athena"|"a")
        show_athena_logs ${2:-15}
        ;;
    "s3"|"s")
        show_s3_logs ${2:-15}
        ;;
    "all")
        show_errors 15
        show_recent_logs 15
        show_athena_logs 15
        show_s3_logs 15
        ;;
    "help"|"h"|"-h"|"--help")
        echo "Usage: $0 [command] [minutes]"
        echo ""
        echo "Commands:"
        echo "  recent, r [minutes]  Show recent logs (default: 15 minutes)"
        echo "  errors, e [minutes]  Show errors (default: 15 minutes)"
        echo "  tail, t             Tail logs in real-time"
        echo "  athena, a [minutes] Show Athena-related logs (default: 15 minutes)"
        echo "  s3, s [minutes]     Show S3 bucket-related logs (default: 15 minutes)"
        echo "  all                 Show all log types"
        echo "  help, h             Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 recent 30        # Show logs from last 30 minutes"
        echo "  $0 errors           # Show errors from last 15 minutes"
        echo "  $0 tail             # Tail logs in real-time"
        echo "  $0 athena 60        # Show Athena logs from last 60 minutes"
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
