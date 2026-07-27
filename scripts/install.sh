#!/usr/bin/env bash
# /**
#  * @file Installs the latest or selected vibecanvas binary release on the local machine.
#  */

set -euo pipefail

APP=vibecanvas
REPO="vibecanvas/vibecanvas"

# Colors
RED='\033[0;31m'
MUTED='\033[0;2m'
GREEN='\033[0;32m'
NC='\033[0m'

usage() {
    cat <<EOF
Vibecanvas Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 0.0.1)
    -c, --channel <name>    Release channel: stable, beta, nightly (default: stable)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://vibecanvas.dev/install | bash
    curl -fsSL https://vibecanvas.dev/install | bash -s -- --version 0.0.1
    curl -fsSL https://vibecanvas.dev/install | bash -s -- --channel beta
    ./scripts/install.sh --binary /path/to/vibecanvas
EOF
}

requested_version=""
channel="stable"
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            requested_version="${2:-}"
            if [[ -z "$requested_version" ]]; then
                echo -e "${RED}Error: --version requires an argument${NC}"
                exit 1
            fi
            shift 2
            ;;
        -c|--channel)
            channel="${2:-}"
            if [[ -z "$channel" ]]; then
                echo -e "${RED}Error: --channel requires an argument${NC}"
                exit 1
            fi
            if [[ "$channel" != "stable" && "$channel" != "beta" && "$channel" != "nightly" ]]; then
                echo -e "${RED}Error: --channel must be one of stable, beta, nightly${NC}"
                exit 1
            fi
            shift 2
            ;;
        -b|--binary)
            binary_path="${2:-}"
            if [[ -z "$binary_path" ]]; then
                echo -e "${RED}Error: --binary requires an argument${NC}"
                exit 1
            fi
            shift 2
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}" >&2
            shift
            ;;
    esac
done

hash_sha256() {
    local file=$1

    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
        return
    fi

    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | awk '{print $1}'
        return
    fi

    if command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$file" | awk '{print $NF}'
        return
    fi

    echo -e "${RED}No SHA-256 tool found (sha256sum, shasum, openssl)${NC}" >&2
    exit 1
}

verify_binary_checksum() {
    local binary_file=$1
    local checksum_file=$2

    if [[ ! -f "$checksum_file" ]]; then
        return 1
    fi

    local expected actual
    expected=$(awk '{print $1}' "$checksum_file" | tr -d '\r\n')
    if [[ -z "$expected" ]]; then
        echo -e "${RED}Checksum file is empty or malformed: $checksum_file${NC}"
        exit 1
    fi

    actual=$(hash_sha256 "$binary_file")
    if [[ "$actual" != "$expected" ]]; then
        echo -e "${RED}Checksum verification failed${NC}"
        echo -e "${RED}Expected: $expected${NC}"
        echo -e "${RED}Actual:   $actual${NC}"
        exit 1
    fi

    echo -e "${GREEN}Checksum verified${NC}"
    return 0
}

INSTALL_DIR="${VIBECANVAS_INSTALL_DIR:-$HOME/.vibecanvas/bin}"
VIBECANVAS_HOME="$(dirname "$INSTALL_DIR")"
NATIVE_DIR="${VIBECANVAS_NATIVE_DIR:-$VIBECANVAS_HOME/native}"
MIGRATIONS_DIR="${VIBECANVAS_MIGRATIONS_DIR:-$VIBECANVAS_HOME/database-migrations}"
mkdir -p "$INSTALL_DIR"

validate_candidate() {
    local candidate=$1
    local expected_version=$2
    chmod 755 "$candidate"

    if [[ "$(uname -s)" == Darwin* ]]; then
        if ! codesign --verify --deep --strict --verbose=4 "$candidate" 2>&1; then
            echo -e "${RED}Candidate has an invalid macOS signature; installed version was not changed${NC}" >&2
            return 1
        fi
    fi

    local output_file="$tmp_dir/candidate-version.txt"
    local error_file="$tmp_dir/candidate-error.txt"
    VIBECANVAS_DISABLE_AUTOUPDATE=1 \
      VIBECANVAS_HOME="$tmp_dir/vibecanvas-home" \
      "$candidate" --version >"$output_file" 2>"$error_file" &
    local candidate_pid=$!
    local elapsed=0
    while kill -0 "$candidate_pid" 2>/dev/null && [[ "$elapsed" -lt 80 ]]; do
        sleep 0.1
        elapsed=$((elapsed + 1))
    done
    if kill -0 "$candidate_pid" 2>/dev/null; then
        kill -KILL "$candidate_pid" 2>/dev/null || true
        echo -e "${RED}Candidate startup timed out after 8s; installed version was not changed${NC}" >&2
        return 1
    fi
    if ! wait "$candidate_pid"; then
        echo -e "${RED}Candidate failed to start: $(cat "$error_file")${NC}" >&2
        return 1
    fi
    local reported_version
    reported_version=$(tr -d '\r\n' < "$output_file")
    if [[ "$expected_version" != "local" && "$reported_version" != "$expected_version" ]]; then
        echo -e "${RED}Candidate version mismatch: expected $expected_version, received ${reported_version:-<empty>}${NC}" >&2
        return 1
    fi
}

install_candidate_unit() {
    local candidate_binary=$1
    local candidate_native=${2:-}
    local installed_binary="$INSTALL_DIR/vibecanvas"
    local backup_binary="$INSTALL_DIR/.vibecanvas.upgrade-backup"
    local backup_native="$VIBECANVAS_HOME/.native.upgrade-backup"
    local staged_binary="$INSTALL_DIR/.vibecanvas.upgrade-new"
    local staged_native="$VIBECANVAS_HOME/.native.upgrade-new"

    rm -f "$backup_binary" "$staged_binary"
    rm -rf "$backup_native" "$staged_native"
    [[ ! -f "$installed_binary" ]] || cp "$installed_binary" "$backup_binary"
    [[ ! -d "$NATIVE_DIR" ]] || cp -R "$NATIVE_DIR" "$backup_native"
    cp "$candidate_binary" "$staged_binary"
    chmod 755 "$staged_binary"
    [[ -z "$candidate_native" ]] || cp -R "$candidate_native" "$staged_native"

    if ! mv -f "$staged_binary" "$installed_binary" || \
       { [[ -n "$candidate_native" ]] && { rm -rf "$NATIVE_DIR"; ! mv "$staged_native" "$NATIVE_DIR"; }; }; then
        [[ ! -f "$backup_binary" ]] || cp "$backup_binary" "$installed_binary"
        rm -rf "$NATIVE_DIR"
        [[ ! -d "$backup_native" ]] || cp -R "$backup_native" "$NATIVE_DIR"
        echo -e "${RED}Installation failed and the previous installation was restored${NC}" >&2
        return 1
    fi
    rm -f "$backup_binary"
    rm -rf "$backup_native"
}

copy_migrations() {
    local source_dir=$1

    if [[ ! -d "$source_dir" ]]; then
        return 1
    fi

    rm -rf "$MIGRATIONS_DIR"
    mkdir -p "$(dirname "$MIGRATIONS_DIR")"
    cp -R "$source_dir" "$MIGRATIONS_DIR"
    echo -e "${GREEN}Installed database migrations${NC}"
    return 0
}

# Skip platform detection if using local binary
if [[ -n "$binary_path" ]]; then
    if [[ ! -f "$binary_path" ]]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    # Detect OS
    raw_os=$(uname -s)
    case "$raw_os" in
        Darwin*) os="darwin" ;;
        Linux*) os="linux" ;;
        MINGW*|MSYS*|CYGWIN*)
            echo -e "${RED}Unsupported OS: Windows builds are not published for Vibecanvas.${NC}"
            exit 1
            ;;
        *)
            echo -e "${RED}Unsupported OS: $raw_os${NC}"
            exit 1
            ;;
    esac

    # Detect architecture
    arch=$(uname -m)
    case "$arch" in
        aarch64|arm64) arch="arm64" ;;
        x86_64) arch="x64" ;;
        *)
            echo -e "${RED}Unsupported architecture: $arch${NC}"
            exit 1
            ;;
    esac

    # Rosetta 2 detection (macOS running x64 terminal under ARM)
    if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
        rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
        if [[ "$rosetta_flag" == "1" ]]; then
            arch="arm64"
            echo -e "${MUTED}Detected Rosetta 2, using arm64 binary${NC}"
        fi
    fi

    # musl detection (Alpine Linux)
    is_musl=false
    if [[ "$os" == "linux" ]]; then
        if [[ -f /etc/alpine-release ]]; then
            is_musl=true
        elif command -v ldd >/dev/null 2>&1; then
            if ldd --version 2>&1 | grep -qi musl; then
                is_musl=true
            fi
        fi
    fi

    # AVX2 detection (baseline for older CPUs)
    needs_baseline=false
    if [[ "$arch" == "x64" ]]; then
        if [[ "$os" == "linux" ]]; then
            if ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then
                needs_baseline=true
            fi
        elif [[ "$os" == "darwin" ]]; then
            avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0)
            if [[ "$avx2" != "1" ]]; then
                needs_baseline=true
            fi
        fi
    fi

    # Build target name
    target="$os-$arch"
    if [[ "$needs_baseline" == "true" ]]; then
        target="$target-baseline"
    fi
    if [[ "$is_musl" == "true" ]]; then
        target="$target-musl"
    fi

    # Archive format
    archive_ext=".tar.gz"

    package_name="$APP-$target"
    filename="$package_name$archive_ext"

    # Get version
    if [[ -z "$requested_version" ]]; then
        releases_json=$(curl -s "https://api.github.com/repos/$REPO/releases?per_page=50")
        if [[ "$channel" == "stable" ]]; then
            echo -e "${MUTED}Fetching latest stable version...${NC}"
            release_tag=$(printf '%s' "$releases_json" | grep -Eo '"tag_name"[[:space:]]*:[[:space:]]*"vibecanvas-v[0-9]+\.[0-9]+\.[0-9]+"' | sed -n '1s/.*"\(vibecanvas-v[^" ]*\)"/\1/p')
        else
            echo -e "${MUTED}Fetching latest ${channel} version...${NC}"
            release_tag=$(printf '%s' "$releases_json" | grep -Eo "\"tag_name\"[[:space:]]*:[[:space:]]*\"vibecanvas-v[^\"]*${channel}[^\"]*\"" | sed -n '1s/.*"\(vibecanvas-v[^" ]*\)"/\1/p')
        fi

        if [[ -z "${release_tag:-}" ]]; then
            echo -e "${RED}Failed to fetch latest ${channel} version${NC}"
            echo -e "${MUTED}Check: https://github.com/$REPO/releases${NC}"
            exit 1
        fi
        specific_version="${release_tag#vibecanvas-v}"
        url="https://github.com/$REPO/releases/download/${release_tag}/$filename"
    else
        requested_version="${requested_version#vibecanvas-v}"
        requested_version="${requested_version#v}"
        specific_version="$requested_version"
        release_tag="vibecanvas-v${requested_version}"

        # Verify release exists
        http_status=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/$REPO/releases/tag/${release_tag}")
        if [[ "$http_status" == "404" ]]; then
            echo -e "${RED}Error: Release ${release_tag} not found${NC}"
            echo -e "${MUTED}Available releases: https://github.com/$REPO/releases${NC}"
            exit 1
        fi
        url="https://github.com/$REPO/releases/download/${release_tag}/$filename"
    fi

    # Check if already installed with same version
    if command -v vibecanvas >/dev/null 2>&1; then
        installed_version=$(vibecanvas --version 2>/dev/null || echo "")
        if [[ "$installed_version" == "$specific_version" ]]; then
            echo -e "${MUTED}Version ${NC}$specific_version${MUTED} already installed${NC}"
            exit 0
        fi
        if [[ -n "$installed_version" ]]; then
            echo -e "${MUTED}Upgrading from ${NC}$installed_version${MUTED} to ${NC}$specific_version"
        fi
    fi
fi

# Install
if [[ -n "$binary_path" ]]; then
    echo -e "\n${MUTED}Installing from: ${NC}$binary_path"
    tmp_dir="${TMPDIR:-/tmp}/vibecanvas_install_$$"
    mkdir -p "$tmp_dir"
    trap "rm -rf '$tmp_dir'" EXIT
    validate_candidate "$binary_path" "local"
    install_candidate_unit "$binary_path" ""
else
    echo -e "\n${MUTED}Installing vibecanvas ${NC}$specific_version${MUTED} for ${NC}$target"

    tmp_dir="${TMPDIR:-/tmp}/vibecanvas_install_$$"
    mkdir -p "$tmp_dir"
    trap "rm -rf '$tmp_dir'" EXIT

    echo -e "${MUTED}Downloading...${NC}"
    if ! curl -# -fL -o "$tmp_dir/$filename" "$url"; then
        echo -e "${RED}Failed to download $filename${NC}"
        echo -e "${MUTED}URL: $url${NC}"
        exit 1
    fi

    echo -e "${MUTED}Extracting...${NC}"
    tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"

    # Find the binary (might be in root or in bin/)
    binary_candidate=""
    if [[ -f "$tmp_dir/vibecanvas" ]]; then
        binary_candidate="$tmp_dir/vibecanvas"
    elif [[ -f "$tmp_dir/bin/vibecanvas" ]]; then
        binary_candidate="$tmp_dir/bin/vibecanvas"
    elif [[ -f "$tmp_dir/vibecanvas.exe" ]]; then
        binary_candidate="$tmp_dir/vibecanvas.exe"
    elif [[ -f "$tmp_dir/bin/vibecanvas.exe" ]]; then
        binary_candidate="$tmp_dir/bin/vibecanvas.exe"
    else
        echo -e "${RED}Could not find vibecanvas binary in archive${NC}"
        exit 1
    fi

    checksum_verified=false
    for checksum_candidate in \
        "$tmp_dir/vibecanvas.sha256" \
        "$tmp_dir/bin/vibecanvas.sha256" \
        "$tmp_dir/vibecanvas.exe.sha256" \
        "$tmp_dir/bin/vibecanvas.exe.sha256"
    do
        if verify_binary_checksum "$binary_candidate" "$checksum_candidate"; then
            checksum_verified=true
            break
        fi
    done

    if [[ "$checksum_verified" != "true" ]]; then
        checksum_url="https://github.com/$REPO/releases/download/vibecanvas-v${specific_version}/${package_name}.sha256"
        echo -e "${MUTED}Downloading checksum...${NC}"
        if curl -fsSL -o "$tmp_dir/${package_name}.sha256" "$checksum_url"; then
            verify_binary_checksum "$binary_candidate" "$tmp_dir/${package_name}.sha256"
            checksum_verified=true
        else
            echo -e "${RED}Failed to download checksum file${NC}"
            echo -e "${MUTED}URL: $checksum_url${NC}"
            exit 1
        fi
    fi

    native_installed=false
    native_source=""
    for native_candidate in \
        "$tmp_dir/native" \
        "$tmp_dir/package/native" \
        "$tmp_dir"/*/native
    do
        if [[ -d "$native_candidate" ]]; then
            native_source="$native_candidate"
            native_installed=true
            break
        fi
    done

    if [[ "$native_installed" != "true" ]]; then
        echo -e "${RED}Could not find native addon directory in archive${NC}"
        exit 1
    fi

    echo -e "${MUTED}Validating candidate...${NC}"
    validate_candidate "$binary_candidate" "$specific_version"
    install_candidate_unit "$binary_candidate" "$native_source"
    echo -e "${GREEN}Installed validated binary and native addons${NC}"

    migrations_installed=false
    for migrations_candidate in \
        "$tmp_dir/database-migrations" \
        "$tmp_dir/package/database-migrations" \
        "$tmp_dir"/*/database-migrations
    do
        if copy_migrations "$migrations_candidate"; then
            migrations_installed=true
            break
        fi
    done

    if [[ "$migrations_installed" != "true" ]]; then
        echo -e "${MUTED}No migration directory found in archive. Embedded migrations will be used if present.${NC}"
    fi
fi

chmod 755 "$INSTALL_DIR/vibecanvas"

# PATH configuration
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        return 0
    fi

    if [[ -w "$config_file" ]]; then
        echo "" >> "$config_file"
        echo "# vibecanvas" >> "$config_file"
        echo "$command" >> "$config_file"
        echo -e "${MUTED}Added to PATH in ${NC}$config_file"
        return 0
    fi

    return 1
}

path_added=false
if [[ "$no_modify_path" != "true" ]] && [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    current_shell=$(basename "$SHELL")

    case $current_shell in
        fish)
            config="$HOME/.config/fish/config.fish"
            if [[ -f "$config" ]]; then
                add_to_path "$config" "fish_add_path $INSTALL_DIR" && path_added=true
            fi
            ;;
        zsh)
            config="${ZDOTDIR:-$HOME}/.zshrc"
            if [[ -f "$config" ]]; then
                add_to_path "$config" "export PATH=\"$INSTALL_DIR:\$PATH\"" && path_added=true
            fi
            ;;
        bash)
            for config in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
                if [[ -f "$config" ]]; then
                    add_to_path "$config" "export PATH=\"$INSTALL_DIR:\$PATH\"" && path_added=true
                    break
                fi
            done
            ;;
        *)
            config="$HOME/.profile"
            if [[ -f "$config" ]]; then
                add_to_path "$config" "export PATH=\"$INSTALL_DIR:\$PATH\"" && path_added=true
            fi
            ;;
    esac

    if [[ "$path_added" != "true" ]]; then
        echo ""
        echo -e "${MUTED}Add vibecanvas to your PATH:${NC}"
        echo ""
        echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
        echo "" Reload your shell and call vibecanvas
        echo ""
    fi
fi

# GitHub Actions support
if [[ "${GITHUB_ACTIONS:-}" == "true" ]] && [[ -n "${GITHUB_PATH:-}" ]]; then
    echo "$INSTALL_DIR" >> "$GITHUB_PATH"
    echo -e "${MUTED}Added to \$GITHUB_PATH${NC}"
fi

echo ""
echo -e "${GREEN}vibecanvas installed successfully!${NC}"
echo ""
echo -e "${MUTED}To start:${NC}"
echo "  cd <your-project>"
echo "  vibecanvas"
echo ""
echo -e "${MUTED}Documentation: ${NC}https://vibecanvas.dev/docs"
echo ""
