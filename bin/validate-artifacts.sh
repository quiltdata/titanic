#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ARTIFACTS_DIR="$PROJECT_ROOT/artifacts"

# Default values
VERSION=""
VALIDATE_CF="true"
VALIDATE_TF="true"
VALIDATE_ZIPS="true"
AUTO_DETECT_VERSION="false"

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Usage information
usage() {
    cat << EOF
Usage: $0 --version VERSION [OPTIONS]

Validate deployment artifacts for Titanic ML Pipeline.

Required Arguments:
    --version VERSION           Version to validate (or --auto-detect)

Optional Arguments:
    --auto-detect              Auto-detect latest version from artifacts directory
    --no-cloudformation        Skip CloudFormation validation
    --no-terraform             Skip Terraform validation  
    --no-zip                   Skip ZIP validation
    --help                     Show this help message

Examples:
    # Validate all artifacts for a version
    $0 --version v1.0.0

    # Validate only CloudFormation
    $0 --version v1.0.0 --no-terraform --no-zip
EOF
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --version)
                VERSION="$2"
                shift 2
                ;;
            --auto-detect)
                AUTO_DETECT_VERSION="true"
                shift
                ;;
            --no-cloudformation)
                VALIDATE_CF="false"
                shift
                ;;
            --no-terraform)
                VALIDATE_TF="false"
                shift
                ;;
            --no-zip)
                VALIDATE_ZIPS="false"
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Validate required arguments
    if [[ -z "$VERSION" && "$AUTO_DETECT_VERSION" == "false" ]]; then
        log_error "Version is required. Use --version VERSION or --auto-detect"
        usage
        exit 1
    fi
}

# Validate CloudFormation artifacts
validate_cloudformation() {
    if [[ "$VALIDATE_CF" == "false" ]]; then
        return
    fi

    log_info "Validating CloudFormation artifacts..."
    
    local cf_dir="$ARTIFACTS_DIR/cloudformation-$VERSION"
    
    # Check required files exist
    if [[ ! -f "$cf_dir/template.yaml" ]]; then
        log_error "Missing template.yaml in $cf_dir"
        exit 1
    fi
    
    if [[ ! -f "$cf_dir/lambda-package.zip" ]]; then
        log_error "Missing lambda-package.zip in $cf_dir"
        exit 1
    fi
    
    if [[ ! -f "$cf_dir/deploy.sh" ]]; then
        log_error "Missing deploy.sh in $cf_dir"
        exit 1
    fi
    
    if [[ ! -f "$cf_dir/README.md" ]]; then
        log_error "Missing README.md in $cf_dir"
        exit 1
    fi
    
    # Check deploy.sh is executable
    if [[ ! -x "$cf_dir/deploy.sh" ]]; then
        log_error "deploy.sh is not executable in $cf_dir"
        exit 1
    fi
    
    # Validate CloudFormation template YAML syntax
    if command -v python3 &> /dev/null; then
        # Use a simple check that handles CloudFormation YAML tags
        python3 -c "
import yaml
import sys

class CloudFormationLoader(yaml.SafeLoader):
    pass

# Add constructors for CloudFormation intrinsic functions
cf_constructors = [
    '!Ref', '!GetAtt', '!Join', '!Split', '!Select', '!Sub', '!Base64',
    '!GetAZs', '!ImportValue', '!FindInMap', '!Condition', '!If',
    '!Not', '!Equals', '!And', '!Or'
]

for constructor in cf_constructors:
    CloudFormationLoader.add_constructor(constructor, lambda loader, node: None)

try:
    with open('$cf_dir/template.yaml', 'r') as f:
        yaml.load(f, Loader=CloudFormationLoader)
    print('CloudFormation YAML syntax valid')
except Exception as e:
    print(f'CloudFormation YAML syntax error: {e}')
    sys.exit(1)
"
    else
        log_warn "Python3 not available, skipping YAML syntax validation"
    fi
    
    log_success "CloudFormation artifacts validation passed ✅"
}

# Validate Terraform artifacts
validate_terraform() {
    if [[ "$VALIDATE_TF" == "false" ]]; then
        return
    fi

    log_info "Validating Terraform artifacts..."
    
    local tf_dir="$ARTIFACTS_DIR/terraform-$VERSION"
    
    # Check required files exist
    if [[ ! -f "$tf_dir/main.tf" ]]; then
        log_error "Missing main.tf in $tf_dir"
        exit 1
    fi
    
    if [[ ! -f "$tf_dir/variables.tf" ]]; then
        log_error "Missing variables.tf in $tf_dir"
        exit 1
    fi
    
    if [[ ! -f "$tf_dir/outputs.tf" ]]; then
        log_error "Missing outputs.tf in $tf_dir"
        exit 1
    fi
    
    if [[ ! -f "$tf_dir/lambda-package.zip" ]]; then
        log_error "Missing lambda-package.zip in $tf_dir"
        exit 1
    fi
    
    if [[ ! -f "$tf_dir/deploy.sh" ]]; then
        log_error "Missing deploy.sh in $tf_dir"
        exit 1
    fi
    
    if [[ ! -f "$tf_dir/README.md" ]]; then
        log_error "Missing README.md in $tf_dir"
        exit 1
    fi
    
    # Check deploy.sh is executable
    if [[ ! -x "$tf_dir/deploy.sh" ]]; then
        log_error "deploy.sh is not executable in $tf_dir"
        exit 1
    fi
    
    # Validate Terraform configuration syntax (if terraform is available)
    if command -v terraform &> /dev/null; then
        cd "$tf_dir"
        terraform init -backend=false > /dev/null
        terraform validate
        cd "$PROJECT_ROOT"
    else
        log_warn "Terraform not available, skipping syntax validation"
    fi
    
    log_success "Terraform artifacts validation passed ✅"
}

# Validate ZIP packages
validate_zips() {
    if [[ "$VALIDATE_ZIPS" == "false" ]]; then
        return
    fi

    log_info "Validating ZIP packages..."
    
    # Test ZIP files can be extracted
    local cf_zip="$ARTIFACTS_DIR/titanic-cloudformation-$VERSION.zip"
    local tf_zip="$ARTIFACTS_DIR/titanic-terraform-$VERSION.zip"
    
    if [[ -f "$cf_zip" ]]; then
        unzip -t "$cf_zip" > /dev/null
        log_success "CloudFormation ZIP validation passed"
    else
        log_warn "CloudFormation ZIP not found: $cf_zip"
    fi
    
    if [[ -f "$tf_zip" ]]; then
        unzip -t "$tf_zip" > /dev/null
        log_success "Terraform ZIP validation passed"
    else
        log_warn "Terraform ZIP not found: $tf_zip"
    fi
    
    log_success "ZIP packages validation passed ✅"
}

# Main function
main() {
    parse_args "$@"
    
    # Auto-detect version if requested
    if [[ "$AUTO_DETECT_VERSION" == "true" ]]; then
        if [[ ! -d "$ARTIFACTS_DIR" ]]; then
            log_error "Artifacts directory not found: $ARTIFACTS_DIR"
            exit 1
        fi
        
        # Find the most recent cloudformation directory
        VERSION=$(ls -1 "$ARTIFACTS_DIR" | grep "^cloudformation-" | sed 's/^cloudformation-//' | sort -V | tail -1)
        
        if [[ -z "$VERSION" ]]; then
            log_error "No CloudFormation artifacts found in $ARTIFACTS_DIR"
            exit 1
        fi
        
        log_info "Auto-detected version: $VERSION"
    fi
    
    log_info "Validating Titanic ML Pipeline artifacts"
    log_info "Version: $VERSION"
    log_info "Artifacts directory: $ARTIFACTS_DIR"
    
    # Check artifacts directory exists
    if [[ ! -d "$ARTIFACTS_DIR" ]]; then
        log_error "Artifacts directory not found: $ARTIFACTS_DIR"
        log_error "Run 'npm run deploy:package -- $VERSION' first"
        exit 1
    fi
    
    validate_cloudformation
    validate_terraform
    validate_zips
    
    log_success "All artifact validation completed successfully! 🎉"
}

# Run main function with all arguments
main "$@"
