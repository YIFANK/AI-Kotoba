#!/bin/bash

# AI-Kotoba Project Setup Script
# This script helps set up the Xcode project for the AI-Kotoba app

echo "🚀 Setting up AI-Kotoba Xcode Project..."
echo ""

# Check if we're in the right directory
if [ ! -d "AI-Kotoba" ]; then
    echo "❌ Error: AI-Kotoba source directory not found!"
    echo "Please run this script from the project root directory."
    exit 1
fi

echo "✅ Source files found"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Open Xcode"
echo "2. Select 'Create a new Xcode project'"
echo "3. Choose 'macOS' → 'App'"
echo "4. Configure the project:"
echo "   - Product Name: AI-Kotoba"
echo "   - Organization Identifier: com.yourname (or your preference)"
echo "   - Interface: SwiftUI"
echo "   - Language: Swift"
echo "   - Storage: SwiftData"
echo "   - Create Git repository: No (already exists)"
echo "5. Save the project in this directory"
echo "6. In Xcode, delete the default files Xcode created"
echo "7. Drag and drop the AI-Kotoba folder into the project navigator"
echo "8. Make sure 'Copy items if needed' is UNCHECKED"
echo "9. Make sure 'Create groups' is selected"
echo "10. Make sure 'AI-Kotoba' target is checked"
echo ""
echo "🔑 API Key Setup:"
echo "On first run, you'll be prompted to enter your Claude API key."
echo "Get your API key from: https://console.anthropic.com/settings/keys"
echo ""
echo "✨ The app should now be ready to build and run!"
echo ""
