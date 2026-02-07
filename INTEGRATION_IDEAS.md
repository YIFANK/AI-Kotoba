# 📚 Grammar & Vocabulary Integration Ideas

## 📁 Resource Location

Resources are now located at:
```
ai-kotoba/
└── Resources/
    ├── Grammar/
    │   ├── N5.md
    │   ├── N4.md
    │   ├── N3.md
    │   ├── N2.md
    │   └── N1.md
    └── Vocabulary/
        └── (vocabulary files when scraped)
```

**Important:** After placing resources, add them to your Xcode project:
1. In Xcode, right-click `ai-kotoba` folder → "Add Files to AI-Kotoba"
2. Select the `Resources` folder
3. Check "Create folder references" (blue folder icon)
4. This ensures the markdown files are bundled with your app

---

## 🎯 Integration Ideas (Ordered by Implementation Difficulty)

### 1. **Grammar Reference Tab** ⭐ Easy (1-2 days)

Add a dedicated "Grammar" tab for users to browse JLPT grammar patterns.

**Features:**
- Level selector (N5/N4/N3/N2/N1)
- Searchable list of grammar patterns
- Markdown rendering of grammar explanations
- Bookmark favorite grammar points

**Benefits:**
- Provides instant grammar lookup during study
- Complements AI-generated scenarios with formal reference
- No internet required

**Implementation Notes:**
- Create `GrammarView.swift` with markdown parser
- Use `MarkdownUI` package or `AttributedString` with markdown
- Add grammar model with SwiftData for bookmarks

---

### 2. **Smart Grammar Highlighting in Conversations** ⭐⭐ Medium (3-4 days)

Automatically detect and highlight grammar patterns in AI-generated conversations.

**Features:**
- Parse conversation text for known grammar patterns
- Highlight detected grammar with colored underline or badge
- Tap highlighted grammar → show explanation popup
- "Grammar used in this conversation" summary section

**Benefits:**
- Contextual learning: grammar in real usage
- Connects abstract rules to practical examples
- Increases awareness of patterns in natural speech

**Example:**
```
田中：映画を見に行きませんか？
         ⬆️ [N5: ~ませんか (invitation)]

山田：ええ、行きたいです。でも、今日は忙しいので明日はどうですか？
                              ⬆️ [N4: ~ので (reason)]  ⬆️ [N5: ~はどうですか]
```

**Implementation:**
- Create `GrammarDetectionService.swift`
- Load grammar patterns from markdown on app launch
- Use regex/string matching to detect patterns
- Add `grammarMatches: [GrammarMatch]` to `ConversationLine` model (optional field!)

---

### 3. **Pre-loaded JLPT Vocabulary Library** ⭐ Easy (1 day)

Import scraped JLPT vocabulary as a browseable reference library.

**Features:**
- Browse all JLPT vocabulary by level (N5-N1)
- Filter by category (verbs, adjectives, nouns, etc.)
- Search across all levels
- One-tap to add to personal vocabulary list
- Bulk import: "Add all N5 vocabulary to my study list"

**Benefits:**
- Comprehensive vocabulary coverage
- Users don't need to manually add basic words
- Structured learning path (start with N5, progress to N1)

**Implementation:**
- Parse vocabulary markdown files on app launch
- Create `JLPTVocabulary` struct (separate from user's `VocabularyItem`)
- Add "JLPT Library" tab in VocabularyView
- "Add to My List" button creates `VocabularyItem` from library entry

---

### 4. **Vocabulary Suggestions During Scenario Creation** ⭐⭐ Medium (2-3 days)

When generating scenarios, suggest relevant JLPT vocabulary from the library.

**Features:**
- Before generating scenario, let user select:
  - JLPT level (N5-N1)
  - Target grammar points (multi-select from list)
  - Target vocabulary (multi-select from JLPT library)
- AI prompt includes: "Please use these grammar patterns: [list]"
- After generation, show "Grammar & Vocab Coverage" report

**Benefits:**
- Targeted practice for specific patterns
- Ensures scenarios match user's level
- Better alignment with JLPT exam preparation

**Implementation:**
- Add grammar/vocab selectors to `ScenarioView`
- Modify `Constants.scenarioPromptJapanese()` to accept target patterns
- Create `LearningGoalsSheet` view for selection interface

---

### 5. **Grammar Practice Mode** ⭐⭐⭐ Advanced (5-7 days)

Interactive exercises for grammar patterns (separate from conversation practice).

**Features:**
- Select grammar pattern → generate 5 practice sentences
- Fill-in-the-blank exercises: "彼は忙しい___、会議に出席しました。" (Answer: のに)
- Multiple choice explanations
- Sentence transformation: "Change to ~なければならない form"
- SRS system for grammar (like vocabulary flashcards)

**Benefits:**
- Targeted grammar drilling
- Complements conversational learning with focused practice
- Gamification: progress tracking, streak counter

**Implementation:**
- Create `GrammarPracticeView` and `GrammarPracticeViewModel`
- Use AI to generate practice sentences for each grammar point
- Add `GrammarCard` model with SRS fields (like `FlashCard`)
- Create `GrammarFlashCardView` similar to existing flashcards

---

### 6. **AI Scenario with Grammar Constraints** ⭐⭐⭐ Advanced (4-5 days)

Generate scenarios that specifically practice selected grammar patterns.

**Features:**
- User selects 3-5 grammar patterns to practice
- AI generates conversation using ALL selected patterns
- Grammar patterns are highlighted in the conversation
- Review mode explains why each pattern was used

**Example Request:**
```
"Generate a conversation using:
- ~ために (purpose)
- ~ば~ほど (the more... the more...)
- ~にしては (considering/for)"
```

**Benefits:**
- Deliberate practice of difficult grammar
- Contextual understanding of nuanced patterns
- Perfect for JLPT preparation

**Implementation:**
- Modify scenario generation prompts
- Add grammar constraint selection in `ScenarioView`
- Post-generation: verify AI used requested patterns
- Add "Grammar Focus" badge to scenarios

---

### 7. **Grammar Pattern Comparison Tool** ⭐⭐ Medium (2-3 days)

Side-by-side comparison of similar grammar patterns.

**Features:**
- Compare confusing pairs: "~ために vs ~ように", "~ば vs ~たら vs ~と vs ~なら"
- Differences explained in Chinese
- Example sentences for each
- Practice quiz: "Which pattern fits this sentence?"

**Benefits:**
- Clarifies common confusions
- Advanced learners struggle with nuanced differences
- Reduces errors in production

**Implementation:**
- Create `GrammarComparisonView`
- Pre-define common confusing pairs in JSON/plist
- Use AI to generate comparison explanations on-demand

---

### 8. **Vocabulary from Conversations Auto-Save** ⭐ Easy (1 day) - **Quick Win!**

Automatically extract and suggest vocabulary from AI-generated conversations.

**Current State:** You already have `vocabularyItems` in scenarios!

**Enhancement:**
- After scenario generation, show "Found vocabulary suggestions"
- One-tap to add all to personal vocabulary list
- Mark which words are already in user's list
- Show JLPT level badge for each word (if in library)

**Benefits:**
- Reduces manual vocabulary entry
- Contextual vocabulary learning
- Leverages existing infrastructure

**Implementation:**
- Scenario already returns vocabulary items
- Add "Save All Vocabulary" button in `ConversationView`
- Check against existing `VocabularyItem` to avoid duplicates
- Add JLPT level detection by cross-referencing library

---

### 9. **JLPT Level Assessment** ⭐⭐⭐ Advanced (7-10 days)

Assess user's current JLPT level through conversation and quizzes.

**Features:**
- Initial assessment: 20 questions across all levels
- Adaptive testing: adjusts difficulty based on answers
- Generates report: "Your level is between N3-N2"
- Recommends learning path and scenarios

**Benefits:**
- Personalized learning path
- Motivation through progress tracking
- Sets appropriate difficulty for scenarios

**Implementation:**
- Create assessment questions from JLPT library
- Use AI to generate conversational assessment
- Store user level in settings
- Auto-select appropriate scenario difficulty

---

### 10. **Grammar in Context: Example Mining** ⭐⭐ Medium (3-4 days)

Search past conversations for examples of specific grammar patterns.

**Features:**
- Select grammar pattern → see all examples from user's history
- "You've encountered this pattern 12 times"
- Review mode: practice scenarios that used this grammar
- Export examples to flashcards

**Benefits:**
- Personalized example corpus
- Reinforces learning through repetition recognition
- Makes old scenarios more valuable

**Implementation:**
- Index conversations by grammar patterns used
- Add `grammarPatterns: [String]?` to `Scenario` model (optional!)
- Create `GrammarHistoryView` with search interface
- Background indexing of existing scenarios

---

## 🎨 UI/UX Suggestions

### Tab Bar Addition
```
Current: Practice | History | Favorites | Vocabulary | Flashcards | Settings
Proposed: Practice | History | Favorites | Vocabulary | Grammar | Flashcards | Settings
```

### Or Combine into "Library" Tab
```
Library Tab:
├── Vocabulary (current)
│   ├── My Vocabulary (user-saved)
│   └── JLPT Library (reference)
├── Grammar (new)
│   ├── Browse by Level
│   ├── Favorites
│   └── Practice
└── Flashcards (move here)
```

### Quick Access Grammar Sheet
Add a floating "?" button in `ConversationView` that opens a popover:
- Quick grammar reference for current conversation
- Detected patterns explained
- Related patterns suggested

---

## 🚀 Recommended Implementation Order

**Phase 1: Foundation (Week 1)**
1. ✅ Add Resources folder to Xcode
2. Vocabulary Library browsing (#3)
3. Grammar Reference Tab (#1)
4. Auto-save vocabulary from conversations (#8) - Quick Win!

**Phase 2: Smart Features (Week 2-3)**
5. Grammar highlighting in conversations (#2)
6. Vocabulary suggestions during scenario creation (#4)
7. Grammar pattern comparison tool (#7)

**Phase 3: Advanced Features (Week 4+)**
8. Grammar practice mode (#5)
9. AI scenarios with grammar constraints (#6)
10. JLPT level assessment (#9)
11. Grammar context mining (#10)

---

## 📊 Technical Considerations

### Markdown Parsing
For rendering grammar markdown in SwiftUI:

**Option 1: MarkdownUI Package** (Recommended)
```swift
import MarkdownUI

struct GrammarDetailView: View {
    let grammarContent: String

    var body: some View {
        ScrollView {
            Markdown(grammarContent)
                .markdownTheme(.gitHub)
        }
    }
}
```

**Option 2: Native AttributedString** (macOS 12+)
```swift
let attributedString = try? AttributedString(
    markdown: grammarContent,
    options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
)
```

### Adding Resources to Xcode
1. Right-click `ai-kotoba` folder in Xcode
2. "Add Files to AI-Kotoba..."
3. Select `Resources` folder
4. ✅ Check "Create folder references" (blue folder, not yellow group)
5. ✅ Check target "AI-Kotoba"

This ensures markdown files are copied to app bundle.

### Loading Resources at Runtime
```swift
// In a service or utility file
class ResourceLoader {
    static func loadGrammar(level: String) -> String? {
        guard let url = Bundle.main.url(forResource: "N\\(level)", withExtension: "md", subdirectory: "Resources/Grammar") else {
            return nil
        }
        return try? String(contentsOf: url, encoding: .utf8)
    }
}
```

### Grammar Pattern Detection
```swift
struct GrammarPattern {
    let pattern: String      // "~ませんか"
    let level: String        // "N5"
    let category: String     // "Invitation"
    let regex: String        // For detection in text
}

// Simple detection
func detectGrammar(in text: String) -> [GrammarPattern] {
    // Load all patterns from markdown
    // Check if text contains each pattern
    // Return matches
}
```

---

## 💡 Quick Wins for Immediate Impact

1. **Grammar reference tab** - Users can instantly look up patterns
2. **Auto-save vocabulary** - Reduce friction in vocabulary collection
3. **JLPT level badges** - Show difficulty of content
4. **Search across grammar/vocab** - Fast lookups during study

These 4 features alone would significantly enhance the learning experience!

---

## 🎓 Learning Science Behind These Features

- **Spaced Repetition**: Already implemented for vocab, extend to grammar
- **Contextual Learning**: Grammar in conversations (not isolated rules)
- **Deliberate Practice**: Target weak areas with focused scenarios
- **Recognition → Production**: Browse → Highlight → Practice → Use
- **Interleaving**: Mix grammar, vocab, conversation for better retention

Your app already does conversational AI brilliantly. Adding structured reference materials (grammar/vocab libraries) creates a complete learning ecosystem! 🚀
