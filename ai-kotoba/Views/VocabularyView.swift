import SwiftUI
import SwiftData

struct VocabularyView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var selectedTab: VocabularyTab = .myVocabulary

    enum VocabularyTab: String, CaseIterable {
        case myVocabulary = "我的词汇"
        case jlptLibrary = "JLPT词汇库"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab Picker
            Picker("Vocabulary Tab", selection: $selectedTab) {
                ForEach(VocabularyTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab Content
            TabView(selection: $selectedTab) {
                MyVocabularyView()
                    .tag(VocabularyTab.myVocabulary)

                JLPTLibraryView()
                    .tag(VocabularyTab.jlptLibrary)
            }
            .tabViewStyle(.automatic)
        }
    }
}

struct MyVocabularyView: View {
    @Environment(\.modelContext) private var modelContext
    @State private var viewModel: VocabularyViewModel?
    @State private var showingAddSheet = false
    @State private var editingItem: VocabularyItem?

    var body: some View {
        VStack(spacing: 0) {
            if let viewModel {
                // Header
                HStack {
                    Text("我的词汇")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Spacer()

                    Button(action: { showingAddSheet = true }) {
                        Label("添加词汇", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding()

                // Search
                TextField("搜索词汇...", text: Binding(
                    get: { viewModel.searchText },
                    set: { viewModel.searchText = $0 }
                ))
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

                Divider()
                    .padding(.top)

                // List
                if viewModel.filteredVocabulary.isEmpty {
                    ContentUnavailableView(
                        "没有词汇",
                        systemImage: "book",
                        description: Text("点击添加按钮来添加新词汇，或从JLPT词汇库导入")
                    )
                } else {
                    List {
                        ForEach(viewModel.filteredVocabulary, id: \.id) { item in
                            VocabularyRowView(
                                item: item,
                                onEdit: { editingItem = item },
                                onDelete: { viewModel.deleteVocabulary(item) },
                                onCreateFlashCard: { viewModel.createFlashCard(from: item) }
                            )
                        }
                    }
                    .listStyle(.plain)
                }
            }
        }
        .onAppear {
            if viewModel == nil {
                viewModel = VocabularyViewModel(modelContext: modelContext)
            } else {
                viewModel?.loadVocabulary()
            }
        }
        .sheet(isPresented: $showingAddSheet) {
            if let viewModel {
                AddVocabularySheet(viewModel: viewModel, isPresented: $showingAddSheet)
            }
        }
        .sheet(item: $editingItem) { item in
            if let viewModel {
                EditVocabularySheet(viewModel: viewModel, item: item, isPresented: .init(
                    get: { editingItem != nil },
                    set: { if !$0 { editingItem = nil } }
                ))
            }
        }
    }
}

struct VocabularyRowView: View {
    let item: VocabularyItem
    let onEdit: () -> Void
    let onDelete: () -> Void
    let onCreateFlashCard: () -> Void

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
                Text(item.word)
                    .font(.headline)

                Text(item.reading)
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Text(item.meaning)
                    .font(.body)

                if let example = item.exampleSentence {
                    Text(example)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 2)
                }
            }

            Spacer()

            HStack(spacing: 8) {
                Button(action: onCreateFlashCard) {
                    Image(systemName: "rectangle.stack.badge.plus")
                }
                .buttonStyle(.plain)
                .help("创建复习卡片")

                Button(action: onEdit) {
                    Image(systemName: "pencil")
                }
                .buttonStyle(.plain)
                .help("编辑")

                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .foregroundColor(.red)
                }
                .buttonStyle(.plain)
                .help("删除")
            }
        }
        .padding(.vertical, 4)
    }
}

struct AddVocabularySheet: View {
    let viewModel: VocabularyViewModel
    @Binding var isPresented: Bool

    @State private var word = ""
    @State private var reading = ""
    @State private var meaning = ""
    @State private var exampleSentence = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("添加新词汇")
                .font(.title)
                .fontWeight(.bold)

            Form {
                TextField("单词（日语）", text: $word)
                TextField("读音（假名）", text: $reading)
                TextField("意思（中文）", text: $meaning)
                TextField("例句（可选）", text: $exampleSentence)
            }
            .textFieldStyle(.roundedBorder)

            HStack {
                Button("取消") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("添加") {
                    viewModel.addVocabulary(
                        word: word,
                        reading: reading,
                        meaning: meaning,
                        exampleSentence: exampleSentence.isEmpty ? nil : exampleSentence
                    )
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(word.isEmpty || reading.isEmpty || meaning.isEmpty)
            }
        }
        .padding(40)
        .frame(width: 500, height: 400)
    }
}

struct EditVocabularySheet: View {
    let viewModel: VocabularyViewModel
    let item: VocabularyItem
    @Binding var isPresented: Bool

    @State private var word = ""
    @State private var reading = ""
    @State private var meaning = ""
    @State private var exampleSentence = ""

    var body: some View {
        VStack(spacing: 20) {
            Text("编辑词汇")
                .font(.title)
                .fontWeight(.bold)

            Form {
                TextField("单词（日语）", text: $word)
                TextField("读音（假名）", text: $reading)
                TextField("意思（中文）", text: $meaning)
                TextField("例句（可选）", text: $exampleSentence)
            }
            .textFieldStyle(.roundedBorder)

            HStack {
                Button("取消") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Button("保存") {
                    viewModel.updateVocabulary(
                        item,
                        word: word,
                        reading: reading,
                        meaning: meaning,
                        exampleSentence: exampleSentence.isEmpty ? nil : exampleSentence
                    )
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(word.isEmpty || reading.isEmpty || meaning.isEmpty)
            }
        }
        .padding(40)
        .frame(width: 500, height: 400)
        .onAppear {
            word = item.word
            reading = item.reading
            meaning = item.meaning
            exampleSentence = item.exampleSentence ?? ""
        }
    }
}
