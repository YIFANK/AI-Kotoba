import SwiftUI
import SwiftData

struct JLPTLibraryView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: VocabularyViewModel?
    @State private var jlptService = JLPTVocabularyService.shared
    @State private var selectedLevel: JLPTLevel?
    @State private var selectedCategory: String?
    @State private var searchText = ""
    @State private var showingBulkImportConfirmation = false

    var body: some View {
        VStack(spacing: 0) {
            // Header with bulk import
            HStack {
                Text("JLPT词汇库")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Spacer()

                if selectedLevel != nil {
                    Button(action: { showingBulkImportConfirmation = true }) {
                        Label("批量导入", systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(.borderedProminent)
                    .help("将当前筛选的所有词汇添加到我的词汇表")
                }
            }
            .padding()

            // Filters
            HStack(spacing: 12) {
                // Level picker
                Picker("级别", selection: $selectedLevel) {
                    Text("全部级别").tag(nil as JLPTLevel?)
                    ForEach(JLPTLevel.allCases) { level in
                        Text(level.displayName).tag(level as JLPTLevel?)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 300)

                Spacer()

                // Category picker
                Menu {
                    Button("全部分类") { selectedCategory = nil }
                    Divider()
                    ForEach(availableCategories, id: \.self) { category in
                        Button(category) { selectedCategory = category }
                    }
                } label: {
                    HStack {
                        Text(selectedCategory ?? "全部分类")
                        Image(systemName: "chevron.down")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.gray.opacity(0.2))
                    .cornerRadius(8)
                }
            }
            .padding(.horizontal)

            // Search bar
            TextField("搜索词汇...", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
                .padding(.top, 8)

            Divider()
                .padding(.top)

            // Vocabulary list
            if filteredVocabulary.isEmpty {
                ContentUnavailableView(
                    "没有找到词汇",
                    systemImage: "book.closed",
                    description: Text(jlptService.isLoaded ? "尝试更改筛选条件" : "正在加载词汇库...")
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        // Stats header
                        HStack {
                            Text("共 \(filteredVocabulary.count) 个词汇")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Spacer()
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)

                        // Vocabulary items
                        ForEach(filteredVocabulary) { item in
                            JLPTVocabularyRowView(
                                item: item,
                                isInMyList: isInMyList(item),
                                onAddToList: {
                                    addToMyList(item)
                                }
                            )
                            .padding(.horizontal)
                        }
                    }
                    .padding(.bottom, 20)
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = VocabularyViewModel(modelContext: modelContext)
            }
        }
        .confirmationDialog(
            "确认批量导入",
            isPresented: $showingBulkImportConfirmation,
            titleVisibility: .visible
        ) {
            Button("导入 \(filteredVocabulary.count) 个词汇") {
                bulkImportVocabulary()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("这将添加 \(filteredVocabulary.count) 个词汇到你的词汇表。已存在的词汇将被跳过。")
        }
    }

    // MARK: - Computed Properties

    private var filteredVocabulary: [JLPTVocabulary] {
        jlptService.vocabulary(
            forLevel: selectedLevel,
            category: selectedCategory,
            searchText: searchText
        )
    }

    private var availableCategories: [String] {
        jlptService.categories(for: selectedLevel)
    }

    // MARK: - Helper Methods

    private func isInMyList(_ item: JLPTVocabulary) -> Bool {
        guard let viewModel = viewModel else { return false }
        return viewModel.vocabularyItems.contains { $0.word == item.word }
    }

    private func addToMyList(_ item: JLPTVocabulary) {
        guard let viewModel = viewModel, !isInMyList(item) else { return }
        viewModel.addVocabulary(
            word: item.word,
            reading: item.reading,
            meaning: item.meaning,
            exampleSentence: nil
        )
    }

    private func bulkImportVocabulary() {
        guard let viewModel = viewModel else { return }

        var addedCount = 0
        for item in filteredVocabulary {
            if !isInMyList(item) {
                viewModel.addVocabulary(
                    word: item.word,
                    reading: item.reading,
                    meaning: item.meaning,
                    exampleSentence: nil
                )
                addedCount += 1
            }
        }

        print("✅ Bulk imported \(addedCount) vocabulary items")
    }
}

struct JLPTVocabularyRowView: View {
    let item: JLPTVocabulary
    let isInMyList: Bool
    let onAddToList: () -> Void

    @StateObject private var ttsService = TTSService.shared

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // TTS button
            Button(action: {
                ttsService.speak(text: item.word)
            }) {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundColor(.accentColor)
                    .imageScale(.medium)
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .help("朗读发音")

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.word)
                        .font(.headline)

                    // JLPT level badge
                    Text(item.level.rawValue)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(levelColor.opacity(0.2))
                        .foregroundColor(levelColor)
                        .cornerRadius(4)

                    // Category badge
                    Text(item.category)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.gray.opacity(0.2))
                        .foregroundColor(.secondary)
                        .cornerRadius(4)
                }

                Text(item.reading)
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Text(item.meaning)
                    .font(.body)
            }

            Spacer()

            // Add to list button
            if isInMyList {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                    .imageScale(.large)
                    .help("已在我的词汇表中")
            } else {
                Button(action: onAddToList) {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.accentColor)
                        .imageScale(.large)
                }
                .buttonStyle(.plain)
                .help("添加到我的词汇表")
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    private var levelColor: Color {
        switch item.level {
        case .n5: return .green
        case .n4: return .blue
        case .n3: return .orange
        case .n2: return .purple
        case .n1: return .red
        }
    }
}
