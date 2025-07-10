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

# Create isolated test environment
ISOLATED_ENV="${ISOLATED_ENV:-true}"
TEST_WORKSPACE=""

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
    --isolated                  Use isolated environment (default: true)
    --no-isolated               Use current directory (faster, less realistic)
    --workspace DIR             Use specific workspace directory
    --help                      Show this help message

Examples:
    # Full CI/CD pipeline simulation (isolated environment)
    $0

    # Test with custom version in isolated environment
    $0 --version v1.0.0-rc1

    # Quick test without cleaning (still isolated)
    $0 --no-clean --skip-validation

    # Fast iteration in current directory (not isolated)
    $0 --no-isolated --skip-tests --skip-validation
    
    # Use specific workspace directory
    $0 --workspace /tmp/my-test-workspace
    
    # Debug mode - run in current directory with all steps
    $0 --no-isolated --no-clean
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
            --isolated)
                ISOLATED_ENV="true"
                shift
                ;;
            --no-isolated)
                ISOLATED_ENV="false"
                shift
                ;;
            --workspace)
                TEST_WORKSPACE="$2"
                ISOLATED_ENV="false"
                shift 2
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

# Create isolated test environment
setup_isolated_environment() {
    if [[ "$ISOLATED_ENV" == "true" ]]; then
        log_step "Setting up isolated test environment..."
        
        # Create temporary workspace
        TEST_WORKSPACE=$(mktemp -d -t titanic-ci-test-XXXXXX)
        log_info "Created isolated workspace: $TEST_WORKSPACE"
        
        # Copy source files (excluding outputs and dependencies)
        rsync -av --exclude='node_modules' \
                  --exclude='cdk.out' \
                  --exclude='artifacts' \
                  --exclude='dist' \
                  --exclude='coverage' \
                  --exclude='.git' \
                  --exclude='test-results' \
                  "$PROJECT_ROOT/" "$TEST_WORKSPACE/"
        
        # Preserve essential environment variables for CDK (handle unset variables safely)
        PRESERVED_QUILT_DATABASE_NAME="${QUILT_DATABASE_NAME:-}"
        PRESERVED_USE_S3_TABLE="${USE_S3_TABLE:-}"
        
        # Clear problematic environment variables that might affect build
        unset AWS_PROFILE
        unset AWS_ACCESS_KEY_ID
        unset AWS_SECRET_ACCESS_KEY
        unset AWS_SESSION_TOKEN
        unset CDK_DEFAULT_ACCOUNT
        unset CDK_DEFAULT_REGION
        
        # Set minimal CI-like environment
        export CI=true
        export NODE_ENV=production
        export HOME="$TEST_WORKSPACE"
        
        # Restore essential environment variables (use defaults if not set)
        export QUILT_DATABASE_NAME="${PRESERVED_QUILT_DATABASE_NAME:-titanic-source-db}"
        export USE_S3_TABLE="${PRESERVED_USE_S3_TABLE:-false}"
        
        # Update PROJECT_ROOT to point to isolated environment
        PROJECT_ROOT="$TEST_WORKSPACE"
        
        log_success "Isolated environment ready"
    elif [[ -n "$TEST_WORKSPACE" ]]; then
        log_step "Using specified workspace: $TEST_WORKSPACE"
        PROJECT_ROOT="$TEST_WORKSPACE"
    else
        log_info "Using current directory (--no-isolated specified)"
    fi
}

# Clean up isolated environment
cleanup_isolated_environment() {
    if [[ "$ISOLATED_ENV" == "true" && -n "$TEST_WORKSPACE" && -d "$TEST_WORKSPACE" ]]; then
        log_step "Cleaning up isolated environment..."
        rm -rf "$TEST_WORKSPACE"
        log_success "Isolated environment cleaned up"
    fi
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
    
    # Use npm ci for clean, reproducible installs (like CI environments)
    if [[ "$ISOLATED_ENV" == "true" ]]; then
        # Remove package-lock.json to ensure fresh resolution
        rm -f package-lock.json
        npm install --production=false
    else
        npm ci
    fi
    
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
    
    # Use direct npm test instead of npm script to avoid inheritance issues
    npm test
    log_success "Tests passed"
}

# Generate templates
generate_templates() {
    log_step "Generating infrastructure templates and Lambda package..."
    cd "$PROJECT_ROOT"
    
    # Call script directly instead of through npm
    "$PROJECT_ROOT/bin/generate-templates.sh"
    log_success "Templates generated in cdk.out/"
}

# Package artifacts
package_artifacts() {
    log_step "Packaging deployment artifacts..."
    cd "$PROJECT_ROOT"
    
    # Call script directly instead of through npm
    "$PROJECT_ROOT/bin/package-artifacts.sh" --version "$VERSION"
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

# Validate template defaults and deploy script requirements
validate_template_and_deploy() {
    log_step "Validating template defaults and deploy script requirements..."
    cd "$PROJECT_ROOT/artifacts"
    
    local version_dir=""
    if [[ -d "cloudformation-${VERSION}" ]]; then
        version_dir="cloudformation-${VERSION}"
    else
        log_error "CloudFormation artifacts not found"
        return 1
    fi
    
    cd "$version_dir"
    
    # Test 1: Validate template has proper defaults
    log_info "Testing CloudFormation template defaults..."
    local template_defaults_test=$(mktemp)
    
    # Extract parameter defaults from template
    python3 -c "
import yaml
import sys

# Add CloudFormation tag constructors to handle intrinsic functions
def cloudformation_constructor(loader, tag_suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    elif isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)

# Register constructors for CloudFormation intrinsic functions
yaml.SafeLoader.add_multi_constructor('!', cloudformation_constructor)

with open('template.yaml', 'r') as f:
    template = yaml.safe_load(f)

parameters = template.get('Parameters', {})
defaults = {}
for param, config in parameters.items():
    if 'Default' in config:
        defaults[param] = config['Default']

# Check that all expected defaults exist
expected_defaults = {
    'UseS3Tables': 'false',
    'GlueDatabaseName': 'titanic-glue-db', 
    'LambdaCodeKey': 'lambda-package.zip'
}

missing_defaults = []
for param, expected_value in expected_defaults.items():
    if param not in defaults:
        missing_defaults.append(f'{param} (no default)')
    elif defaults[param] != expected_value:
        missing_defaults.append(f'{param} (expected {expected_value}, got {defaults[param]})')

if missing_defaults:
    print('FAIL: Missing or incorrect template defaults:')
    for missing in missing_defaults:
        print(f'  - {missing}')
    sys.exit(1)
else:
    print('PASS: All template defaults are correct')
" 2>&1 | tee "$template_defaults_test"
    
    if grep -q "FAIL" "$template_defaults_test"; then
        log_error "Template defaults validation failed"
        cat "$template_defaults_test"
        rm -f "$template_defaults_test"
        return 1
    fi
    
    # Test 2: Validate deploy script rejects dummy defaults
    log_info "Testing deploy script rejects template defaults..."
    local deploy_test_output=$(mktemp)
    
    # Should fail when using dummy defaults
    if ./deploy.sh --stack-name test-stack --lambda-bucket titanic-lambda-deployments 2>&1 | tee "$deploy_test_output"; then
        log_error "Deploy script should have rejected dummy default 'titanic-lambda-deployments'"
        cat "$deploy_test_output"
        rm -f "$deploy_test_output"
        return 1
    fi
    
    if ! grep -q "cannot use template default value" "$deploy_test_output"; then
        log_error "Deploy script failed but didn't show expected error message"
        cat "$deploy_test_output"
        rm -f "$deploy_test_output"
        return 1
    fi
    
    # Test 3: Validate deploy script requires all parameters
    log_info "Testing deploy script requires all parameters..."
    local missing_params_output=$(mktemp)
    
    if ./deploy.sh 2>&1 | tee "$missing_params_output"; then
        log_error "Deploy script should have failed due to missing required parameters"
        cat "$missing_params_output"
        rm -f "$missing_params_output"
        return 1
    fi
    
    if ! grep -q "stack-name is required" "$missing_params_output"; then
        log_error "Deploy script should require --stack-name parameter"
        cat "$missing_params_output"
        rm -f "$missing_params_output"
        return 1
    fi
    
    if ! grep -q "lambda-bucket is required" "$missing_params_output"; then
        log_error "Deploy script should require --lambda-bucket parameter"
        cat "$missing_params_output"
        rm -f "$missing_params_output"
        return 1
    fi
    
    # Test 4: Validate deploy script accepts production values
    log_info "Testing deploy script accepts production values..."
    local prod_test_output=$(mktemp)
    
    # Mock the AWS CLI for testing (dry run)
    export AWS_CLI_MOCK=true
    cat > aws << 'EOF'
#!/bin/bash
case "$1" in
    "sts")
        if [[ "$2" == "get-caller-identity" ]]; then
            echo '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/test","UserId":"test"}'
        fi
        ;;
    "cloudformation")
        if [[ "$2" == "deploy" ]]; then
            echo "Mock: CloudFormation deployment successful"
        elif [[ "$2" == "describe-stacks" ]]; then
            echo "Mock: Stack outputs"
        fi
        ;;
esac
EOF
    chmod +x aws
    export PATH="$PWD:$PATH"
    
    # This should succeed with production values
    if ! ./deploy.sh --stack-name prod-titanic \
                    --lambda-bucket prod-lambda-deployments \
                    --glue-db prod-source-db 2>&1 | tee "$prod_test_output"; then
        log_error "Deploy script should accept valid production values"
        cat "$prod_test_output"
        rm -f aws "$prod_test_output"
        return 1
    fi
    
    if ! grep -q "Mock: CloudFormation deployment successful" "$prod_test_output"; then
        log_error "Deploy script didn't reach CloudFormation deployment"
        cat "$prod_test_output"
        rm -f aws "$prod_test_output"
        return 1
    fi
    
    # Cleanup
    rm -f aws "$template_defaults_test" "$deploy_test_output" "$missing_params_output" "$prod_test_output"
    unset AWS_CLI_MOCK
    
    log_success "Template defaults and deploy script validation passed!"
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
    local exit_code=$?
    
    # Clean up isolated environment if it exists
    cleanup_isolated_environment
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "CI/CD pipeline simulation failed!"
        echo
        echo -e "${YELLOW}💡 Tips for debugging:${NC}"
        echo "  - Check the error messages above"
        echo "  - Try with --skip-tests or --skip-validation for faster iteration"
        echo "  - Use --no-clean to preserve intermediate outputs"
        echo "  - Use --no-isolated to run in current directory for debugging"
        echo "  - Run individual scripts directly: bin/generate-templates.sh, bin/package-artifacts.sh, etc."
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
    
    if [[ "$ISOLATED_ENV" == "true" ]]; then
        echo -e "${CYAN}🔒 Running in isolated environment${NC}"
    else
        echo -e "${YELLOW}⚠️  Running in current directory${NC}"
    fi
    echo
    
    setup_isolated_environment
    cleanup_previous
    check_prerequisites
    install_dependencies
    run_tests
    generate_templates
    package_artifacts
    validate_artifacts
    validate_template_and_deploy
    create_distribution_packages
    show_results
}

# Run main function with all arguments
main "$@"
