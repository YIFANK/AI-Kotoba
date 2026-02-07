# JLPT Vocabulary Scraper

This script scrapes JLPT vocabulary from nihongokyoshi-net.com and saves it to markdown files.

## Installation

1. Install the required Python packages:
```bash
pip install -r requirements_scraper.txt
```

Or install manually:
```bash
pip install requests beautifulsoup4
```

## Usage

Run the script:
```bash
python scrape_jlpt_vocab.py
```

The script will:
- Create a `vocabulary/` folder (if it doesn't exist)
- Scrape vocabulary from all configured URLs
- Save each JLPT level to a separate markdown file (e.g., `N5_vocabulary.md`)
- Display progress and statistics

## Output Format

Each vocabulary file contains:
- A header with the JLPT level
- Total word count
- Organized sections by category (Numbers, Occupations, Verbs, etc.)
- Tables with three columns: Japanese | Romaji | Meaning

Example output structure:
```
vocabulary/
├── N5_vocabulary.md
├── N4_vocabulary.md  (if URL is added)
└── ...
```

## Adding More Levels

Currently, only N5 is configured. To add other levels:

1. Open `scrape_jlpt_vocab.py`
2. Find the `VOCAB_URLS` dictionary
3. Add URLs for other levels:
```python
VOCAB_URLS = {
    'N5': 'https://nihongokyoshi-net.com/2017/09/17/jlptn5-vocabulary-list/',
    'N4': 'https://nihongokyoshi-net.com/YOUR_N4_URL_HERE/',
    # Add N3, N2, N1 when URLs are found
}
```

## Troubleshooting

**Import Error**: Make sure you've installed the dependencies
```bash
pip install requests beautifulsoup4
```

**Connection Error**: Check your internet connection and verify the URLs are accessible

**No vocabulary found**: The page structure may have changed. Check the HTML structure and update the scraping logic if needed.

## Features

- ✅ Automatic category detection
- ✅ Table parsing with 3 columns (Japanese, Romaji, Meaning)
- ✅ Clean markdown output
- ✅ Progress tracking and statistics
- ✅ Error handling for network issues
- ✅ Easy to extend for multiple JLPT levels
