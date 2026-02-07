#!/usr/bin/env python3
"""
JLPT Vocabulary Scraper
Scrapes vocabulary from nihongokyoshi-net.com and saves to markdown/JSON files
Intelligently detects kanji vs romaji to output correct format for Swift app
"""

import requests
from bs4 import BeautifulSoup
import re
import os
import json
from pathlib import Path


# JLPT level URLs - add more URLs if you find them
VOCAB_URLS = {
    'N5': 'https://nihongokyoshi-net.com/2017/09/17/jlptn5-vocabulary-list/',
    # Add other levels here when URLs are found
    'N4': 'https://nihongokyoshi-net.com/2020/10/16/jlptn4-vocabulary-list/',
    # 'N3': 'https://nihongokyoshi-net.com/...',
    # 'N2': 'https://nihongokyoshi-net.com/...',
    # 'N1': 'https://nihongokyoshi-net.com/...',
}


def is_kanji(text):
    """
    Check if text contains kanji characters.
    Kanji unicode ranges: 4E00-9FFF (CJK Unified Ideographs)
    """
    if not text:
        return False
    return any('\u4e00' <= char <= '\u9fff' for char in text)


def is_hiragana(text):
    """
    Check if text is hiragana.
    Hiragana unicode range: 3040-309F
    """
    if not text:
        return False
    return all('\u3040' <= char <= '\u309f' or char in ' ・' for char in text if not char.isspace())


def normalize_vocabulary_entry(col1, col2, col3):
    """
    Normalize vocabulary entry to (word, reading, meaning) format.

    The scraped data has inconsistent formats:
    - N4/N3/N2/N1: hiragana | kanji | meaning
    - N5: hiragana | romaji | meaning

    We want output: word (kanji or hiragana) | reading (hiragana) | meaning

    Args:
        col1: First column (usually hiragana)
        col2: Second column (kanji or romaji)
        col3: Third column (meaning/translation)

    Returns:
        tuple: (word, reading, meaning)
    """
    # If col2 contains kanji, it's the word form
    if is_kanji(col2):
        word = col2       # Kanji form
        reading = col1    # Hiragana reading
    # If col2 is hiragana, the word only exists in hiragana
    elif is_hiragana(col2):
        word = col2       # Hiragana form
        reading = col2    # Same as word
    # If col2 is romaji (or other), use col1 as both word and reading
    else:
        word = col1       # Hiragana form
        reading = col1    # Same as word

    meaning = col3

    return (word, reading, meaning)


def scrape_vocabulary(url):
    """
    Scrape vocabulary from a JLPT vocabulary page.

    Returns:
        list of dict: Each dict contains {'category': str, 'items': list of tuples (word, reading, meaning)}
    """
    print(f"Fetching {url}...")
    response = requests.get(url, timeout=30)
    response.raise_for_status()

    soup = BeautifulSoup(response.content, 'html.parser')

    # Find the main content area
    content = soup.find('div', class_='entry-content') or soup.find('article')
    if not content:
        print("Could not find content area")
        return []

    vocabulary_sections = []
    current_category = None

    # Iterate through all elements in content
    for element in content.find_all(['h2', 'h3', 'h4', 'table']):
        if element.name in ['h2', 'h3', 'h4']:
            # This is a category heading
            category_text = element.get_text(strip=True)
            # Skip if it's a navigation heading or empty
            if category_text and not category_text.startswith('シェア'):
                current_category = category_text
                print(f"  Found category: {current_category}")

        elif element.name == 'table' and current_category:
            # This is a vocabulary table
            items = []
            rows = element.find_all('tr')

            for row in rows[1:]:  # Skip header row
                cells = row.find_all(['td', 'th'])
                if len(cells) >= 3:
                    col1 = cells[0].get_text(strip=True)
                    col2 = cells[1].get_text(strip=True)
                    col3 = cells[2].get_text(strip=True)

                    # Skip empty rows
                    if col1 and col3:
                        # Normalize the entry to (word, reading, meaning)
                        word, reading, meaning = normalize_vocabulary_entry(col1, col2, col3)
                        items.append((word, reading, meaning))

            if items:
                vocabulary_sections.append({
                    'category': current_category,
                    'items': items
                })
                print(f"    - Found {len(items)} items")

    return vocabulary_sections


def format_markdown(level, vocabulary_sections):
    """
    Format vocabulary sections as markdown with correct column names.

    Args:
        level: JLPT level (e.g., 'N5')
        vocabulary_sections: List of vocabulary sections

    Returns:
        str: Markdown formatted content
    """
    lines = [f"# JLPT {level} Vocabulary\n"]

    total_items = sum(len(section['items']) for section in vocabulary_sections)
    lines.append(f"Total vocabulary items: **{total_items}**\n")

    for section in vocabulary_sections:
        lines.append(f"\n## {section['category']}\n")

        # Create a table with proper column names
        lines.append("| Word | Reading | Meaning |")
        lines.append("|------|---------|---------|")

        for word, reading, meaning in section['items']:
            # Escape pipe characters in content
            word = word.replace('|', '\\|')
            reading = reading.replace('|', '\\|')
            meaning = meaning.replace('|', '\\|')
            lines.append(f"| {word} | {reading} | {meaning} |")

    return '\n'.join(lines)


def format_json(level, vocabulary_sections):
    """
    Format vocabulary sections as JSON for easier parsing.

    Args:
        level: JLPT level (e.g., 'N5')
        vocabulary_sections: List of vocabulary sections

    Returns:
        dict: JSON-serializable dictionary
    """
    items = []
    for section in vocabulary_sections:
        for word, reading, meaning in section['items']:
            items.append({
                'word': word,
                'reading': reading,
                'meaning': meaning,
                'level': level,
                'category': section['category']
            })

    return {
        'level': level,
        'total_items': len(items),
        'vocabulary': items
    }


def main():
    """Main function to scrape all vocabulary levels."""
    # Create vocabulary output directories
    md_output_dir = Path('vocabulary')
    json_output_dir = Path('vocabulary_json')
    md_output_dir.mkdir(exist_ok=True)
    json_output_dir.mkdir(exist_ok=True)

    print(f"Markdown output: {md_output_dir.absolute()}")
    print(f"JSON output: {json_output_dir.absolute()}\n")

    # Track statistics
    total_words = 0
    all_vocabulary = []

    # Scrape each level
    for level, url in VOCAB_URLS.items():
        try:
            print(f"\n{'='*60}")
            print(f"Processing JLPT {level}")
            print(f"{'='*60}")

            vocabulary_sections = scrape_vocabulary(url)

            if not vocabulary_sections:
                print(f"No vocabulary found for {level}")
                continue

            # Generate and save markdown
            markdown_content = format_markdown(level, vocabulary_sections)
            md_file = md_output_dir / f"{level}_vocabulary.md"
            with open(md_file, 'w', encoding='utf-8') as f:
                f.write(markdown_content)

            # Generate and save JSON
            json_data = format_json(level, vocabulary_sections)
            json_file = json_output_dir / f"{level}_vocabulary.json"
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)

            word_count = sum(len(section['items']) for section in vocabulary_sections)
            total_words += word_count
            all_vocabulary.append(json_data)

            print(f"\n✓ Saved {word_count} words")
            print(f"  - Markdown: {md_file}")
            print(f"  - JSON: {json_file}")

        except requests.exceptions.RequestException as e:
            print(f"✗ Error fetching {level}: {e}")
        except Exception as e:
            print(f"✗ Error processing {level}: {e}")
            import traceback
            traceback.print_exc()

    # Save combined JSON file
    if all_vocabulary:
        combined_file = json_output_dir / "all_vocabulary.json"
        with open(combined_file, 'w', encoding='utf-8') as f:
            json.dump({'levels': all_vocabulary}, f, ensure_ascii=False, indent=2)
        print(f"\n✓ Saved combined vocabulary to {combined_file}")

    print(f"\n{'='*60}")
    print(f"Scraping complete!")
    print(f"Total words scraped: {total_words}")
    print(f"Output formats: Markdown (.md) and JSON (.json)")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    # Check dependencies
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        print("Error: Required libraries not found.")
        print("Please install them with:")
        print("  pip install requests beautifulsoup4")
        exit(1)

    main()
