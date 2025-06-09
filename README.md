# LLM_DATA_LEAKAGE_MONITOR

# Sensitive Data Blocker Chrome Extension

This Chrome extension helps protect sensitive data by detecting and masking potential API keys, passwords, and other sensitive information across websites.

## Features

- Real-time detection of sensitive data patterns
- Automatic masking of detected sensitive information
- Visual warnings when sensitive data is detected
- Toggle protection on/off
- Detection counter
- Supports various types of sensitive data:
  - API keys
  - AWS credentials
  - Private keys
  - Passwords
  - JWT tokens

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory

## Usage

1. Click the extension icon in your Chrome toolbar to open the popup
2. The extension is enabled by default
3. Use the toggle button to enable/disable protection
4. The detection counter shows how many sensitive data instances have been found and masked

## How it Works

The extension uses pattern matching to identify potential sensitive data in web pages. When sensitive data is detected:

1. The data is automatically masked
2. A warning message is displayed
3. The detection counter is incremented

## Security Note

This extension is designed to help prevent accidental exposure of sensitive data. However, it should not be relied upon as the sole security measure. Always follow security best practices and never share sensitive credentials.

## Contributing

Feel free to submit issues and enhancement requests! 
