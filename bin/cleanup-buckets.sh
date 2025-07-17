#!/bin/bash

# Cleanup Titanic buckets with proper cleanup options
# This script can delete S3 and S3 Tables buckets, with options for content-only or full deletion
# By default, only cleans up S3 Tables and assets buckets - use --destroy-glue-tables to also clean glue tables

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
CONTENTS_ONLY=false
CHECK_ONLY=false
INCLUDE_GLUE_TABLES=false
LIST_ONLY=false

# Function to show usage
show_usage() {
    echo -e "${BLUE}🗑️  Titanic Bucket Cleanup Script${NC}"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --contents-only         Delete only bucket contents, keep the buckets"
    echo "  --dry-run               Only check if S3 Tables bucket is fully deleted"
    echo "  --list-only             List bucket contents without deleting anything"
    echo "  --destroy-glue-tables   Also clean up the glue tables bucket (default: skip)"
    echo "  --help                  Show this help message"
    echo
    echo "Configuration:"
    echo "  Uses deployment-config.json for bucket names and AWS configuration"
    echo "  Run 'npm run cdk:synth' first to generate deployment-config.json"
    echo
    echo "By default, this script cleans up:"
    echo "  - S3 Tables bucket (titanic-s3-tables-*)"
    echo "  - Assets bucket (titanic-assets-*)"
    echo "  - Skips glue tables bucket (use --destroy-glue-tables to destroy them too)"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --contents-only)
            CONTENTS_ONLY=true
            shift
            ;;
        --dry-run)
            CHECK_ONLY=true
            shift
            ;;
        --list-only)
            LIST_ONLY=true
            shift
            ;;
        --destroy-glue-tables)
            INCLUDE_GLUE_TABLES=true
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

# Check for deployment-config.json
if [ ! -f "deployment-config.json" ]; then
    echo -e "${RED}❌ Error: deployment-config.json not found${NC}"
    echo "Please run 'npm run cdk:synth' first to generate deployment-config.json"
    exit 1
fi

# Load configuration from deployment-config.json
ACCOUNT=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).account")
REGION=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).region")
GLUE_TABLES_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).buckets.glueTablesBucket || ''")
S3_TABLES_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).buckets.s3TablesBucket || ''")
ASSETS_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('deployment-config.json', 'utf8')).buckets.assetsBucket || ''")

# Validate required configuration
if [ -z "$ACCOUNT" ] || [ -z "$REGION" ]; then
    echo -e "${RED}❌ Error: Invalid deployment-config.json - missing account or region${NC}"
    exit 1
fi

# Generate bucket names if not provided in config
if [ -z "$GLUE_TABLES_BUCKET" ]; then
    GLUE_TABLES_BUCKET="titanic-glue-tables-${ACCOUNT}-${REGION}"
fi
if [ -z "$S3_TABLES_BUCKET" ]; then
    S3_TABLES_BUCKET="titanic-s3-tables-${ACCOUNT}-${REGION}"
fi
if [ -z "$ASSETS_BUCKET" ]; then
    ASSETS_BUCKET="titanic-assets-${ACCOUNT}-${REGION}"
fi

# Construct S3 Tables bucket ARN
S3_TABLES_BUCKET_ARN="arn:aws:s3tables:${REGION}:${ACCOUNT}:bucket/${S3_TABLES_BUCKET}"

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Account: ${ACCOUNT}"
echo "  Region: ${REGION}"
echo "  Glue Tables Bucket: ${GLUE_TABLES_BUCKET} $([ "$INCLUDE_GLUE_TABLES" = true ] && echo "(will be cleaned)" || echo "(skipped)")"
echo "  S3 Tables Bucket: ${S3_TABLES_BUCKET}"
echo "  Assets Bucket: ${ASSETS_BUCKET}"
echo "  S3 Tables ARN: ${S3_TABLES_BUCKET_ARN}"
if [ "$CHECK_ONLY" = true ]; then
    echo "  Mode: dry-run (verify S3 Tables bucket deletion)"
elif [ "$LIST_ONLY" = true ]; then
    echo "  Mode: List only (show bucket contents without deleting)"
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
        echo -e "${BLUE}ℹ️  Use --dry-run to monitor deletion status${NC}"
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

# Function to list S3 Tables bucket contents for debugging
list_s3_tables_bucket_contents() {
    local bucket_arn="$1"
    local bucket_name="$2"
    
    echo -e "${BLUE}🔍 Detailed S3 Tables bucket contents for: $bucket_name${NC}"
    
    # Get bucket info
    echo -e "${BLUE}📊 Bucket Information:${NC}"
    aws s3tables get-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn" --output table 2>/dev/null || echo "  Failed to get bucket info"
    
    # List all namespaces with detailed info
    echo -e "${BLUE}📂 Namespaces:${NC}"
    aws s3tables list-namespaces --region "$REGION" --table-bucket-arn "$bucket_arn" --output table 2>/dev/null || echo "  Failed to list namespaces"
    
    # For each namespace, list tables
    local namespaces=$(aws s3tables list-namespaces --region "$REGION" --table-bucket-arn "$bucket_arn" --query 'namespaces[].namespace' --output text 2>/dev/null || echo "")
    if [ -n "$namespaces" ]; then
        for namespace in $namespaces; do
            echo -e "${BLUE}📋 Tables in namespace '$namespace':${NC}"
            aws s3tables list-tables --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" --output table 2>/dev/null || echo "  Failed to list tables in $namespace"
        done
    fi
    
    # Try to check if there are any underlying S3 objects (S3 Tables may have hidden metadata)
    echo -e "${BLUE}🪣 Checking underlying S3 objects (if accessible):${NC}"
    aws s3 ls "s3://$bucket_name" --recursive --region "$REGION" 2>/dev/null || echo "  No direct S3 access or bucket empty"
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
    NAMESPACES=$(aws s3tables list-namespaces --region "$REGION" --table-bucket-arn "$bucket_arn" --query 'namespaces[].namespace' --output text 2>/dev/null || echo "")
    
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
    
    # Additional cleanup attempts for stubborn buckets
    echo -e "${BLUE}🧹 Performing additional cleanup checks...${NC}"
    
    # Force cleanup any remaining namespaces that might not have been listed
    echo -e "${BLUE}🔍 Double-checking for any remaining namespaces...${NC}"
    local remaining_namespaces=$(aws s3tables list-namespaces --region "$REGION" --table-bucket-arn "$bucket_arn" --query 'namespaces[].namespace' --output text 2>/dev/null || echo "")
    if [ -n "$remaining_namespaces" ]; then
        echo -e "${YELLOW}⚠️  Found remaining namespaces after cleanup: $remaining_namespaces${NC}"
        for namespace in $remaining_namespaces; do
            echo -e "${BLUE}🗑️  Force deleting remaining namespace: $namespace${NC}"
            aws s3tables delete-namespace --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" || echo "  Failed to delete $namespace"
        done
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
            echo -e "${BLUE}🔍 Listing bucket contents for debugging...${NC}"
            list_s3_tables_bucket_contents "$bucket_arn" "$bucket_name"
            return 1
        fi
    fi
}

# Main execution
echo -e "${BLUE}🚀 Starting cleanup process...${NC}"
echo

# Handle dry-run mode
if [ "$CHECK_ONLY" = true ]; then
    echo -e "${BLUE}🔍 dry-run mode: Verifying S3 Tables bucket deletion status${NC}"
    check_s3_tables_bucket_deletion "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET"
    exit $?
fi

# Handle list-only mode
if [ "$LIST_ONLY" = true ]; then
    echo -e "${BLUE}📋 List-only mode: Showing bucket contents${NC}"
    
    if [ "$INCLUDE_GLUE_TABLES" = true ] && [ -n "$GLUE_TABLES_BUCKET" ]; then
        echo -e "${BLUE}🧹 Listing glue tables bucket contents...${NC}"
        if aws s3api head-bucket --bucket "$GLUE_TABLES_BUCKET" --region "$REGION" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Glue tables bucket found: $GLUE_TABLES_BUCKET${NC}"
            aws s3 ls "s3://$GLUE_TABLES_BUCKET" --recursive --region "$REGION" --human-readable --summarize 2>/dev/null || echo "  Bucket is empty or not accessible"
        else
            echo -e "${YELLOW}⚠️  Glue tables bucket not found: $GLUE_TABLES_BUCKET${NC}"
        fi
        echo
    fi
    
    if [ -n "$ASSETS_BUCKET" ]; then
        echo -e "${BLUE}🧹 Listing assets bucket contents...${NC}"
        if aws s3api head-bucket --bucket "$ASSETS_BUCKET" --region "$REGION" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Assets bucket found: $ASSETS_BUCKET${NC}"
            aws s3 ls "s3://$ASSETS_BUCKET" --recursive --region "$REGION" --human-readable --summarize 2>/dev/null || echo "  Bucket is empty or not accessible"
        else
            echo -e "${YELLOW}⚠️  Assets bucket not found: $ASSETS_BUCKET${NC}"
        fi
        echo
    fi
    
    if [ -n "$S3_TABLES_BUCKET" ]; then
        echo -e "${BLUE}🧹 Listing S3 Tables bucket contents...${NC}"
        list_s3_tables_bucket_contents "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET"
        echo
    fi
    
    echo -e "${GREEN}🎉 Bucket listing completed!${NC}"
    exit 0
fi

# Clean up buckets based on flags
if [ "$INCLUDE_GLUE_TABLES" = true ]; then
    echo -e "${BLUE}🧹 Cleaning up glue tables bucket...${NC}"
    cleanup_s3_bucket "$GLUE_TABLES_BUCKET"
    echo
fi

# Clean up assets bucket
if [ -n "$ASSETS_BUCKET" ]; then
    echo -e "${BLUE}🧹 Cleaning up assets bucket...${NC}"
    cleanup_s3_bucket "$ASSETS_BUCKET"
    echo
fi

# Clean up S3 Tables bucket
if [ -n "$S3_TABLES_BUCKET" ]; then
    echo -e "${BLUE}🧹 Cleaning up S3 Tables bucket...${NC}"
    cleanup_s3_tables_bucket "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET"
    echo
fi

# Summary
if [ "$CONTENTS_ONLY" = true ]; then
    echo -e "${GREEN}🎉 Bucket contents cleanup completed successfully!${NC}"
    echo -e "${BLUE}📝 Buckets have been emptied but preserved for future use.${NC}"
    if [ "$INCLUDE_GLUE_TABLES" = false ]; then
        echo -e "${BLUE}💡 Note: Glue tables bucket was skipped. Use --destroy-glue-tables to clean it.${NC}"
    fi
else
    echo -e "${GREEN}🎉 Full cleanup completed successfully!${NC}"
    echo -e "${BLUE}📝 Buckets and their contents have been completely removed.${NC}"
    if [ "$INCLUDE_GLUE_TABLES" = false ]; then
        echo -e "${BLUE}💡 Note: Glue tables bucket was skipped. Use --destroy-glue-tables to clean it.${NC}"
    fi
fi
