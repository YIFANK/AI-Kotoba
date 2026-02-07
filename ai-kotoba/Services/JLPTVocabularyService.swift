import Foundation

@Observable
class JLPTVocabularyService {
    static let shared = JLPTVocabularyService()

    var vocabularyByLevel: [JLPTLevel: [JLPTVocabulary]] = [:]
    var allVocabulary: [JLPTVocabulary] = []
    var categories: Set<String> = []
    var isLoaded = false

    private init() {
        loadAllVocabulary()
    }

    func loadAllVocabulary() {
        var allLoaded: [JLPTVocabulary] = []
        var allCategories: Set<String> = []

        for level in JLPTLevel.allCases {
            let vocabulary = loadVocabulary(for: level)
            vocabularyByLevel[level] = vocabulary
            allLoaded.append(contentsOf: vocabulary)

            // Collect unique categories
            for item in vocabulary {
                allCategories.insert(item.category)
            }
        }

        self.allVocabulary = allLoaded
        self.categories = allCategories
        self.isLoaded = true

        print("✅ Loaded \(allLoaded.count) vocabulary items across \(allCategories.count) categories")
    }

    private func loadVocabulary(for level: JLPTLevel) -> [JLPTVocabulary] {
        guard let url = Bundle.main.url(
            forResource: level.fileName,
            withExtension: "md"
        ) else {
            print("⚠️ Could not find vocabulary file for \(level.rawValue)")
            return []
        }

        guard let content = try? String(contentsOf: url, encoding: .utf8) else {
            print("⚠️ Could not read vocabulary file for \(level.rawValue)")
            return []
        }

        return parseMarkdown(content, level: level)
    }

    private func parseMarkdown(_ content: String, level: JLPTLevel) -> [JLPTVocabulary] {
        var result: [JLPTVocabulary] = []
        var currentCategory = "General"

        let lines = content.components(separatedBy: .newlines)

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Detect category headers (e.g., "## Number", "## Occupation")
            if trimmed.hasPrefix("##") && !trimmed.hasPrefix("###") {
                currentCategory = trimmed
                    .replacingOccurrences(of: "##", with: "")
                    .trimmingCharacters(in: .whitespaces)
                continue
            }

            // Parse table rows (format: | Word | Reading | Meaning |)
            if trimmed.hasPrefix("|") && !trimmed.contains("---") && !trimmed.contains("Word") && !trimmed.contains("Reading") {
                let components = trimmed
                    .components(separatedBy: "|")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .filter { !$0.isEmpty }

                // Ensure we have at least 3 components (Word, Reading, Meaning)
                guard components.count >= 3 else { continue }

                // New format: Word (kanji/hiragana) | Reading (hiragana) | Meaning
                let word = components[0]       // Word: kanji or hiragana (e.g., 家族)
                let reading = components[1]    // Reading: hiragana (e.g., かぞく)
                let meaning = components[2]    // Meaning: translation

                // Skip empty entries
                guard !word.isEmpty, !reading.isEmpty, !meaning.isEmpty else { continue }

                let vocabItem = JLPTVocabulary(
                    word: word,
                    reading: reading,
                    meaning: meaning,
                    level: level,
                    category: currentCategory
                )
                result.append(vocabItem)
            }
        }

        print("📖 Loaded \(result.count) words for \(level.rawValue)")
        return result
    }

    // MARK: - Filtering & Search

    func vocabulary(
        forLevel level: JLPTLevel? = nil,
        category: String? = nil,
        searchText: String = ""
    ) -> [JLPTVocabulary] {
        var filtered = allVocabulary

        // Filter by level
        if let level = level {
            filtered = vocabularyByLevel[level] ?? []
        }

        // Filter by category
        if let category = category, !category.isEmpty {
            filtered = filtered.filter { $0.category == category }
        }

        // Search filter
        if !searchText.isEmpty {
            filtered = filtered.filter {
                $0.word.localizedCaseInsensitiveContains(searchText) ||
                $0.reading.localizedCaseInsensitiveContains(searchText) ||
                $0.meaning.localizedCaseInsensitiveContains(searchText) ||
                $0.category.localizedCaseInsensitiveContains(searchText)
            }
        }

        return filtered
    }

    func categories(for level: JLPTLevel? = nil) -> [String] {
        let vocabulary = level != nil ? vocabularyByLevel[level!] ?? [] : allVocabulary
        let categorySet = Set(vocabulary.map { $0.category })
        return Array(categorySet).sorted()
    }
}
