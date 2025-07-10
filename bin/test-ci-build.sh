#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Default values
VERSION="${VERSION:-test-$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo 'local')}"
CLEAN_START="true"
SKIP_TESTS="false"
SKIP_VALIDATION="false"

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# Usage information
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Test the complete CI/CD pipeline locally (simulates GitHub Actions workflow).

Optional Arguments:
    --version VERSION           Custom version (default: test-timestamp-commit)
    --no-clean                  Don't clean existing outputs before starting
    --skip-tests                Skip running tests
    --skip-validation           Skip artifact validation
    --help                      Show this help message

Examples:
    # Full CI/CD pipeline simulation
    $0

    # Test with custom version
    $0 --version v1.0.0-rc1

    # Quick test without cleaning
    $0 --no-clean --skip-validation

    # Fast iteration (skip tests and validation)
    $0 --skip-tests --skip-validation
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
            --no-clean)
                CLEAN_START="false"
                shift
                ;;
            --skip-tests)
                SKIP_TESTS="true"
                shift
                ;;
            --skip-validation)
                SKIP_VALIDATION="true"
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
}

# Clean previous outputs
cleanup_previous() {
    if [[ "$CLEAN_START" == "true" ]]; then
        log_step "Cleaning previous outputs..."
        rm -rf "$PROJECT_ROOT/cdk.out" "$PROJECT_ROOT/artifacts"
        log_success "Cleaned cdk.out/ and artifacts/ directories"
    else
        log_info "Skipping cleanup (--no-clean specified)"
    fi
}

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."
    
    local missing=()
    
    # Check Node.js and npm
    if ! command -v node &> /dev/null; then
        missing+=("Node.js")
    fi
    
    if ! command -v npm &> /dev/null; then
        missing+=("npm")
    fi
    
    # Check if we're in a git repository
    if ! git rev-parse --git-dir &> /dev/null; then
        log_warn "Not in a git repository - version may not include commit hash"
    fi
    
    # Check Python (for validation)
    if [[ "$SKIP_VALIDATION" == "false" ]] && ! command -v python3 &> /dev/null; then
        log_warn "Python3 not found - YAML validation will be skipped"
    fi
    
    # Check Terraform (for validation)
    if [[ "$SKIP_VALIDATION" == "false" ]] && ! command -v terraform &> /dev/null; then
        log_warn "Terraform not found - Terraform syntax validation will be skipped"
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing prerequisites: ${missing[*]}"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    log_step "Installing dependencies..."
    cd "$PROJECT_ROOT"
    npm ci
    log_success "Dependencies installed"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_info "Skipping tests (--skip-tests specified)"
        return
    fi
    
    log_step "Running tests..."
    cd "$PROJECT_ROOT"
    npm test
    log_success "Tests passed"
}

# Generate templates
generate_templates() {
    log_step "Generating infrastructure templates and Lambda package..."
    cd "$PROJECT_ROOT"
    npm run deploy:templates
    log_success "Templates generated in cdk.out/"
}

# Package artifacts
package_artifacts() {
    log_step "Packaging deployment artifacts..."
    cd "$PROJECT_ROOT"
    npm run deploy:package -- --version "$VERSION"
    log_success "Artifacts packaged in artifacts/"
}

# Validate artifacts
validate_artifacts() {
    if [[ "$SKIP_VALIDATION" == "true" ]]; then
        log_info "Skipping validation (--skip-validation specified)"
        return
    fi
    
    log_step "Validating deployment artifacts..."
    cd "$PROJECT_ROOT"
    ./bin/validate-artifacts.sh --version "$VERSION"
    log_success "Artifact validation passed"
}

# Create distribution packages
create_distribution_packages() {
    log_step "Creating distribution packages..."
    cd "$PROJECT_ROOT/artifacts"
    
    local packages_created=()
    
    # Create CloudFormation package
    if [[ -d "cloudformation-${VERSION}" ]]; then
        zip -r "titanic-cloudformation-${VERSION}.zip" "cloudformation-${VERSION}/" -q
        packages_created+=("titanic-cloudformation-${VERSION}.zip")
        log_success "Created: titanic-cloudformation-${VERSION}.zip"
    fi
    
    # Create Terraform package
    if [[ -d "terraform-${VERSION}" ]]; then
        zip -r "titanic-terraform-${VERSION}.zip" "terraform-${VERSION}/" -q
        packages_created+=("titanic-terraform-${VERSION}.zip")
        log_success "Created: titanic-terraform-${VERSION}.zip"
    fi
    
    if [[ ${#packages_created[@]} -eq 0 ]]; then
        log_warn "No distribution packages created"
    else
        log_success "Distribution packages created: ${packages_created[*]}"
    fi
}

# Show results
show_results() {
    log_step "Build Results Summary"
    echo
    echo -e "${CYAN}📦 Version:${NC} $VERSION"
    echo -e "${CYAN}📁 Location:${NC} $PROJECT_ROOT/artifacts/"
    echo
    
    # Show directory structure
    if [[ -d "$PROJECT_ROOT/artifacts" ]]; then
        echo -e "${CYAN}📋 Generated Artifacts:${NC}"
        find "$PROJECT_ROOT/artifacts" -type f | head -20 | while read -r file; do
            echo "  $(basename "$file")"
        done
        
        # Show ZIP files if they exist
        local zip_files=("$PROJECT_ROOT/artifacts"/*.zip)
        if [[ -e "${zip_files[0]}" ]]; then
            echo
            echo -e "${CYAN}📦 Distribution Packages:${NC}"
            for zip_file in "${zip_files[@]}"; do
                if [[ -f "$zip_file" ]]; then
                    local size=$(du -h "$zip_file" | cut -f1)
                    echo "  $(basename "$zip_file") ($size)"
                fi
            done
        fi
    fi
    
    echo
    echo -e "${GREEN}✅ CI/CD Pipeline Simulation Complete!${NC}"
    echo
    echo -e "${CYAN}🚀 Next Steps:${NC}"
    echo "  1. Test deployment: cd artifacts/cloudformation-$VERSION && ./deploy.sh"
    echo "  2. Or with Terraform: cd artifacts/terraform-$VERSION && ./deploy.sh"
    echo "  3. See doc/DEVELOP.md for more deployment options"
}

# Handle script interruption
cleanup_on_exit() {
    if [[ $? -ne 0 ]]; then
        log_error "CI/CD pipeline simulation failed!"
        echo
        echo -e "${YELLOW}💡 Tips for debugging:${NC}"
        echo "  - Check the error messages above"
        echo "  - Try with --skip-tests or --skip-validation for faster iteration"
        echo "  - Use --no-clean to preserve intermediate outputs"
        echo "  - Run individual npm scripts (deploy:templates, deploy:package, etc.)"
    fi
}

# Main function
main() {
    # Set up error handling
    trap cleanup_on_exit EXIT
    
    parse_args "$@"
    
    echo -e "${CYAN}🔧 Titanic ML Pipeline - CI/CD Simulation${NC}"
    echo -e "${CYAN}==========================================${NC}"
    echo
    
    cleanup_previous
    check_prerequisites
    install_dependencies
    run_tests
    generate_templates
    package_artifacts
    validate_artifacts
    create_distribution_packages
    show_results
}

# Run main function with all arguments
main "$@"
