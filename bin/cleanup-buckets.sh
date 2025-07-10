#!/bin/bash

# Cleanup Titanic buckets with proper cleanup options
# This script can delete both S3 and S3 Tables buckets, with options for content-only or full deletion

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_REGION="us-east-2"
REGION="${CDK_DEFAULT_REGION:-$DEFAULT_REGION}"
ACCOUNT="${CDK_DEFAULT_ACCOUNT}"
CONTENTS_ONLY=false
CHECK_ONLY=false

# Function to show usage
show_usage() {
    echo -e "${BLUE}🗑️  Titanic Bucket Cleanup Script${NC}"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --contents-only    Delete only bucket contents, keep the buckets"
    echo "  --check-only       Only check if S3 Tables bucket is fully deleted"
    echo "  --help            Show this help message"
    echo
    echo "Environment Variables:"
    echo "  CDK_DEFAULT_ACCOUNT    AWS Account ID (required)"
    echo "  CDK_DEFAULT_REGION     AWS Region (default: us-east-2)"
    echo
    echo "This script cleans up both:"
    echo "  - Regular S3 bucket (titanic-glue-tables-*)"
    echo "  - S3 Tables bucket (titanic-s3-tables-*)"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --contents-only)
            CONTENTS_ONLY=true
            shift
            ;;
        --check-only)
            CHECK_ONLY=true
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Unknown option: $1${NC}"
            show_usage
            exit 1
            ;;
    esac
done

echo -e "${BLUE}🗑️  Titanic Bucket Cleanup Script${NC}"

# Validate required environment variables
if [ -z "$ACCOUNT" ]; then
    echo -e "${RED}❌ Error: CDK_DEFAULT_ACCOUNT environment variable is not set${NC}"
    echo "Please set CDK_DEFAULT_ACCOUNT to your AWS account ID"
    echo "Example: export CDK_DEFAULT_ACCOUNT=123456789012"
    exit 1
fi

# Construct bucket names and ARNs
S3_BUCKET_NAME="titanic-glue-tables-${ACCOUNT}-${REGION}"
S3_TABLES_BUCKET_NAME="titanic-s3-tables-${ACCOUNT}-${REGION}"
S3_TABLES_BUCKET_ARN="arn:aws:s3tables:${REGION}:${ACCOUNT}:bucket/${S3_TABLES_BUCKET_NAME}"

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Account: ${ACCOUNT}"
echo "  Region: ${REGION}"
echo "  S3 Bucket: ${S3_BUCKET_NAME}"
echo "  S3 Tables Bucket: ${S3_TABLES_BUCKET_NAME}"
echo "  S3 Tables ARN: ${S3_TABLES_BUCKET_ARN}"
if [ "$CHECK_ONLY" = true ]; then
    echo "  Mode: Check-only (verify S3 Tables bucket deletion)"
elif [ "$CONTENTS_ONLY" = true ]; then
    echo "  Mode: Contents only (buckets will be preserved)"
else
    echo "  Mode: Full deletion (buckets will be deleted)"
fi
echo

# Function to wait for S3 Tables bucket deletion
wait_for_s3_tables_bucket_deletion() {
    local bucket_arn="$1"
    local bucket_name="$2"
    local max_wait_time=300  # 5 minutes
    local check_interval=10  # 10 seconds
    local elapsed_time=0
    
    echo -e "${BLUE}⏳ Waiting for S3 Tables bucket deletion: $bucket_name${NC}"
    
    while [ $elapsed_time -lt $max_wait_time ]; do
        if ! aws s3tables get-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ S3 Tables bucket is fully deleted: $bucket_name${NC}"
            return 0
        fi
        
        echo -e "${YELLOW}⏳ Still waiting for deletion... (${elapsed_time}s elapsed)${NC}"
        sleep $check_interval
        elapsed_time=$((elapsed_time + check_interval))
    done
    
    echo -e "${RED}❌ Timeout waiting for S3 Tables bucket deletion: $bucket_name${NC}"
    echo -e "${YELLOW}⚠️  The bucket may still be in the process of being deleted${NC}"
    return 1
}

# Function to check S3 Tables bucket deletion status
check_s3_tables_bucket_deletion() {
    local bucket_arn="$1"
    local bucket_name="$2"
    
    echo -e "${BLUE}🔍 Checking S3 Tables bucket deletion status: $bucket_name${NC}"
    
    if ! aws s3tables get-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ S3 Tables bucket is fully deleted: $bucket_name${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  S3 Tables bucket still exists: $bucket_name${NC}"
        echo -e "${BLUE}ℹ️  Use --check-only to monitor deletion status${NC}"
        return 1
    fi
}

# Function to clean up regular S3 bucket
cleanup_s3_bucket() {
    local bucket_name="$1"
    
    echo -e "${BLUE}🪣 Processing regular S3 bucket: $bucket_name${NC}"
    
    # Check if bucket exists
    if ! aws s3api head-bucket --bucket "$bucket_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  S3 bucket does not exist or is not accessible: $bucket_name${NC}"
        return 0
    fi
    
    echo -e "${GREEN}✅ S3 bucket found: $bucket_name${NC}"
    
    # Delete all objects and versions
    echo -e "${BLUE}�️  Deleting all objects and versions from S3 bucket...${NC}"
    
    # Delete all object versions and delete markers
    aws s3api list-object-versions --bucket "$bucket_name" --region "$REGION" --query 'Versions[].{Key:Key,VersionId:VersionId}' --output text | while read key version_id; do
        if [ -n "$key" ] && [ -n "$version_id" ]; then
            echo -e "${BLUE}  Deleting version: $key ($version_id)${NC}"
            aws s3api delete-object --bucket "$bucket_name" --key "$key" --version-id "$version_id" --region "$REGION" >/dev/null
        fi
    done
    
    # Delete all delete markers
    aws s3api list-object-versions --bucket "$bucket_name" --region "$REGION" --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text | while read key version_id; do
        if [ -n "$key" ] && [ -n "$version_id" ]; then
            echo -e "${BLUE}  Deleting delete marker: $key ($version_id)${NC}"
            aws s3api delete-object --bucket "$bucket_name" --key "$key" --version-id "$version_id" --region "$REGION" >/dev/null
        fi
    done
    
    # Use s3 rm as backup to ensure all objects are deleted
    aws s3 rm "s3://$bucket_name" --recursive --region "$REGION" >/dev/null 2>&1 || true
    
    echo -e "${GREEN}✅ All objects deleted from S3 bucket: $bucket_name${NC}"
    
    if [ "$CONTENTS_ONLY" = false ]; then
        echo -e "${BLUE}🗑️  Deleting S3 bucket: $bucket_name${NC}"
        if aws s3api delete-bucket --bucket "$bucket_name" --region "$REGION"; then
            echo -e "${GREEN}✅ Successfully deleted S3 bucket: $bucket_name${NC}"
        else
            echo -e "${RED}❌ Failed to delete S3 bucket: $bucket_name${NC}"
            return 1
        fi
    fi
}

# Function to clean up S3 Tables bucket
cleanup_s3_tables_bucket() {
    local bucket_arn="$1"
    local bucket_name="$2"
    
    echo -e "${BLUE}📊 Processing S3 Tables bucket: $bucket_name${NC}"
    
    # Check if bucket exists
    if ! aws s3tables get-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn" >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  S3 Tables bucket does not exist or is not accessible: $bucket_name${NC}"
        return 0
    fi
    
    echo -e "${GREEN}✅ S3 Tables bucket found: $bucket_name${NC}"
    
    # List all namespaces in the bucket
    echo -e "${BLUE}📂 Listing namespaces in the S3 Tables bucket...${NC}"
    NAMESPACES=$(aws s3tables list-namespaces --region "$REGION" --table-bucket-arn "$bucket_arn" --query 'namespaces[].name' --output text 2>/dev/null || echo "")
    
    if [ -n "$NAMESPACES" ]; then
        echo -e "${YELLOW}📝 Found namespaces: $NAMESPACES${NC}"
        
        for namespace in $NAMESPACES; do
            echo -e "${BLUE}🗂️  Processing namespace: $namespace${NC}"
            
            # List all tables in the namespace
            echo -e "${BLUE}📋 Listing tables in namespace $namespace...${NC}"
            TABLES=$(aws s3tables list-tables --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" --query 'tables[].name' --output text 2>/dev/null || echo "")
            
            if [ -n "$TABLES" ]; then
                echo -e "${YELLOW}📝 Found tables: $TABLES${NC}"
                
                # Delete each table
                for table in $TABLES; do
                    echo -e "${BLUE}🗑️  Deleting table: $namespace.$table${NC}"
                    if aws s3tables delete-table --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" --name "$table"; then
                        echo -e "${GREEN}✅ Successfully deleted table: $namespace.$table${NC}"
                    else
                        echo -e "${RED}❌ Failed to delete table: $namespace.$table${NC}"
                        return 1
                    fi
                done
            else
                echo -e "${GREEN}✅ No tables found in namespace $namespace${NC}"
            fi
            
            # Delete the namespace
            echo -e "${BLUE}🗑️  Deleting namespace: $namespace${NC}"
            if aws s3tables delete-namespace --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace"; then
                echo -e "${GREEN}✅ Successfully deleted namespace: $namespace${NC}"
            else
                echo -e "${RED}❌ Failed to delete namespace: $namespace${NC}"
                return 1
            fi
        done
    else
        echo -e "${GREEN}✅ No namespaces found in the S3 Tables bucket${NC}"
    fi
    
    if [ "$CONTENTS_ONLY" = false ]; then
        # Finally, delete the bucket
        echo -e "${BLUE}🗑️  Deleting S3 Tables bucket: $bucket_name${NC}"
        if aws s3tables delete-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn"; then
            echo -e "${GREEN}✅ Successfully initiated deletion of S3 Tables bucket: $bucket_name${NC}"
            
            # Wait for the bucket to be fully deleted
            wait_for_s3_tables_bucket_deletion "$bucket_arn" "$bucket_name"
        else
            echo -e "${RED}❌ Failed to delete S3 Tables bucket: $bucket_name${NC}"
            return 1
        fi
    fi
}

# Main execution
echo -e "${BLUE}🚀 Starting cleanup process...${NC}"
echo

# Handle check-only mode
if [ "$CHECK_ONLY" = true ]; then
    echo -e "${BLUE}🔍 Check-only mode: Verifying S3 Tables bucket deletion status${NC}"
    check_s3_tables_bucket_deletion "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET_NAME"
    exit $?
fi

# Clean up regular S3 bucket
cleanup_s3_bucket "$S3_BUCKET_NAME"
echo

# Clean up S3 Tables bucket
cleanup_s3_tables_bucket "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET_NAME"
echo

# Summary
if [ "$CONTENTS_ONLY" = true ]; then
    echo -e "${GREEN}🎉 Bucket contents cleanup completed successfully!${NC}"
    echo -e "${BLUE}📝 Both buckets have been emptied but preserved for future use.${NC}"
else
    echo -e "${GREEN}🎉 Full cleanup completed successfully!${NC}"
    echo -e "${BLUE}📝 Both buckets and their contents have been completely removed.${NC}"
fi
