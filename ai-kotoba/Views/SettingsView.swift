import SwiftUI

struct SettingsView: View {
    @State private var claudeAPIKey = ""
    @State private var openaiAPIKey = ""
    @State private var elevenLabsAPIKey = ""
    @State private var elevenLabsVoiceID = ""
    @State private var selectedGoogleVoice = Constants.GoogleCloud.defaultVoice
    @State private var googleCloudConfigured = false
    @State private var showClaudeKey = false
    @State private var showOpenAIKey = false
    @State private var showElevenLabsKey = false
    @State private var selectedTTSProvider: TTSProvider = TTSService.shared.provider
    @State private var saveMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("设置")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Spacer()
            }
            .padding()
            .background(Color.gray.opacity(0.1))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    // API Keys Section
                    VStack(alignment: .leading, spacing: 16) {
                        Text("API 密钥")
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text("配置您的 AI 服务 API 密钥以使用相应的服务")
                            .font(.body)
                            .foregroundColor(.secondary)

                        // Claude API Key
                        apiKeySection(
                            title: "Claude API Key",
                            keyBinding: $claudeAPIKey,
                            showKeyBinding: $showClaudeKey,
                            hasKey: APIKeyManager.shared.hasAPIKey(),
                            onSave: saveClaude,
                            onDelete: deleteClaude,
                            getInstructions: {
                                "前往 console.anthropic.com 获取 API 密钥"
                            }
                        )

                        Divider()

                        // OpenAI API Key
                        apiKeySection(
                            title: "OpenAI API Key",
                            keyBinding: $openaiAPIKey,
                            showKeyBinding: $showOpenAIKey,
                            hasKey: APIKeyManager.shared.hasOpenAIKey(),
                            onSave: saveOpenAI,
                            onDelete: deleteOpenAI,
                            getInstructions: {
                                "前往 platform.openai.com 获取 API 密钥"
                            }
                        )
                    }

                    // TTS Section
                    VStack(alignment: .leading, spacing: 16) {
                        Text("语音朗读")
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text("选择日语朗读引擎")
                            .font(.body)
                            .foregroundColor(.secondary)

                        Picker("语音引擎", selection: $selectedTTSProvider) {
                            ForEach(TTSProvider.allCases, id: \.self) { provider in
                                Text(provider.displayName).tag(provider)
                            }
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: selectedTTSProvider) { _, newValue in
                            TTSService.shared.provider = newValue
                        }

                        if selectedTTSProvider == .googlecloud {
                            Divider()

                            googleCloudSection()

                            VStack(alignment: .leading, spacing: 8) {
                                Text("声音选择")
                                    .font(.headline)

                                Picker("声音", selection: $selectedGoogleVoice) {
                                    ForEach(Constants.GoogleCloud.voices, id: \.name) { voice in
                                        Text(voice.label).tag(voice.name)
                                    }
                                }
                                .onChange(of: selectedGoogleVoice) { _, newValue in
                                    UserDefaults.standard.set(newValue, forKey: Constants.GoogleCloud.voiceKey)
                                }
                            }
                            .padding()
                            .background(Color.gray.opacity(0.05))
                            .cornerRadius(8)
                        }

                        if selectedTTSProvider == .elevenlabs {
                            Divider()

                            apiKeySection(
                                title: "ElevenLabs API Key",
                                keyBinding: $elevenLabsAPIKey,
                                showKeyBinding: $showElevenLabsKey,
                                hasKey: APIKeyManager.shared.hasElevenLabsKey(),
                                onSave: saveElevenLabs,
                                onDelete: deleteElevenLabs,
                                getInstructions: { "前往 elevenlabs.io 获取 API 密钥" }
                            )

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Voice ID（可选）")
                                    .font(.headline)

                                Text("留空使用默认声音。在 elevenlabs.io/voice-library 查找声音 ID")
                                    .font(.caption)
                                    .foregroundColor(.secondary)

                                HStack {
                                    TextField(
                                        "例：21m00Tcm4TlvDq8ikWAM",
                                        text: $elevenLabsVoiceID
                                    )
                                    .textFieldStyle(.roundedBorder)

                                    Button("保存") {
                                        let id = elevenLabsVoiceID.trimmingCharacters(in: .whitespacesAndNewlines)
                                        if id.isEmpty {
                                            UserDefaults.standard.removeObject(forKey: Constants.ElevenLabs.voiceIDKey)
                                        } else {
                                            UserDefaults.standard.set(id, forKey: Constants.ElevenLabs.voiceIDKey)
                                        }
                                        saveMessage = "Voice ID 已保存"
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
                                    }
                                    .buttonStyle(.borderedProminent)
                                }
                            }
                            .padding()
                            .background(Color.gray.opacity(0.05))
                            .cornerRadius(8)
                        }
                    }

                    // About Section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("关于")
                            .font(.title2)
                            .fontWeight(.semibold)

                        VStack(alignment: .leading, spacing: 8) {
                            InfoRow(label: "应用名称", value: "AI-Kotoba")
                            InfoRow(label: "版本", value: "1.0.0")
                            InfoRow(label: "描述", value: "日语学习助手")
                        }
                    }

                    // Usage Instructions
                    VStack(alignment: .leading, spacing: 12) {
                        Text("使用说明")
                            .font(.title2)
                            .fontWeight(.semibold)

                        Text("""
                        1. 在「练习」页面输入场景，选择模式和 AI 服务
                        2. 常规模式：查看完整对话，学习词汇
                        3. 互动模式：逐句翻译练习，获得 AI 反馈
                        4. 点击对话行可以听到日语发音
                        5. 在「历史」中查看所有生成的场景
                        6. 点击星标将场景添加到收藏夹
                        7. 在「词汇」中添加和管理词汇
                        8. 使用「复习卡片」进行间隔重复学习
                        """)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    }

                    // Messages
                    if let message = saveMessage {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text(message)
                                .foregroundColor(.green)
                        }
                        .font(.caption)
                    }

                    if let error = errorMessage {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(.red)
                            Text(error)
                                .foregroundColor(.red)
                        }
                        .font(.caption)
                    }
                }
                .padding()
            }
        }
        .onAppear {
            loadAPIKeys()
        }
    }

    // MARK: - Google Cloud Service Account Section

    @ViewBuilder
    private func googleCloudSection() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Google Cloud 服务账号")
                    .font(.headline)

                Spacer()

                if googleCloudConfigured {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("已配置")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.orange)
                        Text("未配置")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }

            Text("在 Google Cloud Console 中创建服务账号，下载 JSON 密钥文件，然后在此处选择该文件。")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                Button("选择 JSON 密钥文件…") {
                    selectServiceAccountFile()
                }
                .buttonStyle(.borderedProminent)

                if googleCloudConfigured {
                    Button("移除") {
                        deleteGoogleCloudServiceAccount()
                    }
                    .buttonStyle(.bordered)
                    .foregroundColor(.red)
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - API Key Section (text-field style)

    @ViewBuilder
    private func apiKeySection(
        title: String,
        keyBinding: Binding<String>,
        showKeyBinding: Binding<Bool>,
        hasKey: Bool,
        onSave: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        getInstructions: () -> String
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(.headline)

                Spacer()

                if hasKey {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("已配置")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.orange)
                        Text("未配置")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }

            Text(getInstructions())
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Group {
                    if showKeyBinding.wrappedValue {
                        TextField("输入 API 密钥", text: keyBinding)
                    } else {
                        SecureField("输入 API 密钥", text: keyBinding)
                    }
                }
                .textFieldStyle(.roundedBorder)

                Button(action: {
                    showKeyBinding.wrappedValue.toggle()
                }) {
                    Image(systemName: showKeyBinding.wrappedValue ? "eye.slash" : "eye")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }

            HStack {
                Button(action: onSave) {
                    Text("保存")
                        .frame(width: 80)
                }
                .buttonStyle(.borderedProminent)
                .disabled(keyBinding.wrappedValue.isEmpty)

                if hasKey {
                    Button(action: onDelete) {
                        Text("删除")
                            .frame(width: 80)
                    }
                    .buttonStyle(.bordered)
                    .foregroundColor(.red)
                }
            }
        }
        .padding()
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - Actions

    private func loadAPIKeys() {
        claudeAPIKey = ""
        openaiAPIKey = ""
        elevenLabsAPIKey = ""
        elevenLabsVoiceID = UserDefaults.standard.string(forKey: Constants.ElevenLabs.voiceIDKey) ?? ""
        selectedGoogleVoice = UserDefaults.standard.string(forKey: Constants.GoogleCloud.voiceKey) ?? Constants.GoogleCloud.defaultVoice
        selectedTTSProvider = TTSService.shared.provider
        googleCloudConfigured = GoogleCloudAuthService.shared.hasCredentials()
    }

    private func selectServiceAccountFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = "选择 Google Cloud 服务账号 JSON 密钥文件"

        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            let jsonString = try String(contentsOf: url, encoding: .utf8)
            try GoogleCloudAuthService.shared.saveCredentials(jsonString: jsonString)
            googleCloudConfigured = true
            saveMessage = "Google Cloud 服务账号已配置"
            errorMessage = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteGoogleCloudServiceAccount() {
        do {
            try GoogleCloudAuthService.shared.deleteCredentials()
            googleCloudConfigured = false
            saveMessage = "Google Cloud 服务账号已移除"
            errorMessage = nil
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func saveClaude() {
        do {
            try APIKeyManager.shared.saveAPIKey(claudeAPIKey)
            saveMessage = "Claude API 密钥已保存"
            errorMessage = nil
            claudeAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func saveOpenAI() {
        do {
            try APIKeyManager.shared.saveOpenAIKey(openaiAPIKey)
            saveMessage = "OpenAI API 密钥已保存"
            errorMessage = nil
            openaiAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteClaude() {
        do {
            try APIKeyManager.shared.deleteAPIKey()
            saveMessage = "Claude API 密钥已删除"
            errorMessage = nil
            claudeAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func saveElevenLabs() {
        do {
            try APIKeyManager.shared.saveElevenLabsKey(elevenLabsAPIKey)
            saveMessage = "ElevenLabs API 密钥已保存"
            errorMessage = nil
            elevenLabsAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "保存失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteElevenLabs() {
        do {
            try APIKeyManager.shared.deleteElevenLabsKey()
            saveMessage = "ElevenLabs API 密钥已删除"
            errorMessage = nil
            elevenLabsAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }

    private func deleteOpenAI() {
        do {
            try APIKeyManager.shared.deleteOpenAIKey()
            saveMessage = "OpenAI API 密钥已删除"
            errorMessage = nil
            openaiAPIKey = ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { saveMessage = nil }
        } catch {
            errorMessage = "删除失败: \(error.localizedDescription)"
            saveMessage = nil
        }
    }
}

struct InfoRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
        .font(.body)
    }
}
