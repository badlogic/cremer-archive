# Cremer Archive

A web scraper and static site generator for archiving articles from derstandard.at.

## Description

This tool:
- Scrapes articles from derstandard.at
- Downloads associated images
- Generates a searchable static website with all articles and images
- Includes a lightbox viewer for images
- Provides filtering capabilities by date and text search

## Prerequisites

- Node.js (version 18 or higher)
- npm or yarn package manager

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

The main script (`index.js`) provides several functions that can be run in sequence:

1. Update articles with details:
   ```bash
   node index.js
   ```

2. Force re-extraction of all articles:
   ```bash
   node index.js --force
   ```

3. To create a zip archive of the output:
   ```bash
   ./zip.sh
   ```

4. To upload to a web server (requires configuration):
   ```bash
   ./upload.sh
   ```

## Output

The script generates:

- `output/` directory containing:
  - `index.html` - Main page with all articles and search functionality
  - Individual article pages (`article-1.html`, `article-2.html`, etc.)
  - `images/` directory with downloaded images organized by date

The generated website features:
- Responsive design
- Full-text search
- Date range filtering
- Image lightbox with keyboard navigation
- Article previews with images and teasers

## Configuration

The script uses cookies for authentication with derstandard.at. These are configured in the scraping functions.

## File Structure

- `index.js` - Main script containing scraping and generation logic
- `articles.json` - Cached article data
- `output/` - Generated static website
- `zip.sh` - Script to create distributable archive
- `upload.sh` - Script to upload to web server