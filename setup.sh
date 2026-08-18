#!/bin/bash

# ====================================================================
#  🚀 SSH PTY Terminal for Termux - Optimized Lightweight Setup
# ====================================================================

# ANSI Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' 

clear
echo -e "${CYAN}======================================================================${NC}"
echo -e "${GREEN}${BOLD}     🚀 SSH PTY Terminal for Termux Setup (Lightweight)       ${NC}"
echo -e "${CYAN}======================================================================${NC}"

# Check for Termux
IS_TERMUX=false
if [ -d "/data/data/com.termux" ]; then
    IS_TERMUX=true
    echo -e "${GREEN}✓ Termux environment detected.${NC}"
    
    # Check what is actually missing to avoid useless downloads
    MISSING_PKGS=""
    if ! command -v node &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS nodejs"
    fi
    if ! command -v sshd &> /dev/null; then
        MISSING_PKGS="$MISSING_PKGS openssh"
    fi
    
    if [ ! -z "$MISSING_PKGS" ]; then
        echo -e "${YELLOW}Installing missing packages:${NC}${BOLD}$MISSING_PKGS${NC}"
        # Only update pkg lists, do NOT upgrade everything (saves hundreds of MBs and RAM)
        apt update -y
        apt install -y $MISSING_PKGS
    else
        echo -e "${GREEN}✓ All required Termux packages (nodejs, openssh) are already installed.${NC}"
    fi
else
    echo -e "${YELLOW}! Non-Termux environment detected.${NC}"
    echo -e "${YELLOW}Please ensure 'node' and 'sshd' are installed manually.${NC}"
fi

# SSH Setup check
echo -e "${YELLOW}Verifying SSH Server state...${NC}"
if ! pgrep -x "sshd" > /dev/null; then
    echo -e "${YELLOW}Starting sshd...${NC}"
    sshd
else
    echo -e "${GREEN}✓ sshd is already running.${NC}"
fi

# Password Check (Termux specific)
if [ "$IS_TERMUX" = true ]; then
    echo -e "${YELLOW}Reminder: Ensure you have set a password using the 'passwd' command.${NC}"
fi

# Dependencies (optimized install to save internet data and memory)
if [ -f "package.json" ]; then
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing npm dependencies (Optimized - No Audits, No Funds)...${NC}"
        npm install --no-audit --no-fund --loglevel=error
    else
        echo -e "${GREEN}✓ node_modules found. Skipping npm install.${NC}"
    fi
fi

# Get Local IP
LOCAL_IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1)
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="localhost"
fi

echo -e "\n${GREEN}${BOLD}🎉 Setup Successfully Completed!${NC}"
echo -e "${CYAN}----------------------------------------------------------------------${NC}"
echo -e "${BOLD}To start the PTY Backend:${NC}"
echo -e "  Run: ${YELLOW}node server.js${NC}"
echo -e ""
echo -e "${BOLD}Access the Terminal UI:${NC}"
echo -e "  Local: ${CYAN}http://localhost:3000${NC}"
if [ "$LOCAL_IP" != "localhost" ]; then
    echo -e "  Network: ${CYAN}http://${LOCAL_IP}:3000${NC}"
fi
echo -e ""
echo -e "${BOLD}Connection Details:${NC}"
echo -e "  User: ${GREEN}$(whoami)${NC}"
echo -e "  Port: ${GREEN}8022${NC}"
echo -e ""
echo -e "${CYAN}======================================================================${NC}"
