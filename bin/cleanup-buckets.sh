#!/bin/bash

# Cleanup Titanic buckets with proper cleanup options
# This script can delete S3 and S3 Tables buckets, with options for content-only or full deletion
# By default, only cleans up S3 Tables and assets buckets - use --destroy-glue-bucket to also clean the glue tables S3 bucket

# Exit on any error with clear error messages
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to handle errors and exit with clear messages
handle_error() {
    local exit_code=$1
    local error_message=$2
    local context=$3
    
    echo -e "${RED}❌ Error: $error_message${NC}" >&2
    if [ -n "$context" ]; then
        echo -e "${RED}   Context: $context${NC}" >&2
    fi
    echo -e "${RED}   Exiting with code $exit_code${NC}" >&2
    exit $exit_code
}

# Default values
CONTENTS_ONLY=false
CHECK_ONLY=false
INCLUDE_GLUE_TABLES=false
LIST_ONLY=false
GLUE_TABLES_ONLY=false

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
    echo "  --destroy-glue-bucket   Also clean up the glue tables S3 bucket (default: skip)"
    echo "  --glue-tables-only      Only delete Glue catalog tables, skip all buckets"
    echo "  --help                  Show this help message"
    echo
    echo "Configuration:"
    echo "  Uses doc/deployment-config.json for bucket names and AWS configuration"
    echo "  This file should exist in the doc/ directory"
    echo
    echo "By default, this script cleans up:"
    echo "  - S3 Tables bucket (titanic-s3-tables-*)"
    echo "  - Assets bucket (titanic-assets-*)"
    echo "  - Glue catalog tables (package_entry, package_revision, package_tag)"
    echo "  - Skips glue tables S3 bucket (use --destroy-glue-bucket to destroy it too)"
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
        --destroy-glue-bucket)
            INCLUDE_GLUE_TABLES=true
            shift
            ;;
        --glue-tables-only)
            GLUE_TABLES_ONLY=true
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
if [ ! -f "doc/deployment-config.json" ]; then
    handle_error 1 "doc/deployment-config.json not found" "This file should exist in the doc/ directory"
fi

# Load configuration from deployment-config.json
ACCOUNT=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).account" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$ACCOUNT" ]; then
    handle_error 1 "Failed to read account from doc/deployment-config.json" "Check if the file is valid JSON and contains the account field"
fi

REGION=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).region" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$REGION" ]; then
    handle_error 1 "Failed to read region from doc/deployment-config.json" "Check if the file is valid JSON and contains the region field"
fi

GLUE_TABLES_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).buckets.glueTablesBucket || ''" 2>/dev/null)
S3_TABLES_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).buckets.s3TablesBucket || ''" 2>/dev/null)
ASSETS_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).buckets.assetsBucket || ''" 2>/dev/null)
DATABASE_NAME=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).athenaDatabaseName || ''" 2>/dev/null)
RESULTS_BUCKET=$(node -p "JSON.parse(require('fs').readFileSync('doc/deployment-config.json', 'utf8')).buckets.assetsBucket || ''" 2>/dev/null)  # Use assets bucket for Athena results

# Validate required configuration
if [ -z "$ACCOUNT" ] || [ -z "$REGION" ]; then
    handle_error 1 "Invalid doc/deployment-config.json - missing account or region" "Account: '$ACCOUNT', Region: '$REGION'"
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
echo "  Database: ${DATABASE_NAME}"
echo "  Glue Tables S3 Bucket: ${GLUE_TABLES_BUCKET} $([ "$INCLUDE_GLUE_TABLES" = true ] && echo "(will be cleaned)" || echo "(skipped)")"
echo "  S3 Tables Bucket: ${S3_TABLES_BUCKET}"
echo "  Assets Bucket: ${ASSETS_BUCKET}"
echo "  S3 Tables ARN: ${S3_TABLES_BUCKET_ARN}"
if [ "$CHECK_ONLY" = true ]; then
    echo "  Mode: dry-run (verify S3 Tables bucket deletion)"
elif [ "$LIST_ONLY" = true ]; then
    echo "  Mode: List only (show bucket contents without deleting)"
elif [ "$GLUE_TABLES_ONLY" = true ]; then
    echo "  Mode: Glue catalog tables only (skip all buckets)"
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
        if aws s3api delete-bucket --bucket "$bucket_name" --region "$REGION" 2>/dev/null; then
            echo -e "${GREEN}✅ Successfully deleted S3 bucket: $bucket_name${NC}"
        else
            echo -e "${RED}❌ Failed to delete S3 bucket: $bucket_name${NC}"
            echo -e "${YELLOW}⚠️  This may be due to remaining objects or bucket policies${NC}"
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
                    if aws s3tables delete-table --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" --name "$table" 2>/dev/null; then
                        echo -e "${GREEN}✅ Successfully deleted table: $namespace.$table${NC}"
                    else
                        echo -e "${RED}❌ Failed to delete table: $namespace.$table${NC}"
                        echo -e "${YELLOW}⚠️  This may affect the ability to delete the entire bucket${NC}"
                        return 1
                    fi
                done
            else
                echo -e "${GREEN}✅ No tables found in namespace $namespace${NC}"
            fi
            
            # Delete the namespace
            echo -e "${BLUE}🗑️  Deleting namespace: $namespace${NC}"
            if aws s3tables delete-namespace --region "$REGION" --table-bucket-arn "$bucket_arn" --namespace "$namespace" 2>/dev/null; then
                echo -e "${GREEN}✅ Successfully deleted namespace: $namespace${NC}"
            else
                echo -e "${RED}❌ Failed to delete namespace: $namespace${NC}"
                echo -e "${YELLOW}⚠️  This may affect the ability to delete the entire bucket${NC}"
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
        if aws s3tables delete-table-bucket --region "$REGION" --table-bucket-arn "$bucket_arn" 2>/dev/null; then
            echo -e "${GREEN}✅ Successfully initiated deletion of S3 Tables bucket: $bucket_name${NC}"
            
            # Wait for the bucket to be fully deleted
            wait_for_s3_tables_bucket_deletion "$bucket_arn" "$bucket_name"
        else
            echo -e "${RED}❌ Failed to delete S3 Tables bucket: $bucket_name${NC}"
            echo -e "${YELLOW}⚠️  This may be due to remaining tables or namespaces${NC}"
            echo -e "${BLUE}🔍 Listing bucket contents for debugging...${NC}"
            list_s3_tables_bucket_contents "$bucket_arn" "$bucket_name"
            return 1
        fi
    fi
}

# Function to clean up Glue catalog tables
cleanup_glue_catalog_tables() {
    local database_name="$1"
    local results_bucket="$2"

    echo -e "${BLUE}🗂️  Processing Glue catalog tables in database: $database_name${NC}"

    # Check if database exists
    if ! aws glue get-database --name "$database_name" --region "$REGION" >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Database does not exist: $database_name${NC}"
        return 0
    fi

    echo -e "${GREEN}✅ Database found: $database_name${NC}"

    # List of tables to clean up
    local tables=("package_entry" "package_revision" "package_tag")
    local successful_drops=0
    local failed_drops=0

    for table in "${tables[@]}"; do
        echo -e "${BLUE}🗑️  Deleting Glue table: $table${NC}"
        local delete_output
        local exit_code
        
        delete_output=$(aws glue delete-table --database-name "$database_name" --name "$table" --region "$REGION" 2>&1)
        exit_code=$?
        
        if [ $exit_code -eq 0 ]; then
            echo -e "${GREEN}✅ Successfully deleted table: $table${NC}"
            ((successful_drops++))
        elif echo "$delete_output" | grep -q "EntityNotFoundException.*not found"; then
            echo -e "${YELLOW}⚠️  Table already deleted: $table${NC}"
            ((successful_drops++))
        else
            echo -e "${RED}❌ Failed to delete table: $table${NC}"
            echo "$delete_output"
            ((failed_drops++))
        fi
    done

    echo -e "${BLUE}📋 Glue catalog cleanup summary: $successful_drops successful, $failed_drops failed${NC}"

    return 0
}

# Main execution
echo -e "${BLUE}🚀 Starting cleanup process...${NC}"
echo

# Handle glue-tables-only mode
if [ "$GLUE_TABLES_ONLY" = true ]; then
    echo -e "${BLUE}🗂️  Glue catalog tables only mode: Cleaning up catalog tables${NC}"
    if cleanup_glue_catalog_tables "$DATABASE_NAME" "$RESULTS_BUCKET"; then
        echo -e "${GREEN}🎉 Glue catalog tables cleanup completed!${NC}"
        exit 0
    else
        handle_error 1 "Glue catalog tables cleanup failed" "Check AWS credentials and permissions"
    fi
fi

# Handle dry-run mode
if [ "$CHECK_ONLY" = true ]; then
    echo -e "${BLUE}🔍 dry-run mode: Verifying S3 Tables bucket deletion status${NC}"
    if check_s3_tables_bucket_deletion "$S3_TABLES_BUCKET_ARN" "$S3_TABLES_BUCKET"; then
        exit 0
    else
        exit 1
    fi
fi

# Handle list-only mode
if [ "$LIST_ONLY" = true ]; then
    echo -e "${BLUE}📋 List-only mode: Showing bucket contents${NC}"
    
    if [ "$INCLUDE_GLUE_TABLES" = true ] && [ -n "$GLUE_TABLES_BUCKET" ]; then
        echo -e "${BLUE}🧹 Listing glue tables S3 bucket contents...${NC}"
        if aws s3api head-bucket --bucket "$GLUE_TABLES_BUCKET" --region "$REGION" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ Glue tables S3 bucket found: $GLUE_TABLES_BUCKET${NC}"
            aws s3 ls "s3://$GLUE_TABLES_BUCKET" --recursive --region "$REGION" --human-readable --summarize 2>/dev/null || echo "  Bucket is empty or not accessible"
        else
            echo -e "${YELLOW}⚠️  Glue tables S3 bucket not found: $GLUE_TABLES_BUCKET${NC}"
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

# Clean up Glue catalog tables (always, unless in special modes)
if [ "$CHECK_ONLY" = false ] && [ "$LIST_ONLY" = false ] && [ "$GLUE_TABLES_ONLY" = false ]; then
    echo -e "${BLUE}🗂️  Cleaning up Glue catalog tables...${NC}"
    cleanup_glue_catalog_tables "$DATABASE_NAME" "$RESULTS_BUCKET"
    echo
fi

# Clean up buckets based on flags
if [ "$INCLUDE_GLUE_TABLES" = true ]; then
    echo -e "${BLUE}🧹 Cleaning up glue tables S3 bucket...${NC}"
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
        echo -e "${BLUE}💡 Note: Glue tables S3 bucket was skipped. Use --destroy-glue-bucket to clean it.${NC}"
    fi
else
    echo -e "${GREEN}🎉 Full cleanup completed successfully!${NC}"
    echo -e "${BLUE}📝 Buckets and their contents have been completely removed.${NC}"
    if [ "$INCLUDE_GLUE_TABLES" = false ]; then
        echo -e "${BLUE}💡 Note: Glue tables S3 bucket was skipped. Use --destroy-glue-bucket to clean it.${NC}"
    fi
fi
